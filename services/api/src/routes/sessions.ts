import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { serializableTransaction, query } from '../db/index.js';
import type { Broadcaster } from '../websocket/broadcaster.js';
import type { SessionUpdatedPayload } from '@club-ops/shared';

/**
 * Schema for creating a new session.
 */
const CreateSessionSchema = z.object({
  customerId: z.string().uuid(),
  roomId: z.string().uuid().optional(),
  lockerId: z.string().uuid().optional(),
  expectedDuration: z.number().int().positive().default(360), // in minutes (6 hours default)
  checkinType: z.enum(['INITIAL', 'RENEWAL', 'UPGRADE']).optional().default('INITIAL'),
});

type CreateSessionInput = z.infer<typeof CreateSessionSchema>;

interface SessionRow {
  id: string;
  customer_id: string;
  member_name: string;
  membership_number: string | null;
  room_id: string | null;
  locker_id: string | null;
  check_in_time: Date;
  expected_duration: number;
  status: string;
  lane: string | null;
  agreement_signed?: boolean;
}

interface CustomerRow {
  id: string;
  name: string;
  membership_number: string | null;
  banned_until: Date | null;
}

interface RoomRow {
  id: string;
  number: string;
  status: string;
  assigned_to_customer_id: string | null;
}

interface LockerRow {
  id: string;
  number: string;
  status: string;
  assigned_to_customer_id: string | null;
}

declare module 'fastify' {
  interface FastifyInstance {
    broadcaster: Broadcaster;
  }
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
  const ranges = rangesEnv
    .split(',')
    .map((range) => range.trim())
    .filter(Boolean);

  for (const range of ranges) {
    const [startStr, endStr] = range.split('-').map((s) => s.trim());
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
  const allowed: string[] = ['STANDARD', 'DOUBLE', 'SPECIAL'];

  if (isGymLockerEligible(membershipNumber)) {
    allowed.push('GYM_LOCKER');
  }

  return allowed;
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
  fastify.post(
    '/v1/sessions',
    async (request: FastifyRequest<{ Body: CreateSessionInput }>, reply: FastifyReply) => {
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
          // 1. Verify customer exists
          const customerResult = await client.query<CustomerRow>(
            'SELECT id, name, membership_number, banned_until FROM customers WHERE id = $1',
            [body.customerId]
          );

          if (customerResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Customer not found' };
          }

          const customer = customerResult.rows[0]!;

          // Check if customer is banned
          if (customer.banned_until && customer.banned_until > new Date()) {
            throw { statusCode: 403, message: 'Customer is banned' };
          }

          // 2. Check for existing active session
          const existingSession = await client.query(
            `SELECT id FROM sessions WHERE customer_id = $1 AND status = 'ACTIVE'`,
            [body.customerId]
          );

          if (existingSession.rows.length > 0) {
            throw { statusCode: 409, message: 'Customer already has an active session' };
          }

          // 3. Handle room assignment if requested
          let assignedRoomId: string | null = null;
          if (body.roomId) {
            const roomResult = await client.query<RoomRow>(
              `SELECT id, number, status, assigned_to_customer_id FROM rooms 
             WHERE id = $1 FOR UPDATE`,
              [body.roomId]
            );

            if (roomResult.rows.length === 0) {
              throw { statusCode: 404, message: 'Room not found' };
            }

            const room = roomResult.rows[0]!;
            if (room.status !== 'CLEAN') {
              throw {
                statusCode: 400,
                message: `Room ${room.number} is not available (status: ${room.status})`,
              };
            }

            if (room.assigned_to_customer_id) {
              throw { statusCode: 409, message: `Room ${room.number} is already assigned` };
            }

            // Mark room as assigned
            await client.query(
              `UPDATE rooms SET assigned_to_customer_id = $1, updated_at = NOW() WHERE id = $2`,
              [body.customerId, body.roomId]
            );

            assignedRoomId = body.roomId;
          }

          // 4. Handle locker assignment if requested
          let assignedLockerId: string | null = null;
          if (body.lockerId) {
            const lockerResult = await client.query<LockerRow>(
              `SELECT id, number, status, assigned_to_customer_id FROM lockers 
             WHERE id = $1 FOR UPDATE`,
              [body.lockerId]
            );

            if (lockerResult.rows.length === 0) {
              throw { statusCode: 404, message: 'Locker not found' };
            }

            const locker = lockerResult.rows[0]!;
            if (locker.assigned_to_customer_id) {
              throw { statusCode: 409, message: `Locker ${locker.number} is already assigned` };
            }

            // Mark locker as assigned
            await client.query(
              `UPDATE lockers SET assigned_to_customer_id = $1, updated_at = NOW() WHERE id = $2`,
              [body.customerId, body.lockerId]
            );

            assignedLockerId = body.lockerId;
          }

          // 5. Create the session
          // For initial check-ins and renewals, always use 6 hours (360 minutes)
          // checkout_at is always check_in_time + 6 hours
          const duration = body.checkinType === 'UPGRADE' ? body.expectedDuration : 360;
          const checkoutAt = new Date(Date.now() + 360 * 60 * 1000); // 6 hours from now

          const sessionResult = await client.query<SessionRow>(
            `INSERT INTO sessions (customer_id, member_name, room_id, locker_id, expected_duration, status, checkin_type, checkout_at)
           VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6, $7)
           RETURNING id, customer_id, member_name, room_id, locker_id, check_in_time, expected_duration, status`,
            [
              body.customerId,
              customer.name,
              assignedRoomId,
              assignedLockerId,
              duration,
              body.checkinType || 'INITIAL',
              checkoutAt,
            ]
          );

          // 6. Log the check-in to audit log
          const newSession = sessionResult.rows[0]!;
          await client.query(
            `INSERT INTO audit_log (staff_id, action, entity_type, entity_id, new_value)
           VALUES ($1, $2, $3, $4, $5)`,
            [
              null, // TODO: Use actual staff ID from auth when available
              'CHECK_IN',
              'session',
              newSession.id,
              JSON.stringify({
                customerId: body.customerId,
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
              customerId: body.customerId,
            },
            timestamp: new Date().toISOString(),
          });

          // Also broadcast inventory update
          await broadcastInventoryUpdate(fastify.broadcaster);
        }

        // Get agreement_signed status
        const agreementStatusResult = await query<{ agreement_signed: boolean }>(
          'SELECT agreement_signed FROM sessions WHERE id = $1',
          [session.id]
        );

        return reply.status(201).send({
          id: session.id,
          customerId: session.customer_id,
          memberName: session.member_name,
          roomId: session.room_id,
          lockerId: session.locker_id,
          checkInTime: session.check_in_time,
          expectedDuration: session.expected_duration,
          status: session.status,
          agreementSigned: agreementStatusResult.rows[0]?.agreement_signed || false,
        });
      } catch (error) {
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message: string };
          return reply.status(err.statusCode).send({ error: err.message });
        }
        fastify.log.error(error, 'Failed to create session');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * GET /v1/sessions/active - List all active sessions
   */
  fastify.get('/v1/sessions/active', async (_request, reply: FastifyReply) => {
    try {
      const result = await query<SessionRow>(
        `SELECT id, customer_id, member_name, room_id, locker_id, check_in_time, expected_duration, status, agreement_signed
         FROM sessions 
         WHERE status = 'ACTIVE'
         ORDER BY check_in_time DESC`
      );

      const sessions = result.rows.map((row) => ({
        id: row.id,
        customerId: row.customer_id,
        memberName: row.member_name,
        roomId: row.room_id,
        lockerId: row.locker_id,
        checkInTime: row.check_in_time,
        expectedDuration: row.expected_duration,
        status: row.status,
        agreementSigned:
          (row as SessionRow & { agreement_signed?: boolean }).agreement_signed || false,
      }));

      return reply.send({ sessions });
    } catch (error) {
      fastify.log.error(error, 'Failed to fetch active sessions');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /v1/sessions/scan-id - Scan ID to create/update session with customer name
   *
   * Used by employee register when scanning customer ID.
   * Creates a new session or updates existing one with customer name.
   * Requires lane parameter for lane-scoped sessions.
   */
  const ScanIdSchema = z.object({
    idNumber: z.string().min(1),
    lane: z.string().min(1),
  });

  fastify.post(
    '/v1/sessions/scan-id',
    async (
      request: FastifyRequest<{ Body: z.infer<typeof ScanIdSchema> }>,
      reply: FastifyReply
    ) => {
      try {
        const body = ScanIdSchema.parse(request.body);

        // Look up customer by ID number or membership number
        const customerResult = await query<CustomerRow>(
          `SELECT id, name, membership_number, banned_until 
         FROM customers 
         WHERE id::text = $1 OR membership_number = $1 
         LIMIT 1`,
          [body.idNumber]
        );

        if (customerResult.rows.length === 0) {
          return reply.status(404).send({ error: 'Customer not found' });
        }

        const customer = customerResult.rows[0]!;
        if (customer.banned_until && customer.banned_until > new Date()) {
          return reply.status(403).send({ error: 'Customer is banned' });
        }

        // Check for existing active session in this lane or create new one
        const existingSession = await query<SessionRow>(
          `SELECT id, customer_id, member_name, membership_number, room_id, locker_id, check_in_time, expected_duration, status, lane, agreement_signed
         FROM sessions 
         WHERE lane = $1 AND status = 'ACTIVE'
         ORDER BY check_in_time DESC
         LIMIT 1`,
          [body.lane]
        );

        let session: SessionRow;
        if (existingSession.rows.length > 0) {
          // Update existing session with new customer info
          const existing = existingSession.rows[0]!;
          await query(
            `UPDATE sessions 
           SET customer_id = $1, member_name = $2, membership_number = $3, updated_at = NOW()
           WHERE id = $4
           RETURNING id, customer_id, member_name, membership_number, room_id, locker_id, check_in_time, expected_duration, status, lane`,
            [customer.id, customer.name, customer.membership_number, existing.id]
          );
          session = {
            ...existing,
            customer_id: customer.id,
            member_name: customer.name,
            membership_number: customer.membership_number,
          };
        } else {
          // Create new session
          const newSessionResult = await query<SessionRow>(
            `INSERT INTO sessions (customer_id, member_name, membership_number, expected_duration, status, lane, checkout_at)
             VALUES ($1, $2, $3, 360, 'ACTIVE', $4, NOW() + INTERVAL '6 hours')
             RETURNING id, customer_id, member_name, membership_number, room_id, locker_id, check_in_time, expected_duration, status, lane, agreement_signed`,
            [customer.id, customer.name, customer.membership_number, body.lane]
          );
          session = newSessionResult.rows[0]!;
        }

        // Determine allowed rentals
        const allowedRentals = getAllowedRentals(customer.membership_number);

        // Broadcast SESSION_UPDATED event to the specific lane
        const payload: SessionUpdatedPayload = {
          sessionId: session.id,
          customerName: session.member_name,
          membershipNumber: customer.membership_number || undefined,
          allowedRentals,
        };

        fastify.broadcaster.broadcastSessionUpdated(payload, body.lane);

        return reply.status(200).send({
          sessionId: session.id,
          customerName: session.member_name,
          membershipNumber: customer.membership_number || undefined,
          allowedRentals,
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            error: 'Validation failed',
            details: error.errors,
          });
        }
        fastify.log.error(error, 'Failed to process ID scan');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * POST /v1/sessions/scan-membership - Scan membership to update session with membership number
   *
   * Used by employee register when scanning membership card.
   * Updates existing session with membership number and recalculates allowed rentals.
   * Requires lane parameter for lane-scoped sessions.
   */
  const ScanMembershipSchema = z.object({
    membershipNumber: z.string().min(1),
    lane: z.string().min(1),
    sessionId: z.string().uuid().optional(),
  });

  fastify.post(
    '/v1/sessions/scan-membership',
    async (
      request: FastifyRequest<{ Body: z.infer<typeof ScanMembershipSchema> }>,
      reply: FastifyReply
    ) => {
      try {
        const body = ScanMembershipSchema.parse(request.body);

        // Look up customer by membership number
        const customerResult = await query<CustomerRow>(
          `SELECT id, name, membership_number, banned_until 
         FROM customers 
         WHERE membership_number = $1 
         LIMIT 1`,
          [body.membershipNumber]
        );

        if (customerResult.rows.length === 0) {
          return reply.status(404).send({ error: 'Customer not found' });
        }

        const customer = customerResult.rows[0]!;
        if (customer.banned_until && customer.banned_until > new Date()) {
          return reply.status(403).send({ error: 'Customer is banned' });
        }

        // Find or create session in this lane
        let session: SessionRow;
        if (body.sessionId) {
          const sessionResult = await query<SessionRow>(
            `SELECT id, customer_id, member_name, membership_number, room_id, locker_id, check_in_time, expected_duration, status, lane, agreement_signed
           FROM sessions 
           WHERE id = $1 AND lane = $2 AND status = 'ACTIVE'
           LIMIT 1`,
            [body.sessionId, body.lane]
          );
          if (sessionResult.rows.length === 0) {
            return reply.status(404).send({ error: 'Session not found in this lane' });
          }
          session = sessionResult.rows[0]!;
        } else {
          // Find existing active session in this lane
          const existingSession = await query<SessionRow>(
            `SELECT id, customer_id, member_name, membership_number, room_id, locker_id, check_in_time, expected_duration, status, lane, agreement_signed
           FROM sessions 
           WHERE lane = $1 AND status = 'ACTIVE'
           ORDER BY check_in_time DESC
           LIMIT 1`,
            [body.lane]
          );
          if (existingSession.rows.length > 0) {
            session = existingSession.rows[0]!;
          } else {
            // Create new session
            const newSessionResult = await query<SessionRow>(
              `INSERT INTO sessions (customer_id, member_name, membership_number, expected_duration, status, lane, checkout_at)
             VALUES ($1, $2, $3, 360, 'ACTIVE', $4, NOW() + INTERVAL '6 hours')
             RETURNING id, customer_id, member_name, membership_number, room_id, locker_id, check_in_time, expected_duration, status, lane, agreement_signed`,
              [customer.id, customer.name, customer.membership_number, body.lane]
            );
            session = newSessionResult.rows[0]!;
          }
        }

        // Update session with membership number if not already set
        if (!session.membership_number && customer.membership_number) {
          await query(
            `UPDATE sessions 
           SET membership_number = $1, updated_at = NOW()
           WHERE id = $2`,
            [customer.membership_number, session.id]
          );
          session.membership_number = customer.membership_number;
        }

        // Determine allowed rentals (now with membership number)
        const allowedRentals = getAllowedRentals(customer.membership_number);

        // Broadcast SESSION_UPDATED event to the specific lane
        const payload: SessionUpdatedPayload = {
          sessionId: session.id,
          customerName: session.member_name,
          membershipNumber: customer.membership_number || undefined,
          allowedRentals,
        };

        fastify.broadcaster.broadcastSessionUpdated(payload, body.lane);

        return reply.status(200).send({
          sessionId: session.id,
          customerName: session.member_name,
          membershipNumber: customer.membership_number || undefined,
          allowedRentals,
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            error: 'Validation failed',
            details: error.errors,
          });
        }
        fastify.log.error(error, 'Failed to process membership scan');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
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
  const byType: Record<string, { clean: number; cleaning: number; dirty: number; total: number }> =
    {};
  let overallClean = 0,
    overallCleaning = 0,
    overallDirty = 0;

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

  let lockerClean = 0,
    lockerCleaning = 0,
    lockerDirty = 0;
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
