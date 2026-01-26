import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../auth/middleware';
import { insertAuditLog } from '../../audit/auditLog';
import { buildFullSessionUpdatedPayload } from '../../checkin/payload';
import type { LaneSessionRow } from '../../checkin/types';
import { getHttpError } from '../../checkin/utils';
import { transaction } from '../../db';

export function registerCheckinNoteRoutes(fastify: FastifyInstance): void {
  /**
   * POST /v1/checkin/lane/:laneId/add-note
   *
   * Add a note to the customer record (staff only, admin removal in office-dashboard).
   */
  fastify.post<{ Params: { laneId: string }; Body: { note: string } }>(
    '/v1/checkin/lane/:laneId/add-note',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const staff = request.staff;
      if (!staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const { laneId } = request.params;
      const { note } = request.body;

      if (!note || !note.trim()) {
        return reply.status(400).send({ error: 'Note is required' });
      }

      try {
        const result = await transaction(async (client) => {
          const sessionResult = await client.query<LaneSessionRow>(
            `SELECT * FROM lane_sessions
           WHERE lane_id = $1 AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE')
           ORDER BY created_at DESC
           LIMIT 1`,
            [laneId]
          );

          if (sessionResult.rows.length === 0) {
            throw { statusCode: 404, message: 'No active session found' };
          }

          const session = sessionResult.rows[0]!;

          if (!session.customer_id) {
            throw { statusCode: 400, message: 'Session has no customer' };
          }

          // Get existing notes
          const customerResult = await client.query<CustomerRow>(
            `SELECT notes FROM customers WHERE id = $1`,
            [session.customer_id]
          );

          if (customerResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Customer not found' };
          }

          const existingNotes = customerResult.rows[0]!.notes || '';
          const timestamp = new Date().toISOString();
          const staffName = staff.name || 'Staff';
          const newNoteEntry = `[${timestamp}] ${staffName}: ${note.trim()}`;
          const updatedNotes = existingNotes ? `${existingNotes}\n${newNoteEntry}` : newNoteEntry;

          // Update customer notes
          await client.query(`UPDATE customers SET notes = $1, updated_at = NOW() WHERE id = $2`, [
            updatedNotes,
            session.customer_id,
          ]);

          return { sessionId: session.id, success: true, note: newNoteEntry };
        });

        const { payload } = await transaction((client) =>
          buildFullSessionUpdatedPayload(client, result.sessionId)
        );
        fastify.broadcaster.broadcastSessionUpdated(payload, laneId);

        return reply.send(result);
      } catch (error: unknown) {
        request.log.error(error, 'Failed to add note');
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message?: string };
          return reply.status(err.statusCode).send({
            error: err.message || 'Failed to add note',
          });
        }
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to add note',
        });
      }
    }
  );
}
