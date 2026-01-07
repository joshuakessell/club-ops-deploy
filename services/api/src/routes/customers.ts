import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db/index.js';
import { requireAuth } from '../auth/middleware.js';

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

// eslint-disable-next-line @typescript-eslint/require-await
export async function customerRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /v1/customers/search - Prefix search by first or last name (case-insensitive).
   * Requires staff auth; returns limited identity fields only.
   */
  fastify.get<{
    Querystring: z.infer<typeof SearchQuerySchema>;
  }>('/v1/customers/search', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
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
          (row.membership_number && row.membership_number.slice(-4)) ||
          row.id.slice(0, 8);

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
  });
}

