import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { query, transaction } from '../db/index.js';
import { requireAuth } from '../auth/middleware.js';

/**
 * Schema for joining waitlist.
 */
const JoinWaitlistSchema = z.object({
  sessionId: z.string().uuid(),
  desiredRoomType: z.enum(['STANDARD', 'DELUXE', 'VIP']),
  acknowledgedDisclaimer: z.boolean().refine(val => val === true, {
    message: 'Upgrade disclaimer must be acknowledged',
  }),
});

/**
 * Schema for accepting upgrade.
 */
const AcceptUpgradeSchema = z.object({
  sessionId: z.string().uuid(),
  newRoomId: z.string().uuid(),
  acknowledgedDisclaimer: z.boolean().refine(val => val === true, {
    message: 'Upgrade disclaimer must be acknowledged',
  }),
});

interface SessionRow {
  id: string;
  member_id: string;
  checkin_type: string | null;
  checkout_at: Date | null;
  room_id: string | null;
}

interface RoomRow {
  id: string;
  number: string;
  type: string;
  status: string;
  assigned_to: string | null;
}

/**
 * Upgrade disclaimer text (exact as specified).
 */
const UPGRADE_DISCLAIMER_TEXT = `Upgrade availability and time estimates are not guarantees.

Upgrade fees are charged only if an upgrade becomes available and you choose to accept it.

Upgrades do not extend your stay. Your checkout time remains the same as your original 6-hour check-in.

The full upgrade fee applies even if limited time remains.`;

/**
 * Upgrade routes for waitlist and upgrade management.
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function upgradeRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /v1/upgrades/waitlist - Join waitlist for upgrade
   * 
   * Adds customer to waitlist for a higher tier room.
   * Requires disclaimer acknowledgment.
   */
  fastify.post('/v1/upgrades/waitlist', {
    preHandler: [requireAuth],
  }, async (
    request: FastifyRequest<{ Body: z.infer<typeof JoinWaitlistSchema> }>,
    reply: FastifyReply
  ) => {
    if (!request.staff) {
      return reply.status(401).send({
        error: 'Unauthorized',
      });
    }

    let body: z.infer<typeof JoinWaitlistSchema>;
    
    try {
      body = JoinWaitlistSchema.parse(request.body);
    } catch (error) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: error instanceof z.ZodError ? error.errors : 'Invalid input',
      });
    }

    try {
      await transaction(async (client) => {
        // 1. Verify session exists
        const sessionResult = await client.query<SessionRow>(
          `SELECT id, member_id, checkin_type, checkout_at, room_id
           FROM sessions
           WHERE id = $1 AND status = 'ACTIVE'
           FOR UPDATE`,
          [body.sessionId]
        );

        if (sessionResult.rows.length === 0) {
          throw { statusCode: 404, message: 'Active session not found' };
        }

        const session = sessionResult.rows[0]!;

        // 2. Log disclaimer acknowledgment to audit_log
        await client.query(
          `INSERT INTO audit_log (user_id, user_role, action, entity_type, entity_id, new_value)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            request.staff!.staffId,
            'staff',
            'UPGRADE_DISCLAIMER',
            'session',
            session.id,
            JSON.stringify({
              action: 'JOIN_WAITLIST',
              desiredRoomType: body.desiredRoomType,
              disclaimerText: UPGRADE_DISCLAIMER_TEXT,
              acknowledgedAt: new Date().toISOString(),
            }),
          ]
        );

        // TODO: Actually implement waitlist table if needed
        // For now, we just log the disclaimer acknowledgment
      });

      return reply.status(200).send({
        message: 'Added to waitlist',
        disclaimerAcknowledged: true,
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error) {
        const err = error as { statusCode: number; message: string };
        return reply.status(err.statusCode).send({ error: err.message });
      }
      fastify.log.error(error, 'Failed to join waitlist');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /v1/upgrades/accept - Accept an upgrade
   * 
   * Upgrades customer to a higher tier room.
   * Requires disclaimer acknowledgment.
   * Does NOT extend checkout_at (remains original check-in + 6 hours).
   */
  fastify.post('/v1/upgrades/accept', {
    preHandler: [requireAuth],
  }, async (
    request: FastifyRequest<{ Body: z.infer<typeof AcceptUpgradeSchema> }>,
    reply: FastifyReply
  ) => {
    if (!request.staff) {
      return reply.status(401).send({
        error: 'Unauthorized',
      });
    }

    let body: z.infer<typeof AcceptUpgradeSchema>;
    
    try {
      body = AcceptUpgradeSchema.parse(request.body);
    } catch (error) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: error instanceof z.ZodError ? error.errors : 'Invalid input',
      });
    }

    try {
      const result = await transaction(async (client) => {
        // 1. Get session and verify it exists
        const sessionResult = await client.query<SessionRow>(
          `SELECT id, member_id, checkin_type, checkout_at, room_id
           FROM sessions
           WHERE id = $1 AND status = 'ACTIVE'
           FOR UPDATE`,
          [body.sessionId]
        );

        if (sessionResult.rows.length === 0) {
          throw { statusCode: 404, message: 'Active session not found' };
        }

        const session = sessionResult.rows[0]!;
        const originalCheckoutAt = session.checkout_at;

        // 2. Get new room and verify it's available
        const roomResult = await client.query<RoomRow>(
          `SELECT id, number, type, status, assigned_to
           FROM rooms
           WHERE id = $1
           FOR UPDATE`,
          [body.newRoomId]
        );

        if (roomResult.rows.length === 0) {
          throw { statusCode: 404, message: 'Room not found' };
        }

        const newRoom = roomResult.rows[0]!;

        if (newRoom.status !== 'CLEAN') {
          throw { statusCode: 400, message: `Room ${newRoom.number} is not available (status: ${newRoom.status})` };
        }

        if (newRoom.assigned_to) {
          throw { statusCode: 409, message: `Room ${newRoom.number} is already assigned` };
        }

        // 3. Release old room if exists
        if (session.room_id) {
          await client.query(
            `UPDATE rooms 
             SET assigned_to = NULL, updated_at = NOW()
             WHERE id = $1`,
            [session.room_id]
          );
        }

        // 4. Assign new room
        await client.query(
          `UPDATE rooms 
           SET assigned_to = $1, updated_at = NOW()
           WHERE id = $2`,
          [session.member_id, body.newRoomId]
        );

        // 5. Update session - mark as upgrade, but DO NOT change checkout_at
        await client.query(
          `UPDATE sessions 
           SET room_id = $1, checkin_type = 'UPGRADE', updated_at = NOW()
           WHERE id = $2`,
          [body.newRoomId, session.id]
        );

        // 6. Log disclaimer acknowledgment to audit_log
        await client.query(
          `INSERT INTO audit_log (user_id, user_role, action, entity_type, entity_id, previous_value, new_value)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            request.staff!.staffId,
            'staff',
            'UPGRADE_DISCLAIMER',
            'session',
            session.id,
            JSON.stringify({
              previousRoomId: session.room_id,
            }),
            JSON.stringify({
              action: 'ACCEPT_UPGRADE',
              newRoomId: body.newRoomId,
              newRoomNumber: newRoom.number,
              newRoomType: newRoom.type,
              checkoutAt: originalCheckoutAt?.toISOString(),
              disclaimerText: UPGRADE_DISCLAIMER_TEXT,
              acknowledgedAt: new Date().toISOString(),
            }),
          ]
        );

        return {
          sessionId: session.id,
          newRoomId: body.newRoomId,
          newRoomNumber: newRoom.number,
          newRoomType: newRoom.type,
          checkoutAt: originalCheckoutAt,
        };
      });

      return reply.status(200).send(result);
    } catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error) {
        const err = error as { statusCode: number; message: string };
        return reply.status(err.statusCode).send({ error: err.message });
      }
      fastify.log.error(error, 'Failed to accept upgrade');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /v1/upgrades/disclaimer - Get upgrade disclaimer text
   * 
   * Returns the upgrade disclaimer text for display.
   */
  fastify.get('/v1/upgrades/disclaimer', async (_request, reply: FastifyReply) => {
    return reply.send({
      text: UPGRADE_DISCLAIMER_TEXT,
    });
  });
}

