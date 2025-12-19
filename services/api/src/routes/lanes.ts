import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { query, transaction } from '../db/index.js';
import { requireAuth } from '../auth/middleware.js';
import type { Broadcaster } from '../websocket/broadcaster.js';
import type { SessionUpdatedPayload } from '@club-ops/shared';

declare module 'fastify' {
  interface FastifyInstance {
    broadcaster: Broadcaster;
  }
}

interface SessionRow {
  id: string;
  member_id: string | null;
  member_name: string;
  membership_number: string | null;
  lane: string;
  status: string;
}

interface MemberRow {
  id: string;
  name: string;
  membership_number: string | null;
  is_active: boolean;
}

/**
 * Check if a membership number is eligible for Gym Locker rental.
 * Eligibility is determined by configurable numeric ranges in GYM_LOCKER_ELIGIBLE_RANGES.
 * Format: "1000-1999,5000-5999" (comma-separated ranges)
 */
function isGymLockerEligible(membershipNumber: string | null | undefined): boolean {
  if (!membershipNumber) {
    return false;
  }

  const rangesEnv = process.env.GYM_LOCKER_ELIGIBLE_RANGES || '';
  if (!rangesEnv.trim()) {
    return false;
  }

  // Parse membership number as integer
  const membershipNum = parseInt(membershipNumber, 10);
  if (isNaN(membershipNum)) {
    return false;
  }

  // Parse ranges (e.g., "1000-1999,5000-5999")
  const ranges = rangesEnv.split(',').map(range => range.trim()).filter(Boolean);
  
  for (const range of ranges) {
    const [startStr, endStr] = range.split('-').map(s => s.trim());
    const start = parseInt(startStr || '', 10);
    const end = parseInt(endStr || '', 10);
    
    if (!isNaN(start) && !isNaN(end) && membershipNum >= start && membershipNum <= end) {
      return true;
    }
  }

  return false;
}

/**
 * Determine allowed rentals based on membership eligibility.
 */
function getAllowedRentals(membershipNumber: string | null | undefined): string[] {
  const allowed: string[] = ['LOCKER', 'STANDARD', 'DELUXE'];
  
  if (isGymLockerEligible(membershipNumber)) {
    allowed.push('GYM_LOCKER');
  }
  
  return allowed;
}

/**
 * Schema for creating or updating a lane session.
 */
const LaneSessionSchema = z.object({
  customerName: z.string().min(1),
  membershipNumber: z.string().nullable().optional(),
});

type LaneSessionInput = z.infer<typeof LaneSessionSchema>;

/**
 * Lane session management routes.
 */
export async function laneRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /v1/lanes/:laneId/session - Create or update lane session
   * 
   * Creates or updates a session for a specific lane.
   * Broadcasts SESSION_UPDATED event to the lane.
   * Auth required.
   */
  fastify.post('/v1/lanes/:laneId/session', {
    preHandler: [requireAuth],
  }, async (
    request: FastifyRequest<{ 
      Params: { laneId: string };
      Body: LaneSessionInput;
    }>,
    reply: FastifyReply
  ) => {
    if (!request.staff) {
      return reply.status(401).send({
        error: 'Unauthorized',
      });
    }

    const { laneId } = request.params;
    let body: LaneSessionInput;

    try {
      body = LaneSessionSchema.parse(request.body);
    } catch (error) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: error instanceof z.ZodError ? error.errors : 'Invalid input',
      });
    }

    try {
      const result = await transaction(async (client) => {
        // Check for existing active session in this lane
        const existingSession = await client.query<SessionRow>(
          `SELECT id, member_id, member_name, membership_number, lane, status
           FROM sessions 
           WHERE lane = $1 AND status = 'ACTIVE'
           ORDER BY created_at DESC
           LIMIT 1`,
          [laneId]
        );

        let session: SessionRow;
        const membershipNumber = body.membershipNumber || null;

        if (existingSession.rows.length > 0) {
          // Update existing session
          const existing = existingSession.rows[0]!;
          const updateResult = await client.query<SessionRow>(
            `UPDATE sessions 
             SET member_name = $1, membership_number = $2, updated_at = NOW()
             WHERE id = $3
             RETURNING id, member_id, member_name, membership_number, lane, status`,
            [body.customerName, membershipNumber, existing.id]
          );
          session = updateResult.rows[0]!;
        } else {
          // Create new session
          const newSessionResult = await client.query<SessionRow>(
            `INSERT INTO sessions (member_name, membership_number, expected_duration, status, lane)
             VALUES ($1, $2, 60, 'ACTIVE', $3)
             RETURNING id, member_id, member_name, membership_number, lane, status`,
            [body.customerName, membershipNumber, laneId]
          );
          session = newSessionResult.rows[0]!;
        }

        // Determine allowed rentals
        const allowedRentals = getAllowedRentals(membershipNumber);

        // Broadcast SESSION_UPDATED event to the specific lane
        const payload: SessionUpdatedPayload = {
          sessionId: session.id,
          customerName: session.member_name,
          membershipNumber: session.membership_number || undefined,
          allowedRentals,
        };

        fastify.broadcaster.broadcastSessionUpdated(payload, laneId);

        return {
          sessionId: session.id,
          customerName: session.member_name,
          membershipNumber: session.membership_number || undefined,
          allowedRentals,
        };
      });

      return reply.send(result);
    } catch (error) {
      request.log.error(error, 'Failed to create/update lane session');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to process session',
      });
    }
  });

  /**
   * POST /v1/lanes/:laneId/clear - Clear lane session
   * 
   * Cancels the active session for a specific lane.
   * Broadcasts SESSION_UPDATED event with null/empty data to clear the kiosk.
   * Auth required.
   */
  fastify.post('/v1/lanes/:laneId/clear', {
    preHandler: [requireAuth],
  }, async (
    request: FastifyRequest<{ Params: { laneId: string } }>,
    reply: FastifyReply
  ) => {
    if (!request.staff) {
      return reply.status(401).send({
        error: 'Unauthorized',
      });
    }

    const { laneId } = request.params;

    try {
      await transaction(async (client) => {
        // Cancel all active sessions in this lane
        await client.query(
          `UPDATE sessions 
           SET status = 'CANCELLED', updated_at = NOW()
           WHERE lane = $1 AND status = 'ACTIVE'`,
          [laneId]
        );
      });

      // Broadcast empty session to clear the kiosk
      const payload: SessionUpdatedPayload = {
        sessionId: '',
        customerName: '',
        membershipNumber: undefined,
        allowedRentals: [],
      };

      fastify.broadcaster.broadcastSessionUpdated(payload, laneId);

      return reply.send({ success: true });
    } catch (error) {
      request.log.error(error, 'Failed to clear lane session');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to clear session',
      });
    }
  });
}

