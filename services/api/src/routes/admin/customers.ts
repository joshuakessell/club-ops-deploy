import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, transaction } from '../../db';
import { requireAdmin, requireAuth, requireReauthForAdmin } from '../../auth/middleware';
import { insertAuditLog } from '../../audit/auditLog';

export function registerAdminCustomerRoutes(fastify: FastifyInstance): void {
  /**
   * GET /v1/admin/customers - Search customers (admin)
   *
   * Used by office-dashboard Customer Admin Tools.
   */
  fastify.get<{
    Querystring: {
      search?: string;
      limit?: string;
    };
  }>(
    '/v1/admin/customers',
    {
      preHandler: [requireAuth, requireAdmin],
    },
    async (request, reply) => {
      const search = (request.query.search || '').trim();
      const limit = Math.min(Math.max(parseInt(request.query.limit || '25', 10) || 25, 1), 100);

      if (search.length < 2) {
        return reply.send({ customers: [] });
      }

      try {
        const result = await query<{
          id: string;
          name: string;
          membership_number: string | null;
          primary_language: string | null;
          notes: string | null;
          past_due_balance: string | number | null;
        }>(
          `SELECT id, name, membership_number, primary_language, notes, past_due_balance
         FROM customers
         WHERE name ILIKE $1 OR membership_number ILIKE $1
         ORDER BY name ASC
         LIMIT $2`,
          [`%${search}%`, limit]
        );

        return reply.send({
          customers: result.rows.map((r) => ({
            id: r.id,
            name: r.name,
            membershipNumber: r.membership_number,
            primaryLanguage: (r.primary_language as 'EN' | 'ES' | null) || null,
            notes: r.notes,
            pastDueBalance: parseFloat(String(r.past_due_balance || 0)),
          })),
        });
      } catch (error) {
        request.log.error(error, 'Failed to search customers');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * PATCH /v1/admin/customers/:id - Update admin-controlled customer fields
   *
   * Admin-only and requires step-up re-auth (PIN or WebAuthn).
   * Supported edits (demo):
   * - notes (clear/remove)
   * - pastDueBalance (waive)
   */
  fastify.patch<{
    Params: { id: string };
    Body: {
      notes?: string | null;
      pastDueBalance?: number;
    };
  }>(
    '/v1/admin/customers/:id',
    {
      preHandler: [requireReauthForAdmin],
    },
    async (request, reply) => {
      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
      const auditStaffId = request.staff.staffId;
      const auditStaffRole = request.staff.role;

      const UpdateSchema = z
        .object({
          notes: z.string().nullable().optional(),
          pastDueBalance: z.number().min(0).optional(),
        })
        .refine((b) => b.notes !== undefined || b.pastDueBalance !== undefined, {
          message: 'At least one field is required',
        });

      let body: z.infer<typeof UpdateSchema>;
      try {
        body = UpdateSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      try {
        const result = await transaction(async (client) => {
          const existing = await client.query<{
            id: string;
            notes: string | null;
            past_due_balance: string | number | null;
            primary_language: string | null;
            name: string;
            membership_number: string | null;
          }>(
            `SELECT id, name, membership_number, primary_language, notes, past_due_balance
           FROM customers
           WHERE id = $1
           FOR UPDATE`,
            [request.params.id]
          );

          if (existing.rows.length === 0) {
            throw { statusCode: 404, message: 'Customer not found' };
          }

          const before = existing.rows[0]!;
          const updates: string[] = [];
          const params: unknown[] = [];
          let idx = 1;

          if (body.notes !== undefined) {
            const normalized = body.notes && body.notes.trim() ? body.notes : null;
            updates.push(`notes = $${idx}`);
            params.push(normalized);
            idx++;
          }

          if (body.pastDueBalance !== undefined) {
            updates.push(`past_due_balance = $${idx}`);
            params.push(body.pastDueBalance);
            idx++;
          }

          params.push(request.params.id);

          const updated = await client.query<{
            id: string;
            name: string;
            membership_number: string | null;
            primary_language: string | null;
            notes: string | null;
            past_due_balance: string | number | null;
          }>(
            `UPDATE customers
           SET ${updates.join(', ')}, updated_at = NOW()
           WHERE id = $${idx}
           RETURNING id, name, membership_number, primary_language, notes, past_due_balance`,
            params
          );

          const after = updated.rows[0]!;

          await insertAuditLog(client, {
            staffId: auditStaffId,
            userId: auditStaffId,
            userRole: auditStaffRole,
            action: 'UPDATE',
            entityType: 'customer',
            entityId: request.params.id,
            oldValue: {
              notes: before.notes,
              pastDueBalance: parseFloat(String(before.past_due_balance || 0)),
            },
            newValue: {
              notes: after.notes,
              pastDueBalance: parseFloat(String(after.past_due_balance || 0)),
            },
          });

          return after;
        });

        return reply.send({
          id: result.id,
          name: result.name,
          membershipNumber: result.membership_number,
          primaryLanguage: (result.primary_language as 'EN' | 'ES' | null) || null,
          notes: result.notes,
          pastDueBalance: parseFloat(String(result.past_due_balance || 0)),
        });
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const statusCode = (error as { statusCode: number }).statusCode;
          const message = (error as { message?: string }).message;
          return reply.status(statusCode).send({
            error: message ?? 'Failed to update customer',
          });
        }
        request.log.error(error, 'Failed to update customer');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
