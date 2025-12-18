import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { serializableTransaction, query } from '../db/index.js';
import type { Broadcaster } from '../websocket/broadcaster.js';

/**
 * Schema for creating a new session.
 */
const CreateSessionSchema = z.object({
  memberId: z.string().uuid(),
  roomId: z.string().uuid().optional(),
  lockerId: z.string().uuid().optional(),
  expectedDuration: z.number().int().positive().default(60), // in minutes
});

type CreateSessionInput = z.infer<typeof CreateSessionSchema>;

interface SessionRow {
  id: string;
  member_id: string;
  member_name: string;
  room_id: string | null;
  locker_id: string | null;
  check_in_time: Date;
  expected_duration: number;
  status: string;
}

interface MemberRow {
  id: string;
  name: string;
  is_active: boolean;
}

interface RoomRow {
  id: string;
  number: string;
  status: string;
  assigned_to: string | null;
}

interface LockerRow {
  id: string;
  number: string;
  status: string;
  assigned_to: string | null;
}

declare module 'fastify' {
  interface FastifyInstance {
    broadcaster: Broadcaster;
  }
}

/**
 * Session management routes.
 * Handles check-in/check-out operations.
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function sessionRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /v1/sessions - Create a new check-in session
   * 
   * Creates a session for a member, optionally assigning a room and/or locker.
   * Uses serializable transactions to prevent double-booking.
   */
  fastify.post('/v1/sessions', async (
    request: FastifyRequest<{ Body: CreateSessionInput }>,
    reply: FastifyReply
  ) => {
    let body: CreateSessionInput;
    
    try {
      body = CreateSessionSchema.parse(request.body);
    } catch (error) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: error instanceof z.ZodError ? error.errors : 'Invalid input',
      });
    }

    try {
      const session = await serializableTransaction(async (client) => {
        // 1. Verify member exists and is active
        const memberResult = await client.query<MemberRow>(
          'SELECT id, name, is_active FROM members WHERE id = $1',
          [body.memberId]
        );

        if (memberResult.rows.length === 0) {
          throw { statusCode: 404, message: 'Member not found' };
        }

        const member = memberResult.rows[0]!;
        if (!member.is_active) {
          throw { statusCode: 400, message: 'Member account is not active' };
        }

        // 2. Check for existing active session
        const existingSession = await client.query(
          `SELECT id FROM sessions WHERE member_id = $1 AND status = 'ACTIVE'`,
          [body.memberId]
        );

        if (existingSession.rows.length > 0) {
          throw { statusCode: 409, message: 'Member already has an active session' };
        }

        // 3. Handle room assignment if requested
        let assignedRoomId: string | null = null;
        if (body.roomId) {
          const roomResult = await client.query<RoomRow>(
            `SELECT id, number, status, assigned_to FROM rooms 
             WHERE id = $1 FOR UPDATE`,
            [body.roomId]
          );

          if (roomResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Room not found' };
          }

          const room = roomResult.rows[0]!;
          if (room.status !== 'CLEAN') {
            throw { statusCode: 400, message: `Room ${room.number} is not available (status: ${room.status})` };
          }

          if (room.assigned_to) {
            throw { statusCode: 409, message: `Room ${room.number} is already assigned` };
          }

          // Mark room as assigned
          await client.query(
            `UPDATE rooms SET assigned_to = $1, updated_at = NOW() WHERE id = $2`,
            [body.memberId, body.roomId]
          );

          assignedRoomId = body.roomId;
        }

        // 4. Handle locker assignment if requested
        let assignedLockerId: string | null = null;
        if (body.lockerId) {
          const lockerResult = await client.query<LockerRow>(
            `SELECT id, number, status, assigned_to FROM lockers 
             WHERE id = $1 FOR UPDATE`,
            [body.lockerId]
          );

          if (lockerResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Locker not found' };
          }

          const locker = lockerResult.rows[0]!;
          if (locker.assigned_to) {
            throw { statusCode: 409, message: `Locker ${locker.number} is already assigned` };
          }

          // Mark locker as assigned
          await client.query(
            `UPDATE lockers SET assigned_to = $1, updated_at = NOW() WHERE id = $2`,
            [body.memberId, body.lockerId]
          );

          assignedLockerId = body.lockerId;
        }

        // 5. Create the session
        const sessionResult = await client.query<SessionRow>(
          `INSERT INTO sessions (member_id, member_name, room_id, locker_id, expected_duration, status)
           VALUES ($1, $2, $3, $4, $5, 'ACTIVE')
           RETURNING id, member_id, member_name, room_id, locker_id, check_in_time, expected_duration, status`,
          [body.memberId, member.name, assignedRoomId, assignedLockerId, body.expectedDuration]
        );

        // 6. Log the check-in to audit log
        const newSession = sessionResult.rows[0]!;
        await client.query(
          `INSERT INTO audit_log (user_id, user_role, action, entity_type, entity_id, new_value)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            'system', // TODO: Use actual staff ID from auth
            'staff',
            'CHECK_IN',
            'session',
            newSession.id,
            JSON.stringify({
              memberId: body.memberId,
              roomId: assignedRoomId,
              lockerId: assignedLockerId,
            }),
          ]
        );

        return newSession;
      });

      // Broadcast room assignment if applicable
      if (body.roomId && fastify.broadcaster) {
        fastify.broadcaster.broadcast({
          type: 'ROOM_ASSIGNED',
          payload: {
            roomId: body.roomId,
            sessionId: session.id,
            memberId: body.memberId,
          },
          timestamp: new Date().toISOString(),
        });

        // Also broadcast inventory update
        await broadcastInventoryUpdate(fastify.broadcaster);
      }

      return reply.status(201).send({
        id: session.id,
        memberId: session.member_id,
        memberName: session.member_name,
        roomId: session.room_id,
        lockerId: session.locker_id,
        checkInTime: session.check_in_time,
        expectedDuration: session.expected_duration,
        status: session.status,
      });

    } catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error) {
        const err = error as { statusCode: number; message: string };
        return reply.status(err.statusCode).send({ error: err.message });
      }
      fastify.log.error(error, 'Failed to create session');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /v1/sessions/active - List all active sessions
   */
  fastify.get('/v1/sessions/active', async (_request, reply: FastifyReply) => {
    try {
      const result = await query<SessionRow>(
        `SELECT id, member_id, member_name, room_id, locker_id, check_in_time, expected_duration, status
         FROM sessions 
         WHERE status = 'ACTIVE'
         ORDER BY check_in_time DESC`
      );

      const sessions = result.rows.map(row => ({
        id: row.id,
        memberId: row.member_id,
        memberName: row.member_name,
        roomId: row.room_id,
        lockerId: row.locker_id,
        checkInTime: row.check_in_time,
        expectedDuration: row.expected_duration,
        status: row.status,
      }));

      return reply.send({ sessions });
    } catch (error) {
      fastify.log.error(error, 'Failed to fetch active sessions');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}

/**
 * Helper to broadcast current inventory state.
 */
async function broadcastInventoryUpdate(broadcaster: Broadcaster): Promise<void> {
  const result = await query<{ status: string; room_type: string; count: string }>(
    `SELECT status, type as room_type, COUNT(*) as count
     FROM rooms
     WHERE type != 'LOCKER'
     GROUP BY status, type`
  );

  const lockerResult = await query<{ status: string; count: string }>(
    `SELECT status, COUNT(*) as count
     FROM lockers
     GROUP BY status`
  );

  // Build detailed inventory
  const byType: Record<string, { clean: number; cleaning: number; dirty: number; total: number }> = {};
  let overallClean = 0, overallCleaning = 0, overallDirty = 0;

  for (const row of result.rows) {
    if (!byType[row.room_type]) {
      byType[row.room_type] = { clean: 0, cleaning: 0, dirty: 0, total: 0 };
    }
    const count = parseInt(row.count, 10);
    const status = row.status.toLowerCase() as 'clean' | 'cleaning' | 'dirty';
    byType[row.room_type]![status] = count;
    byType[row.room_type]!.total += count;

    if (status === 'clean') overallClean += count;
    else if (status === 'cleaning') overallCleaning += count;
    else if (status === 'dirty') overallDirty += count;
  }

  let lockerClean = 0, lockerCleaning = 0, lockerDirty = 0;
  for (const row of lockerResult.rows) {
    const count = parseInt(row.count, 10);
    const status = row.status.toLowerCase() as 'clean' | 'cleaning' | 'dirty';
    if (status === 'clean') lockerClean = count;
    else if (status === 'cleaning') lockerCleaning = count;
    else if (status === 'dirty') lockerDirty = count;
  }

  broadcaster.broadcast({
    type: 'INVENTORY_UPDATED',
    payload: {
      inventory: {
        byType,
        overall: {
          clean: overallClean,
          cleaning: overallCleaning,
          dirty: overallDirty,
          total: overallClean + overallCleaning + overallDirty,
        },
        lockers: {
          clean: lockerClean,
          cleaning: lockerCleaning,
          dirty: lockerDirty,
          total: lockerClean + lockerCleaning + lockerDirty,
        },
      },
    },
    timestamp: new Date().toISOString(),
  });
}

export { broadcastInventoryUpdate };

