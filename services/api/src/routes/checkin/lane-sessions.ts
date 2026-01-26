import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../auth/middleware';
import { transaction } from '../../db';
import type { LaneSessionRow } from '../../checkin/types';

export function registerCheckinLaneSessionsRoutes(fastify: FastifyInstance): void {
  /**
   * GET /v1/checkin/lane-sessions
   *
   * Get all active lane sessions for office dashboard.
   * Auth required.
   */
  fastify.get(
    '/v1/checkin/lane-sessions',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      try {
        const result = await query<LaneSessionRow>(
          `SELECT 
          ls.*,
          s.name as staff_name,
          c.name as customer_name,
          c.membership_number,
          r.number as room_number,
          l.number as locker_number
         FROM lane_sessions ls
         LEFT JOIN staff s ON ls.staff_id = s.id
         LEFT JOIN customers c ON ls.customer_id = c.id
         LEFT JOIN rooms r ON ls.assigned_resource_id = r.id AND ls.desired_rental_type NOT IN ('LOCKER', 'GYM_LOCKER')
         LEFT JOIN lockers l ON ls.assigned_resource_id = l.id AND ls.desired_rental_type IN ('LOCKER', 'GYM_LOCKER')
         WHERE ls.status != 'COMPLETED' AND ls.status != 'CANCELLED'
         ORDER BY ls.created_at DESC`
        );

        const sessions = result.rows.map((session) => ({
          id: session.id,
          laneId: session.lane_id,
          status: session.status,
          staffName: (session as any).staff_name,
          customerName: session.customer_display_name || (session as any).customer_name,
          membershipNumber: session.membership_number,
          desiredRentalType: session.desired_rental_type,
          waitlistDesiredType: session.waitlist_desired_type,
          backupRentalType: session.backup_rental_type,
          assignedResource: session.assigned_resource_id
            ? {
                id: session.assigned_resource_id,
                number: (session as any).room_number || (session as any).locker_number,
                type: session.desired_rental_type,
              }
            : null,
          priceQuote: session.price_quote_json,
          paymentIntentId: session.payment_intent_id,
          createdAt: session.created_at,
          updatedAt: session.updated_at,
        }));

        return reply.send({ sessions });
      } catch (error: unknown) {
        request.log.error(error, 'Failed to fetch lane sessions');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to fetch lane sessions',
        });
      }
    }
  );

  /**
   * Helper function to check past-due balance and bypass status.
   * Returns true if customer is blocked by past-due balance.
   */
  async function checkPastDueBlocked(
    client: Parameters<Parameters<typeof transaction>[0]>[0],
    customerId: string | null,
    sessionBypassed: boolean
  ): Promise<{ blocked: boolean; balance: number }> {
    if (!customerId) {
      return { blocked: false, balance: 0 };
    }

    const customerResult = await client.query<CustomerRow>(
      `SELECT past_due_balance FROM customers WHERE id = $1`,
      [customerId]
    );

    if (customerResult.rows.length === 0) {
      return { blocked: false, balance: 0 };
    }

    const balance = parseFloat(String(customerResult.rows[0]!.past_due_balance || 0));
    const blocked = balance > 0 && !sessionBypassed;

    return { blocked, balance };
  }
}
