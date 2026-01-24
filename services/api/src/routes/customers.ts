import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db';
import { requireAuth } from '../auth/middleware';
import crypto from 'crypto';

const SearchQuerySchema = z.object({
  q: z.string().min(3),
  limit: z.coerce.number().int().min(1).max(20).optional().default(10),
});

interface CustomerRow {
  id: string;
  name: string;
  membership_number: string | null;
  dob: string | Date | null;
}

function normalizeScanText(raw: string): string {
  const lf = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = lf.split('\n').map((line) => line.replace(/[ \t]+/g, ' ').trimEnd());
  return lines.join('\n').trim();
}

function computeSha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function toDateOnly(dob: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  // Validate it parses to a real date.
  const d = new Date(`${dob}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return null;
  return dob;
}

type NormalizedNameParts = {
  normalizedFull: string;
  firstToken: string;
  lastToken: string;
};

function normalizePersonNameForMatch(input: string): string {
  const lowered = input.toLowerCase().trim();
  const noPunct = lowered.replace(/[^a-z0-9 ]+/g, ' ');
  const collapsed = noPunct.replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';
  const tokens = collapsed.split(' ').filter(Boolean);
  const suffixes = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);
  while (tokens.length > 1 && suffixes.has(tokens[tokens.length - 1]!)) {
    tokens.pop();
  }
  return tokens.join(' ');
}

function splitNamePartsForMatch(input: string): NormalizedNameParts | null {
  const normalizedFull = normalizePersonNameForMatch(input);
  if (!normalizedFull) return null;
  const tokens = normalizedFull.split(' ').filter(Boolean);
  if (tokens.length === 0) return null;
  const firstToken = tokens[0]!;
  const lastToken = tokens[tokens.length - 1]!;
  return { normalizedFull, firstToken, lastToken };
}

function scoreNameSimilarity(input: NormalizedNameParts, stored: NormalizedNameParts): number {
  let score = 0;
  const inputFirst = input.firstToken;
  const inputLast = input.lastToken;
  const storedFirst = stored.firstToken;
  const storedLast = stored.lastToken;

  if (input.normalizedFull === stored.normalizedFull) score += 3;

  const direct = inputFirst === storedFirst && inputLast === storedLast;
  const swapped = inputFirst === storedLast && inputLast === storedFirst;
  if (direct) score += 2;
  else if (swapped) score += 1;

  if (inputLast === storedLast) score += 1;
  if (inputFirst === storedFirst) score += 1;

  if (inputFirst[0] && storedFirst[0] && inputFirst[0] === storedFirst[0]) score += 0.5;
  if (inputLast[0] && storedLast[0] && inputLast[0] === storedLast[0]) score += 0.5;

  if (storedFirst.startsWith(inputFirst) || inputFirst.startsWith(storedFirst)) score += 0.5;
  if (storedLast.startsWith(inputLast) || inputLast.startsWith(storedLast)) score += 0.5;

  return score;
}

export async function customerRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /v1/customers/search - Prefix search by first or last name (case-insensitive).
   * Requires staff auth; returns limited identity fields only.
   */
  fastify.get<{
    Querystring: z.infer<typeof SearchQuerySchema>;
  }>(
    '/v1/customers/search',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      let parsed;
      try {
        parsed = SearchQuerySchema.parse(request.query);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      const { q, limit } = parsed;
      const like = `${q}%`;

      try {
        const result = await query<CustomerRow>(
          `
        SELECT id, name, membership_number, dob
        FROM customers
        WHERE
          name ILIKE $1
          OR split_part(name, ' ', 2) ILIKE $1
        ORDER BY name
        LIMIT $2
        `,
          [like, limit]
        );

        const toMonthDay = (dob: CustomerRow['dob']): string | undefined => {
          if (!dob) return undefined;
          // pg typically returns DATE as "YYYY-MM-DD" string; handle Date defensively.
          if (typeof dob === 'string') {
            const parts = dob.split('-');
            if (parts.length >= 3) {
              const mm = parts[1]!;
              const dd = parts[2]!;
              if (mm && dd) return `${mm}/${dd}`;
            }
            return undefined;
          }
          if (dob instanceof Date) {
            const mm = String(dob.getUTCMonth() + 1).padStart(2, '0');
            const dd = String(dob.getUTCDate()).padStart(2, '0');
            return `${mm}/${dd}`;
          }
          return undefined;
        };

        const suggestions = result.rows.map((row) => {
          const nameParts = row.name.split(' ');
          const firstName = nameParts[0] || row.name;
          const lastName = nameParts.slice(1).join(' ') || '';
          const disambiguator =
            (row.membership_number && row.membership_number.slice(-4)) || row.id.slice(0, 8);

          return {
            id: row.id,
            name: row.name,
            firstName,
            lastName,
            membershipNumber: row.membership_number || undefined,
            dobMonthDay: toMonthDay(row.dob),
            disambiguator,
          };
        });

        return reply.send({ suggestions });
      } catch (error) {
        request.log.error(error, 'Failed to search customers');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * POST /v1/customers/create-from-scan
   *
   * Creates (or returns existing) customer record derived from an ID scan that produced NO_MATCH.
   * Persists id_scan_hash + id_scan_value so subsequent scans match instantly.
   *
   * Auth required.
   */
  const CreateFromScanSchema = z
    .object({
      // Preferred: send normalized value + hash from /v1/checkin/scan response.
      idScanValue: z.string().min(1).optional(),
      idScanHash: z.string().min(16).optional(),
      // Fallback: raw scan text; server will normalize + hash.
      rawScanText: z.string().min(1).optional(),
      // Identity fields (minimum)
      firstName: z.string().min(1),
      lastName: z.string().min(1),
      dob: z.string().min(1),
      fullName: z.string().optional(),
      // Optional prefill fields (not currently persisted in DB schema)
      addressLine1: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      postalCode: z.string().optional(),
    })
    .refine((v) => Boolean(v.idScanValue || v.rawScanText), {
      message: 'idScanValue or rawScanText is required',
    });

  fastify.post(
    '/v1/customers/create-from-scan',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

      let body: z.infer<typeof CreateFromScanSchema>;
      try {
        body = CreateFromScanSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      const idScanValue = normalizeScanText(body.idScanValue || body.rawScanText || '');
      if (!idScanValue) {
        return reply.status(400).send({ error: 'Invalid scan input' });
      }

      const idScanHash = body.idScanHash || computeSha256Hex(idScanValue);
      const dob = toDateOnly(body.dob);
      if (!dob) {
        return reply.status(400).send({ error: 'Invalid dob; expected YYYY-MM-DD' });
      }

      const name = (body.fullName?.trim() || `${body.firstName} ${body.lastName}`.trim()).slice(
        0,
        255
      );
      if (!name) {
        return reply.status(400).send({ error: 'Invalid name' });
      }

      try {
        // Idempotent behavior: if another lane already created this customer, return it.
        const existing = await query<{
          id: string;
          name: string;
          dob: string | Date | null;
          membership_number: string | null;
          banned_until: Date | null;
          id_scan_hash: string | null;
          id_scan_value: string | null;
        }>(
          `SELECT id, name, dob, membership_number, banned_until, id_scan_hash, id_scan_value
         FROM customers
         WHERE id_scan_hash = $1 OR id_scan_value = $2
         LIMIT 1`,
          [idScanHash, idScanValue]
        );

        if (existing.rows.length > 0) {
          const row = existing.rows[0]!;
          if (row.banned_until && row.banned_until > new Date()) {
            return reply.status(403).send({ error: 'Customer is banned' });
          }

          // Backfill missing identifiers if needed.
          if (!row.id_scan_hash || !row.id_scan_value) {
            await query(
              `UPDATE customers
             SET id_scan_hash = COALESCE(id_scan_hash, $1),
                 id_scan_value = COALESCE(id_scan_value, $2),
                 updated_at = NOW()
             WHERE id = $3`,
              [idScanHash, idScanValue, row.id]
            );
          }

          return reply.send({
            created: false,
            customer: {
              id: row.id,
              name: row.name,
              dob: row.dob instanceof Date ? row.dob.toISOString().slice(0, 10) : row.dob,
              membershipNumber: row.membership_number,
            },
          });
        }

        const inserted = await query<{
          id: string;
          name: string;
          dob: Date | null;
          membership_number: string | null;
        }>(
          `INSERT INTO customers (name, dob, id_scan_hash, id_scan_value, created_at, updated_at)
         VALUES ($1, $2::date, $3, $4, NOW(), NOW())
         RETURNING id, name, dob, membership_number`,
          [name, dob, idScanHash, idScanValue]
        );

        const row = inserted.rows[0]!;
        return reply.send({
          created: true,
          customer: {
            id: row.id,
            name: row.name,
            dob: row.dob ? row.dob.toISOString().slice(0, 10) : null,
            membershipNumber: row.membership_number,
          },
        });
      } catch (error) {
        request.log.error(error, 'Failed to create customer from scan');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * POST /v1/customers/match-identity
   *
   * Staff-only endpoint for exact-ish identity match by (firstName,lastName,dob).
   * Used by manual "First Time Customer / Alternate ID" to avoid accidental duplicates.
   */
  const MatchIdentitySchema = z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    dob: z.string().min(1), // YYYY-MM-DD
  });

  fastify.post(
    '/v1/customers/match-identity',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

      let body: z.infer<typeof MatchIdentitySchema>;
      try {
        body = MatchIdentitySchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      const dob = toDateOnly(body.dob);
      if (!dob) return reply.status(400).send({ error: 'Invalid dob; expected YYYY-MM-DD' });

      const inputParts = splitNamePartsForMatch(`${body.firstName} ${body.lastName}`);
      if (!inputParts) return reply.status(400).send({ error: 'Invalid name' });

      try {
        const res = await query<{
          id: string;
          name: string;
          dob: string | Date | null;
          membership_number: string | null;
          created_at: Date;
        }>(
          `SELECT id, name, dob, membership_number, created_at
           FROM customers
           WHERE dob = $1::date
           ORDER BY created_at ASC
           LIMIT 50`,
          [dob]
        );

        const matches = res.rows
          .map((row) => {
            const parts = splitNamePartsForMatch(row.name);
            if (!parts) return null;
            const score =
              scoreNameSimilarity(inputParts, parts) + (row.membership_number ? 0.5 : 0);
            if (score < 1.5) return null;
            return {
              id: row.id,
              name: row.name,
              dob: row.dob instanceof Date ? row.dob.toISOString().slice(0, 10) : row.dob,
              membershipNumber: row.membership_number,
              score,
              createdAt: row.created_at,
            };
          })
          .filter(Boolean) as Array<{
          id: string;
          name: string;
          dob: string | null;
          membershipNumber: string | null;
          score: number;
          createdAt: Date;
        }>;

        matches.sort((a, b) => b.score - a.score || a.createdAt.getTime() - b.createdAt.getTime());
        const best = matches[0] ?? null;

        return reply.send({
          matchCount: matches.length,
          bestMatch: best
            ? {
                id: best.id,
                name: best.name,
                dob: best.dob,
                membershipNumber: best.membershipNumber,
              }
            : null,
        });
      } catch (error) {
        request.log.error(error, 'Failed to match customer identity');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * POST /v1/customers/create-manual
   *
   * Staff-only endpoint to create a customer record from manual entry (firstName,lastName,dob).
   * This intentionally does NOT de-dupe; caller should use /match-identity first if desired.
   */
  const CreateManualSchema = z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    dob: z.string().min(1), // YYYY-MM-DD
  });

  fastify.post(
    '/v1/customers/create-manual',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

      let body: z.infer<typeof CreateManualSchema>;
      try {
        body = CreateManualSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      const dob = toDateOnly(body.dob);
      if (!dob) return reply.status(400).send({ error: 'Invalid dob; expected YYYY-MM-DD' });

      const name = `${body.firstName} ${body.lastName}`.trim().slice(0, 255);
      if (!name) return reply.status(400).send({ error: 'Invalid name' });

      try {
        const inserted = await query<{
          id: string;
          name: string;
          dob: Date | null;
          membership_number: string | null;
        }>(
          `INSERT INTO customers (name, dob, created_at, updated_at)
           VALUES ($1, $2::date, NOW(), NOW())
           RETURNING id, name, dob, membership_number`,
          [name, dob]
        );

        const row = inserted.rows[0]!;
        return reply.send({
          created: true,
          customer: {
            id: row.id,
            name: row.name,
            dob: row.dob ? row.dob.toISOString().slice(0, 10) : null,
            membershipNumber: row.membership_number,
          },
        });
      } catch (error) {
        request.log.error(error, 'Failed to create customer (manual)');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
