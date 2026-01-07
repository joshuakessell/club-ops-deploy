import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { serializableTransaction, query } from '../db/index.js';
import { requireReauth } from '../auth/middleware.js';
import type { Broadcaster } from '../websocket/broadcaster.js';
import type { SessionUpdatedPayload } from '@club-ops/shared';

declare module 'fastify' {
  interface FastifyInstance {
    broadcaster: Broadcaster;
  }
}

/**
 * Schema for creating an initial visit.
 */
const CreateVisitSchema = z.object({
  customerId: z.string().uuid(),
  rentalType: z.enum(['STANDARD', 'DOUBLE', 'SPECIAL', 'LOCKER', 'GYM_LOCKER']),
  roomId: z.string().uuid().optional(),
  lockerId: z.string().uuid().optional(),
  lane: z.string().min(1).optional(),
});

type CreateVisitInput = z.infer<typeof CreateVisitSchema>;

/**
 * Schema for renewing a visit.
 */
const RenewVisitSchema = z.object({
  rentalType: z.enum(['STANDARD', 'DOUBLE', 'SPECIAL', 'LOCKER', 'GYM_LOCKER']),
  roomId: z.string().uuid().optional(),
  lockerId: z.string().uuid().optional(),
  lane: z.string().min(1).optional(),
});

type RenewVisitInput = z.infer<typeof RenewVisitSchema>;

interface VisitRow {
  id: string;
  customer_id: string;
  started_at: Date;
  ended_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface CheckinBlockRow {
  id: string;
  visit_id: string;
  block_type: string;
  starts_at: Date;
  ends_at: Date;
  rental_type: string;
  room_id: string | null;
  locker_id: string | null;
  session_id: string | null;
  agreement_signed: boolean;
  created_at: Date;
  updated_at: Date;
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

/**
 * Calculate total hours for a visit including a potential renewal.
 */
function calculateTotalHours(blocks: CheckinBlockRow[], renewalHours: number = 6): number {
  const existingHours = blocks.reduce((total, block) => {
    const hours = (block.ends_at.getTime() - block.starts_at.getTime()) / (1000 * 60 * 60);
    return total + hours;
  }, 0);
  return existingHours + renewalHours;
}

/**
 * Get the latest block end time for a visit.
 */
function getLatestBlockEnd(blocks: CheckinBlockRow[]): Date | null {
  if (blocks.length === 0) return null;
  return blocks.reduce(
    (latest, block) => (block.ends_at > latest ? block.ends_at : latest),
    blocks[0]!.ends_at
  );
}

/**
 * Visit management routes.
 * Handles visit creation, renewal, and active visit search.
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function visitRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /v1/visits - Create an initial visit with initial block
   *
   * Creates a new visit and initial 6-hour block.
   */
  fastify.post<{ Body: CreateVisitInput }>('/v1/visits', async (request, reply) => {
    let body: CreateVisitInput;

    try {
      body = CreateVisitSchema.parse(request.body);
    } catch (error) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: error instanceof z.ZodError ? error.errors : 'Invalid input',
      });
    }

    try {
      const result = await serializableTransaction(async (client) => {
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
        if (customer.banned_until) {
          const now = new Date();
          if (customer.banned_until > now) {
            const remainingDays = Math.ceil(
              (customer.banned_until.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
            );
            throw {
              statusCode: 403,
              message: `Customer is banned until ${customer.banned_until.toISOString()}. Remaining: ${remainingDays} day(s).`,
            };
          }
        }

        // 2. Check for existing active visit
        const existingVisit = await client.query<VisitRow>(
          `SELECT id FROM visits WHERE customer_id = $1 AND ended_at IS NULL`,
          [body.customerId]
        );

        if (existingVisit.rows.length > 0) {
          throw { statusCode: 409, message: 'Member already has an active visit' };
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

          await client.query(
            `UPDATE lockers SET assigned_to_customer_id = $1, updated_at = NOW() WHERE id = $2`,
            [body.customerId, body.lockerId]
          );

          assignedLockerId = body.lockerId;
        }

        // 5. Create the visit
        const now = new Date();
        const initialBlockEndsAt = new Date(now.getTime() + 6 * 60 * 60 * 1000); // 6 hours from now

        const visitResult = await client.query<VisitRow>(
          `INSERT INTO visits (customer_id, started_at)
           VALUES ($1, $2)
           RETURNING id, customer_id, started_at, ended_at, created_at, updated_at`,
          [body.customerId, now]
        );

        const visit = visitResult.rows[0]!;

        // 6. Create the initial block
        const blockResult = await client.query<CheckinBlockRow>(
          `INSERT INTO checkin_blocks (visit_id, block_type, starts_at, ends_at, rental_type, room_id, locker_id)
           VALUES ($1, 'INITIAL', $2, $3, $4, $5, $6)
           RETURNING id, visit_id, block_type, starts_at, ends_at, rental_type, room_id, locker_id, session_id, agreement_signed, created_at, updated_at`,
          [visit.id, now, initialBlockEndsAt, body.rentalType, assignedRoomId, assignedLockerId]
        );

        const block = blockResult.rows[0]!;

        // 7. Create a session for backward compatibility
        const sessionResult = await client.query<{ id: string }>(
          `INSERT INTO sessions (customer_id, member_name, membership_number, room_id, locker_id, expected_duration, status, checkin_type, checkout_at, visit_id, lane)
           VALUES ($1, $2, $3, $4, $5, 360, 'ACTIVE', 'INITIAL', $6, $7, $8)
           RETURNING id`,
          [
            customer.id,
            customer.name,
            customer.membership_number,
            assignedRoomId,
            assignedLockerId,
            initialBlockEndsAt,
            visit.id,
            body.lane || null,
          ]
        );

        const sessionId = sessionResult.rows[0]!.id;

        // NOTE: `checkin_blocks.session_id` links to `lane_sessions` (coordination state).
        // Legacy `sessions` link to visits via `sessions.visit_id`; do not write legacy session IDs into checkin_blocks.

        return {
          visit: {
            id: visit.id,
            customerId: visit.customer_id,
            startedAt: visit.started_at,
            endedAt: visit.ended_at,
            createdAt: visit.created_at,
            updatedAt: visit.updated_at,
          },
          block: {
            id: block.id,
            visitId: block.visit_id,
            blockType: block.block_type,
            startsAt: block.starts_at,
            endsAt: block.ends_at,
            rentalType: block.rental_type,
            roomId: block.room_id,
            lockerId: block.locker_id,
            sessionId,
            agreementSigned: block.agreement_signed,
            createdAt: block.created_at,
            updatedAt: block.updated_at,
          },
          sessionId,
        };
      });

      // Broadcast session update if lane is provided
      if (body.lane && fastify.broadcaster) {
        const customerResult = await query<CustomerRow>(
          'SELECT name, membership_number FROM customers WHERE id = $1',
          [body.customerId]
        );
        const customer = customerResult.rows[0]!;

        // Determine allowed rentals (simplified - reuse logic from sessions.ts)
        const allowedRentals = ['STANDARD', 'DOUBLE', 'SPECIAL'];
        if (customer.membership_number) {
          // Check gym locker eligibility (simplified)
          const rangesEnv = process.env.GYM_LOCKER_ELIGIBLE_RANGES || '';
          if (rangesEnv.trim()) {
            const membershipNum = parseInt(customer.membership_number, 10);
            if (!isNaN(membershipNum)) {
              const ranges = rangesEnv
                .split(',')
                .map((range) => range.trim())
                .filter(Boolean);
              for (const range of ranges) {
                const [startStr, endStr] = range.split('-').map((s) => s.trim());
                const start = parseInt(startStr || '', 10);
                const end = parseInt(endStr || '', 10);
                if (
                  !isNaN(start) &&
                  !isNaN(end) &&
                  membershipNum >= start &&
                  membershipNum <= end
                ) {
                  allowedRentals.push('GYM_LOCKER');
                  break;
                }
              }
            }
          }
        }

        const payload: SessionUpdatedPayload = {
          sessionId: result.sessionId,
          customerName: customer.name,
          membershipNumber: customer.membership_number || undefined,
          allowedRentals,
          mode: 'INITIAL',
          blockEndsAt: result.block.endsAt.toISOString(),
          visitId: result.visit.id,
        };

        fastify.broadcaster.broadcastSessionUpdated(payload, body.lane);
      }

      return reply.status(201).send(result);
    } catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error) {
        const err = error as { statusCode: number; message: string };
        return reply.status(err.statusCode).send({ error: err.message });
      }
      fastify.log.error(error, 'Failed to create visit');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /v1/visits/:visitId/renew - Create a renewal block for an existing visit
   *
   * Creates a renewal block that extends from the previous block's end time.
   * Enforces 14-hour maximum visit duration.
   */
  fastify.post<{ Params: { visitId: string }; Body: RenewVisitInput }>(
    '/v1/visits/:visitId/renew',
    async (request, reply) => {
      let body: RenewVisitInput;

      try {
        body = RenewVisitSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      try {
        const result = await serializableTransaction(async (client) => {
          // 1. Get the visit and verify it's active
          const visitResult = await client.query<VisitRow>(
            `SELECT id, customer_id, started_at, ended_at FROM visits WHERE id = $1 FOR UPDATE`,
            [request.params.visitId]
          );

          if (visitResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Visit not found' };
          }

          const visit = visitResult.rows[0]!;
          if (visit.ended_at) {
            throw { statusCode: 400, message: 'Visit has already ended' };
          }

          // Check if customer is banned
          const customerResult = await client.query<CustomerRow>(
            'SELECT id, name, membership_number, banned_until FROM customers WHERE id = $1',
            [visit.customer_id]
          );

          if (customerResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Customer not found' };
          }

          const customer = customerResult.rows[0]!;
          if (customer.banned_until) {
            const now = new Date();
            if (customer.banned_until > now) {
              const remainingDays = Math.ceil(
                (customer.banned_until.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
              );
              throw {
                statusCode: 403,
                message: `Customer is banned until ${customer.banned_until.toISOString()}. Remaining: ${remainingDays} day(s).`,
              };
            }
          }

          // 2. Get all existing blocks for this visit
          const blocksResult = await client.query<CheckinBlockRow>(
            `SELECT id, visit_id, block_type, starts_at, ends_at, rental_type::text as rental_type, room_id, locker_id, session_id, agreement_signed
           FROM checkin_blocks WHERE visit_id = $1 ORDER BY ends_at DESC`,
            [visit.id]
          );

          const blocks = blocksResult.rows;
          if (blocks.length === 0) {
            throw { statusCode: 400, message: 'Visit has no blocks' };
          }

          // 3. Check if renewal would exceed 14-hour maximum
          const totalHoursIfRenewed = calculateTotalHours(blocks, 6);
          if (totalHoursIfRenewed > 14) {
            throw {
              statusCode: 400,
              message: `Renewal would exceed 14-hour maximum. Current total: ${calculateTotalHours(blocks)} hours, renewal would add 6 hours.`,
            };
          }

          // 4. Get the latest block end time (renewal starts from here, not from now)
          const latestBlockEnd = getLatestBlockEnd(blocks);
          if (!latestBlockEnd) {
            throw { statusCode: 400, message: 'Cannot determine renewal start time' };
          }

          // 5. Renewal extends from previous checkout time, not from now
          const renewalStartsAt = latestBlockEnd;
          const renewalEndsAt = new Date(renewalStartsAt.getTime() + 6 * 60 * 60 * 1000); // 6 hours from previous checkout

          // 6. Handle room assignment if requested
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

            if (
              room.assigned_to_customer_id &&
              room.assigned_to_customer_id !== visit.customer_id
            ) {
              throw { statusCode: 409, message: `Room ${room.number} is already assigned` };
            }

            if (!room.assigned_to_customer_id) {
              await client.query(
                `UPDATE rooms SET assigned_to_customer_id = $1, updated_at = NOW() WHERE id = $2`,
                [visit.customer_id, body.roomId]
              );
            }

            assignedRoomId = body.roomId;
          }

          // 7. Handle locker assignment if requested
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
            if (
              locker.assigned_to_customer_id &&
              locker.assigned_to_customer_id !== visit.customer_id
            ) {
              throw { statusCode: 409, message: `Locker ${locker.number} is already assigned` };
            }

            if (!locker.assigned_to_customer_id) {
              await client.query(
                `UPDATE lockers SET assigned_to_customer_id = $1, updated_at = NOW() WHERE id = $2`,
                [visit.customer_id, body.lockerId]
              );
            }

            assignedLockerId = body.lockerId;
          }

          // 8. Create the renewal block
          const blockResult = await client.query<CheckinBlockRow>(
            `INSERT INTO checkin_blocks (visit_id, block_type, starts_at, ends_at, rental_type, room_id, locker_id)
           VALUES ($1, 'RENEWAL', $2, $3, $4, $5, $6)
           RETURNING id, visit_id, block_type, starts_at, ends_at, rental_type, room_id, locker_id, session_id, agreement_signed, created_at, updated_at`,
            [
              visit.id,
              renewalStartsAt,
              renewalEndsAt,
              body.rentalType,
              assignedRoomId,
              assignedLockerId,
            ]
          );

          const block = blockResult.rows[0]!;

          // 9. Create a session for backward compatibility
          // Reuse member from earlier in the function (line 398)

          const sessionResult = await client.query<{ id: string }>(
            `INSERT INTO sessions (customer_id, member_name, membership_number, room_id, locker_id, expected_duration, status, checkin_type, checkout_at, visit_id, lane)
           VALUES ($1, $2, $3, $4, $5, 360, 'ACTIVE', 'RENEWAL', $6, $7, $8)
           RETURNING id`,
            [
              customer.id,
              customer.name,
              customer.membership_number,
              assignedRoomId,
              assignedLockerId,
              renewalEndsAt,
              visit.id,
              body.lane || null,
            ]
          );

          const sessionId = sessionResult.rows[0]!.id;

          // NOTE: `checkin_blocks.session_id` links to `lane_sessions` (coordination state).
          // Legacy `sessions` link to visits via `sessions.visit_id`; do not write legacy session IDs into checkin_blocks.

          return {
            visit: {
              id: visit.id,
              customerId: visit.customer_id,
              startedAt: visit.started_at,
              endedAt: visit.ended_at,
              createdAt: visit.created_at,
              updatedAt: new Date(),
            },
            block: {
              id: block.id,
              visitId: block.visit_id,
              blockType: block.block_type,
              startsAt: block.starts_at,
              endsAt: block.ends_at,
              rentalType: block.rental_type,
              roomId: block.room_id,
              lockerId: block.locker_id,
              sessionId,
              agreementSigned: block.agreement_signed,
              createdAt: block.created_at,
              updatedAt: block.updated_at,
            },
            sessionId,
          };
        });

        // Broadcast session update if lane is provided
        if (body.lane && fastify.broadcaster) {
          const customerResult = await query<CustomerRow>(
            'SELECT name, membership_number FROM customers WHERE id = $1',
            [result.visit.customerId]
          );
          const customer = customerResult.rows[0]!;

          const allowedRentals = ['STANDARD', 'DOUBLE', 'SPECIAL'];
          if (customer.membership_number) {
            const rangesEnv = process.env.GYM_LOCKER_ELIGIBLE_RANGES || '';
            if (rangesEnv.trim()) {
              const membershipNum = parseInt(customer.membership_number, 10);
              if (!isNaN(membershipNum)) {
                const ranges = rangesEnv
                  .split(',')
                  .map((range) => range.trim())
                  .filter(Boolean);
                for (const range of ranges) {
                  const [startStr, endStr] = range.split('-').map((s) => s.trim());
                  const start = parseInt(startStr || '', 10);
                  const end = parseInt(endStr || '', 10);
                  if (
                    !isNaN(start) &&
                    !isNaN(end) &&
                    membershipNum >= start &&
                    membershipNum <= end
                  ) {
                    allowedRentals.push('GYM_LOCKER');
                    break;
                  }
                }
              }
            }
          }

          const payload: SessionUpdatedPayload = {
            sessionId: result.sessionId,
            customerName: customer.name,
            membershipNumber: customer.membership_number || undefined,
            allowedRentals,
            mode: 'RENEWAL',
            blockEndsAt: result.block.endsAt.toISOString(),
            visitId: result.visit.id,
          };

          fastify.broadcaster.broadcastSessionUpdated(payload, body.lane);
        }

        return reply.status(201).send(result);
      } catch (error) {
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message: string };
          return reply.status(err.statusCode).send({ error: err.message });
        }
        fastify.log.error(error, 'Failed to renew visit');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * GET /v1/visits/active - Search for active visits
   *
   * Searches active visits by membership number or customer name.
   * Returns computed fields: current_checkout_at, total_hours_if_renewed, can_final_extend
   */
  fastify.get<{
    Querystring: { query?: string; membershipNumber?: string; customerName?: string };
  }>('/v1/visits/active', async (request, reply) => {
    try {
      const { query: searchQuery, membershipNumber, customerName } = request.query;

      let visitsResult;

      if (membershipNumber) {
        // Search by membership number
        visitsResult = await query<
          VisitRow & { customer_name: string; membership_number: string | null }
        >(
          `SELECT v.id, v.customer_id, v.started_at, v.ended_at, v.created_at, v.updated_at,
                  c.name as customer_name, c.membership_number
           FROM visits v
           JOIN customers c ON v.customer_id = c.id
           WHERE v.ended_at IS NULL AND c.membership_number = $1
           ORDER BY v.started_at DESC`,
          [membershipNumber]
        );
      } else if (customerName) {
        // Search by customer name (partial match)
        visitsResult = await query<
          VisitRow & { customer_name: string; membership_number: string | null }
        >(
          `SELECT v.id, v.customer_id, v.started_at, v.ended_at, v.created_at, v.updated_at,
                  c.name as customer_name, c.membership_number
           FROM visits v
           JOIN customers c ON v.customer_id = c.id
           WHERE v.ended_at IS NULL AND c.name ILIKE $1
           ORDER BY v.started_at DESC
           LIMIT 20`,
          [`%${customerName}%`]
        );
      } else if (searchQuery) {
        // General search (try membership number first, then name)
        visitsResult = await query<
          VisitRow & { customer_name: string; membership_number: string | null }
        >(
          `SELECT v.id, v.customer_id, v.started_at, v.ended_at, v.created_at, v.updated_at,
                  c.name as customer_name, c.membership_number
           FROM visits v
           JOIN customers c ON v.customer_id = c.id
           WHERE v.ended_at IS NULL 
             AND (c.membership_number = $1 OR c.name ILIKE $2)
           ORDER BY v.started_at DESC
           LIMIT 20`,
          [searchQuery, `%${searchQuery}%`]
        );
      } else {
        return reply
          .status(400)
          .send({ error: 'Must provide query, membershipNumber, or customerName parameter' });
      }

      // Get blocks for each visit and compute fields
      const activeVisits = await Promise.all(
        visitsResult.rows.map(async (visit) => {
          const blocksResult = await query<CheckinBlockRow>(
            `SELECT id, visit_id, block_type, starts_at, ends_at, rental_type::text as rental_type, room_id, locker_id, session_id, agreement_signed, created_at, updated_at
             FROM checkin_blocks WHERE visit_id = $1 ORDER BY ends_at DESC`,
            [visit.id]
          );

          const blocks = blocksResult.rows;
          const latestBlockEnd = getLatestBlockEnd(blocks);
          const totalHoursIfRenewed = calculateTotalHours(blocks, 6);
          const canFinalExtend = totalHoursIfRenewed <= 12; // Can extend if renewal + final2h would be <= 14

          return {
            id: visit.id,
            customerId: visit.customer_id,
            customerName: visit.customer_name,
            membershipNumber: visit.membership_number || undefined,
            startedAt: visit.started_at,
            currentCheckoutAt: latestBlockEnd || visit.started_at,
            totalHoursIfRenewed,
            canFinalExtend,
            blocks: blocks.map((block) => ({
              id: block.id,
              visitId: block.visit_id,
              blockType: block.block_type,
              startsAt: block.starts_at,
              endsAt: block.ends_at,
              rentalType: block.rental_type,
              roomId: block.room_id,
              lockerId: block.locker_id,
              sessionId: block.session_id,
              agreementSigned: block.agreement_signed,
              createdAt: block.created_at,
              updatedAt: block.updated_at,
            })),
          };
        })
      );

      return reply.send({ visits: activeVisits });
    } catch (error) {
      fastify.log.error(error, 'Failed to search active visits');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /v1/visits/:visitId/final-extension - Create final 2-hour extension
   *
   * After a customer has used 12 hours (two 6-hour blocks), allow only one additional
   * extension of 2 hours for $20, same for any rental type.
   *
   * Requirements:
   * - Visit must have exactly 2 blocks (12 hours)
   * - No previous final extension
   * - Flat fee $20 (manual Square confirmation)
   * - Does NOT require signature (informational only)
   * - Requires step-up re-auth
   */
  fastify.post<{
    Params: { visitId: string };
    Body: {
      rentalType: 'STANDARD' | 'DOUBLE' | 'SPECIAL' | 'LOCKER' | 'GYM_LOCKER';
      roomId?: string;
      lockerId?: string;
    };
  }>(
    '/v1/visits/:visitId/final-extension',
    {
      preHandler: [requireReauth],
    },
    async (request, reply) => {
      const staff = request.staff;
      if (!staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const { visitId } = request.params;
      const { rentalType, roomId, lockerId } = request.body;

      try {
        const result = await serializableTransaction(async (client) => {
          // 1. Get visit and verify it's active
          const visitResult = await client.query<VisitRow>(
            `SELECT id, customer_id, started_at, ended_at FROM visits WHERE id = $1 FOR UPDATE`,
            [visitId]
          );

          if (visitResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Visit not found' };
          }

          const visit = visitResult.rows[0]!;
          if (visit.ended_at) {
            throw { statusCode: 400, message: 'Visit has already ended' };
          }

          // 2. Get all blocks for this visit
          const blocksResult = await client.query<CheckinBlockRow>(
            `SELECT id, visit_id, block_type, starts_at, ends_at, rental_type::text as rental_type, room_id, locker_id
           FROM checkin_blocks WHERE visit_id = $1 ORDER BY ends_at DESC`,
            [visit.id]
          );

          const blocks = blocksResult.rows;

          // 3. Verify exactly 2 blocks exist (12 hours)
          if (blocks.length !== 2) {
            throw {
              statusCode: 400,
              message: `Final extension requires exactly 2 blocks (current: ${blocks.length}). Visit must have completed two 6-hour blocks first.`,
            };
          }

          // 4. Verify no previous final extension
          const hasFinalExtension = blocks.some((block) => block.block_type === 'FINAL2H');
          if (hasFinalExtension) {
            throw {
              statusCode: 400,
              message: 'Final extension has already been applied to this visit',
            };
          }

          // 5. Verify both blocks are INITIAL or RENEWAL (not FINAL2H)
          const invalidBlocks = blocks.filter((block) => block.block_type === 'FINAL2H');
          if (invalidBlocks.length > 0) {
            throw { statusCode: 400, message: 'Visit contains invalid block types' };
          }

          // 6. Calculate total hours - should be 12 hours (two 6-hour blocks)
          // Pass 0 as second parameter since we just want the total, not adding renewal hours
          const totalHours = calculateTotalHours(blocks, 0);
          if (totalHours !== 12) {
            throw {
              statusCode: 400,
              message: `Final extension requires exactly 12 hours (current: ${totalHours} hours). Visit must have completed two 6-hour blocks first.`,
            };
          }

          // 7. Verify 2-hour extension won't exceed 14-hour maximum
          if (totalHours + 2 > 14) {
            throw { statusCode: 400, message: 'Final extension would exceed 14-hour maximum' };
          }

          // 8. Get latest block end time
          const latestBlockEnd = getLatestBlockEnd(blocks);
          if (!latestBlockEnd) {
            throw { statusCode: 400, message: 'Cannot determine extension start time' };
          }

          // 9. Handle room/locker assignment if requested
          let assignedRoomId: string | null = null;
          let assignedLockerId: string | null = null;

          if (roomId) {
            const roomResult = await client.query<RoomRow>(
              `SELECT id, number, status, assigned_to_customer_id FROM rooms WHERE id = $1 FOR UPDATE`,
              [roomId]
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

            if (
              room.assigned_to_customer_id &&
              room.assigned_to_customer_id !== visit.customer_id
            ) {
              throw { statusCode: 409, message: `Room ${room.number} is already assigned` };
            }

            if (!room.assigned_to_customer_id) {
              await client.query(
                `UPDATE rooms SET assigned_to_customer_id = $1, updated_at = NOW() WHERE id = $2`,
                [visit.customer_id, roomId]
              );
            }

            assignedRoomId = roomId;
          }

          if (lockerId) {
            const lockerResult = await client.query<LockerRow>(
              `SELECT id, number, status, assigned_to_customer_id FROM lockers WHERE id = $1 FOR UPDATE`,
              [lockerId]
            );

            if (lockerResult.rows.length === 0) {
              throw { statusCode: 404, message: 'Locker not found' };
            }

            const locker = lockerResult.rows[0]!;
            if (
              locker.assigned_to_customer_id &&
              locker.assigned_to_customer_id !== visit.customer_id
            ) {
              throw { statusCode: 409, message: `Locker ${locker.number} is already assigned` };
            }

            if (!locker.assigned_to_customer_id) {
              await client.query(
                `UPDATE lockers SET assigned_to_customer_id = $1, updated_at = NOW() WHERE id = $2`,
                [visit.customer_id, lockerId]
              );
            }

            assignedLockerId = lockerId;
          }

          // 10. Create final 2-hour extension block
          const extensionStartsAt = latestBlockEnd;
          const extensionEndsAt = new Date(extensionStartsAt.getTime() + 2 * 60 * 60 * 1000); // 2 hours

          const blockResult = await client.query<CheckinBlockRow>(
            `INSERT INTO checkin_blocks (visit_id, block_type, starts_at, ends_at, rental_type, room_id, locker_id, agreement_signed)
           VALUES ($1, 'FINAL2H', $2, $3, $4, $5, $6, true)
           RETURNING id, visit_id, block_type, starts_at, ends_at, rental_type, room_id, locker_id, session_id, agreement_signed, created_at, updated_at`,
            [
              visit.id,
              extensionStartsAt,
              extensionEndsAt,
              rentalType,
              assignedRoomId,
              assignedLockerId,
            ]
          );

          const block = blockResult.rows[0]!;

          // 11. Create payment intent for $20 flat fee
          const intentResult = await client.query<{
            id: string;
            amount: number | string;
          }>(
            `INSERT INTO payment_intents (amount, status, quote_json)
           VALUES ($1, 'DUE', $2)
           RETURNING id, amount`,
            [
              20.0,
              JSON.stringify({
                type: 'FINAL_EXTENSION',
                visitId: visit.id,
                blockId: block.id,
                hours: 2,
                amount: 20.0,
              }),
            ]
          );

          const paymentIntent = intentResult.rows[0]!;

          // 12. Log final extension started
          await client.query(
            `INSERT INTO audit_log 
           (staff_id, action, entity_type, entity_id, old_value, new_value)
           VALUES ($1, 'FINAL_EXTENSION_STARTED', 'visit', $2, $3, $4)`,
            [
              staff.staffId,
              visitId,
              JSON.stringify({
                totalHours: totalHours,
                blockCount: blocks.length,
              }),
              JSON.stringify({
                blockId: block.id,
                blockType: 'FINAL2H',
                extensionHours: 2,
                newEndsAt: extensionEndsAt.toISOString(),
                paymentIntentId: paymentIntent.id,
                rentalType,
              }),
            ]
          );

          return {
            visit: {
              id: visit.id,
              customerId: visit.customer_id,
              startedAt: visit.started_at,
              endedAt: visit.ended_at,
              createdAt: visit.created_at,
              updatedAt: new Date(),
            },
            block: {
              id: block.id,
              visitId: block.visit_id,
              blockType: block.block_type,
              startsAt: block.starts_at,
              endsAt: block.ends_at,
              rentalType: block.rental_type,
              roomId: block.room_id,
              lockerId: block.locker_id,
              sessionId: block.session_id,
              agreementSigned: block.agreement_signed,
              createdAt: block.created_at,
              updatedAt: block.updated_at,
            },
            paymentIntentId: paymentIntent.id,
            amount:
              typeof paymentIntent.amount === 'string'
                ? parseFloat(paymentIntent.amount)
                : paymentIntent.amount,
          };
        });

        return reply.status(201).send(result);
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message: string };
          return reply.status(err.statusCode).send({ error: err.message });
        }
        fastify.log.error(error, 'Failed to create final extension');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
