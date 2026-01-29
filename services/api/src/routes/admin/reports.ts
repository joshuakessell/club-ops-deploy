import type { FastifyInstance } from 'fastify';
import { requireAdmin, requireAuth } from '../../auth/middleware';
import { query } from '../../db';

export function registerAdminReportRoutes(fastify: FastifyInstance): void {
  /**
   * GET /v1/admin/reports/cash-totals - Demo cash totals for today
   *
   * Uses payment_intents marked PAID today; groups by payment_method and register_number.
   */
  fastify.get(
    '/v1/admin/reports/cash-totals',
    {
      preHandler: [requireAuth, requireAdmin],
    },
    async (request, reply) => {
      try {
        const totals = await query<{ total: string | null }>(
          `SELECT COALESCE(SUM(amount), 0)::numeric(10,2) as total
         FROM payment_intents
         WHERE status = 'PAID'
           AND paid_at >= date_trunc('day', NOW())
           AND paid_at <  date_trunc('day', NOW()) + INTERVAL '1 day'`
        );

        const byMethod = await query<{ payment_method: string | null; total: string | null }>(
          `SELECT payment_method, COALESCE(SUM(amount), 0)::numeric(10,2) as total
         FROM payment_intents
         WHERE status = 'PAID'
           AND paid_at >= date_trunc('day', NOW())
           AND paid_at <  date_trunc('day', NOW()) + INTERVAL '1 day'
         GROUP BY payment_method`
        );

        const byRegister = await query<{ register_number: number | null; total: string | null }>(
          `SELECT register_number, COALESCE(SUM(amount), 0)::numeric(10,2) as total
         FROM payment_intents
         WHERE status = 'PAID'
           AND paid_at >= date_trunc('day', NOW())
           AND paid_at <  date_trunc('day', NOW()) + INTERVAL '1 day'
         GROUP BY register_number
         ORDER BY register_number NULLS LAST`
        );

        const byPaymentMethod: Record<string, number> = {};
        for (const row of byMethod.rows) {
          const key = row.payment_method || 'UNKNOWN';
          byPaymentMethod[key] = parseFloat(String(row.total || 0));
        }

        const byRegisterOut: Record<string, number> = {};
        for (const row of byRegister.rows) {
          const key = row.register_number ? `Register ${row.register_number}` : 'Unassigned';
          byRegisterOut[key] = parseFloat(String(row.total || 0));
        }

        // Ensure stable keys for the demo UI
        byPaymentMethod.CASH ??= 0;
        byPaymentMethod.CREDIT ??= 0;
        byRegisterOut['Register 1'] ??= 0;
        byRegisterOut['Register 2'] ??= 0;
        byRegisterOut['Register 3'] ??= 0;

        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');

        return reply.send({
          date: `${yyyy}-${mm}-${dd}`,
          total: parseFloat(String(totals.rows[0]?.total || 0)),
          byPaymentMethod,
          byRegister: byRegisterOut,
        });
      } catch (error) {
        request.log.error(error, 'Failed to build cash totals');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
