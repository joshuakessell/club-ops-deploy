import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { serializableTransaction, query, transaction } from '../db';
import { requireAuth } from '../auth/middleware';
import type { Broadcaster } from '../websocket/broadcaster';
import type {
  CheckoutRequestedPayload,
  CheckoutClaimedPayload,
  CheckoutUpdatedPayload,
  CheckoutCompletedPayload,
  ResolvedCheckoutKey,
  CheckoutRequestSummary,
} from '@club-ops/shared';
import { RoomStatus } from '@club-ops/shared';
import { buildSystemLateFeeNote } from '../utils/lateFeeNotes';
import { insertAuditLog } from '../audit/auditLog';
import { broadcastInventoryUpdate } from '../inventory/broadcast';

declare module 'fastify' {
  interface FastifyInstance {
    broadcaster: Broadcaster;
  }
}

/**
 * Calculate late fee and ban status based on minutes late.
 */
function calculateLateFee(lateMinutes: number): { feeAmount: number; banApplied: boolean } {
  // In demo mode, suppress late fees/bans to keep flows lightweight
  if (process.env.DEMO_MODE === 'true') {
    return { feeAmount: 0, banApplied: false };
  }
  if (lateMinutes < 30) {
    return { feeAmount: 0, banApplied: false };
  } else if (lateMinutes < 60) {
    return { feeAmount: 15, banApplied: false };
  } else if (lateMinutes < 90) {
    return { feeAmount: 35, banApplied: false };
  } else {
    return { feeAmount: 35, banApplied: true };
  }
}

/**
 * Schema for resolving a key tag for checkout.
 */
const ResolveKeySchema = z.object({
  token: z.string().min(1),
  kioskDeviceId: z.string().min(1),
});

type ResolveKeyInput = z.infer<typeof ResolveKeySchema>;

/**
 * Schema for creating a checkout request.
 */
const CreateCheckoutRequestSchema = z.object({
  occupancyId: z.string().uuid(), // checkin_block.id
  kioskDeviceId: z.string().min(1),
  checklist: z.object({
    key: z.boolean().optional(),
    towel: z.boolean().optional(),
    sheets: z.boolean().optional(),
    remote: z.boolean().optional(),
  }),
});

type CreateCheckoutRequestInput = z.infer<typeof CreateCheckoutRequestSchema>;

/**
 * Schema for marking fee as paid.
 */
const MarkFeePaidSchema = z.object({
  note: z.string().optional(),
});

type MarkFeePaidInput = z.infer<typeof MarkFeePaidSchema>;

interface KeyTagRow {
  id: string;
  room_id: string | null;
  locker_id: string | null;
  tag_code: string;
  is_active: boolean;
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
  has_tv_remote: boolean;
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
  type: string;
}

interface LockerRow {
  id: string;
  number: string;
}

interface CheckoutRequestRow {
  id: string;
  occupancy_id: string;
  customer_id: string;
  key_tag_id: string | null;
  kiosk_device_id: string;
  created_at: Date;
  claimed_by_staff_id: string | null;
  claimed_at: Date | null;
  claim_expires_at: Date | null;
  customer_checklist_json: unknown;
  status: string;
  late_minutes: number;
  late_fee_amount: number;
  ban_applied: boolean;
  items_confirmed: boolean;
  fee_paid: boolean;
  completed_at: Date | null;
}

interface WaitlistStatusRow {
  id: string;
  status: 'ACTIVE' | 'OFFERED';
}

type ManualCheckoutResourceType = 'ROOM' | 'LOCKER';

interface ManualCheckoutCandidateRow {
  occupancy_id: string;
  resource_type: ManualCheckoutResourceType;
  number: string;
  customer_name: string;
  checkin_at: Date;
  scheduled_checkout_at: Date;
  is_overdue: boolean;
}

interface ManualResolveRow {
  occupancy_id: string;
  visit_id: string;
  customer_id: string;
  customer_name: string;
  checkin_at: Date;
  scheduled_checkout_at: Date;
  room_id: string | null;
  room_number: string | null;
  locker_id: string | null;
  locker_number: string | null;
  session_id: string | null;
}

type VisitDateRow = { started_at: Date };

function looksLikeUuid(value: string): boolean {
  // Good enough for deciding whether to write staff_id; DB will still enforce UUID shape.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

/**
 * Checkout routes for customer-operated checkout kiosk and employee verification.
 */
export async function checkoutRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /v1/checkout/manual-candidates
   *
   * Staff-only endpoint for manual checkout candidates:
   * - overdue (past scheduled checkout time) OR
   * - within 60 minutes of scheduled checkout time
   */
  fastify.get(
    '/v1/checkout/manual-candidates',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

      try {
        const result = await query<ManualCheckoutCandidateRow>(
          `
          WITH room_candidates AS (
            SELECT DISTINCT ON (cb.room_id)
              cb.id as occupancy_id,
              'ROOM'::text as resource_type,
              r.number as number,
              c.name as customer_name,
              cb.starts_at as checkin_at,
              cb.ends_at as scheduled_checkout_at,
              (cb.ends_at < NOW()) as is_overdue
            FROM checkin_blocks cb
            JOIN visits v ON cb.visit_id = v.id
            JOIN customers c ON v.customer_id = c.id
            JOIN rooms r ON cb.room_id = r.id
            WHERE cb.room_id IS NOT NULL
              AND v.ended_at IS NULL
              AND cb.ends_at <= NOW() + INTERVAL '60 minutes'
            ORDER BY cb.room_id, cb.ends_at DESC
          ),
          locker_candidates AS (
            SELECT DISTINCT ON (cb.locker_id)
              cb.id as occupancy_id,
              'LOCKER'::text as resource_type,
              l.number as number,
              c.name as customer_name,
              cb.starts_at as checkin_at,
              cb.ends_at as scheduled_checkout_at,
              (cb.ends_at < NOW()) as is_overdue
            FROM checkin_blocks cb
            JOIN visits v ON cb.visit_id = v.id
            JOIN customers c ON v.customer_id = c.id
            JOIN lockers l ON cb.locker_id = l.id
            WHERE cb.locker_id IS NOT NULL
              AND v.ended_at IS NULL
              AND cb.ends_at <= NOW() + INTERVAL '60 minutes'
            ORDER BY cb.locker_id, cb.ends_at DESC
          )
          SELECT * FROM room_candidates
          UNION ALL
          SELECT * FROM locker_candidates
          ORDER BY is_overdue DESC, scheduled_checkout_at ASC
          `
        );

        return reply.send({
          candidates: result.rows.map((r) => ({
            occupancyId: r.occupancy_id,
            resourceType: r.resource_type,
            number: r.number,
            customerName: r.customer_name,
            checkinAt: r.checkin_at,
            scheduledCheckoutAt: r.scheduled_checkout_at,
            isOverdue: r.is_overdue,
          })),
        });
      } catch (error) {
        fastify.log.error(error, 'Failed to list manual checkout candidates');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  const ManualResolveSchema = z
    .object({
      number: z.string().min(1).optional(),
      occupancyId: z.string().uuid().optional(),
    })
    .refine((v) => Boolean(v.number || v.occupancyId), {
      message: 'Either number or occupancyId is required',
    });

  /**
   * POST /v1/checkout/manual-resolve
   *
   * Staff-only endpoint to resolve a room/locker number or occupancyId
   * into checkout timing + computed late fee/ban.
   */
  fastify.post<{ Body: z.infer<typeof ManualResolveSchema> }>(
    '/v1/checkout/manual-resolve',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

      let body: z.infer<typeof ManualResolveSchema>;
      try {
        body = ManualResolveSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      try {
        const loadByOccupancyId = async (occupancyId: string) => {
          const res = await query<ManualResolveRow>(
            `
            SELECT
              cb.id as occupancy_id,
              cb.visit_id,
              v.customer_id,
              c.name as customer_name,
              cb.starts_at as checkin_at,
              cb.ends_at as scheduled_checkout_at,
              cb.room_id,
              r.number as room_number,
              cb.locker_id,
              l.number as locker_number,
              cb.session_id
            FROM checkin_blocks cb
            JOIN visits v ON cb.visit_id = v.id
            JOIN customers c ON v.customer_id = c.id
            LEFT JOIN rooms r ON cb.room_id = r.id
            LEFT JOIN lockers l ON cb.locker_id = l.id
            WHERE cb.id = $1 AND v.ended_at IS NULL
            `,
            [occupancyId]
          );
          return res.rows[0] ?? null;
        };

        const loadLatestByRoomId = async (roomId: string) => {
          const res = await query<ManualResolveRow>(
            `
            SELECT
              cb.id as occupancy_id,
              cb.visit_id,
              v.customer_id,
              c.name as customer_name,
              cb.starts_at as checkin_at,
              cb.ends_at as scheduled_checkout_at,
              cb.room_id,
              r.number as room_number,
              cb.locker_id,
              l.number as locker_number,
              cb.session_id
            FROM checkin_blocks cb
            JOIN visits v ON cb.visit_id = v.id
            JOIN customers c ON v.customer_id = c.id
            JOIN rooms r ON cb.room_id = r.id
            LEFT JOIN lockers l ON cb.locker_id = l.id
            WHERE cb.room_id = $1 AND v.ended_at IS NULL
            ORDER BY cb.ends_at DESC
            LIMIT 1
            `,
            [roomId]
          );
          return res.rows[0] ?? null;
        };

        const loadLatestByLockerId = async (lockerId: string) => {
          const res = await query<ManualResolveRow>(
            `
            SELECT
              cb.id as occupancy_id,
              cb.visit_id,
              v.customer_id,
              c.name as customer_name,
              cb.starts_at as checkin_at,
              cb.ends_at as scheduled_checkout_at,
              cb.room_id,
              r.number as room_number,
              cb.locker_id,
              l.number as locker_number,
              cb.session_id
            FROM checkin_blocks cb
            JOIN visits v ON cb.visit_id = v.id
            JOIN customers c ON v.customer_id = c.id
            JOIN lockers l ON cb.locker_id = l.id
            LEFT JOIN rooms r ON cb.room_id = r.id
            WHERE cb.locker_id = $1 AND v.ended_at IS NULL
            ORDER BY cb.ends_at DESC
            LIMIT 1
            `,
            [lockerId]
          );
          return res.rows[0] ?? null;
        };

        let row: ManualResolveRow | null = null;
        if (body.occupancyId) {
          row = await loadByOccupancyId(body.occupancyId);
        } else if (body.number) {
          // Try locker first, then room.
          const lockerRes = await query<{ id: string }>(`SELECT id FROM lockers WHERE number = $1`, [
            body.number,
          ]);
          if (lockerRes.rows[0]?.id) {
            row = await loadLatestByLockerId(lockerRes.rows[0].id);
          } else {
            const roomRes = await query<{ id: string }>(`SELECT id FROM rooms WHERE number = $1`, [
              body.number,
            ]);
            if (roomRes.rows[0]?.id) {
              row = await loadLatestByRoomId(roomRes.rows[0].id);
            }
          }
        }

        if (!row) return reply.status(404).send({ error: 'Active occupancy not found' });

        const now = new Date();
        const scheduledCheckoutAt =
          row.scheduled_checkout_at instanceof Date
            ? row.scheduled_checkout_at
            : new Date(row.scheduled_checkout_at);
        const lateMinutes = Math.max(0, Math.floor((now.getTime() - scheduledCheckoutAt.getTime()) / (1000 * 60)));
        const { feeAmount, banApplied } = calculateLateFee(lateMinutes);

        const resourceType: ManualCheckoutResourceType = row.locker_id ? 'LOCKER' : 'ROOM';
        const number = resourceType === 'LOCKER' ? row.locker_number : row.room_number;

        if (!number) return reply.status(404).send({ error: 'Resource not found for occupancy' });

        return reply.send({
          occupancyId: row.occupancy_id,
          resourceType,
          number,
          customerName: row.customer_name,
          checkinAt: row.checkin_at,
          scheduledCheckoutAt,
          lateMinutes,
          fee: feeAmount,
          banApplied,
        });
      } catch (error) {
        fastify.log.error(error, 'Failed to resolve manual checkout');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  const ManualCompleteSchema = z.object({
    occupancyId: z.string().uuid(),
  });

  /**
   * POST /v1/checkout/manual-complete
   *
   * Staff-only endpoint to complete checkout manually (no checkout_request_id).
   * Must be idempotent using a serializable transaction + visit row lock.
   */
  fastify.post<{ Body: z.infer<typeof ManualCompleteSchema> }>(
    '/v1/checkout/manual-complete',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
      const staffId = request.staff.staffId;

      let body: z.infer<typeof ManualCompleteSchema>;
      try {
        body = ManualCompleteSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      try {
        const result = await serializableTransaction(async (client) => {
          const occRes = await client.query<ManualResolveRow & { visit_ended_at: Date | null }>(
            `
            SELECT
              cb.id as occupancy_id,
              cb.visit_id,
              v.customer_id,
              c.name as customer_name,
              cb.starts_at as checkin_at,
              cb.ends_at as scheduled_checkout_at,
              cb.room_id,
              r.number as room_number,
              cb.locker_id,
              l.number as locker_number,
              cb.session_id,
              v.ended_at as visit_ended_at
            FROM checkin_blocks cb
            JOIN visits v ON cb.visit_id = v.id
            JOIN customers c ON v.customer_id = c.id
            LEFT JOIN rooms r ON cb.room_id = r.id
            LEFT JOIN lockers l ON cb.locker_id = l.id
            WHERE cb.id = $1
            FOR UPDATE OF v
            `,
            [body.occupancyId]
          );

          if (occRes.rows.length === 0) {
            throw { statusCode: 404, message: 'Occupancy not found' };
          }

          const row = occRes.rows[0]!;
          if (row.visit_ended_at) {
            return { alreadyCheckedOut: true, row };
          }

          const now = new Date();
          const scheduledCheckoutAt =
            row.scheduled_checkout_at instanceof Date
              ? row.scheduled_checkout_at
              : new Date(row.scheduled_checkout_at);
          const lateMinutes = Math.max(
            0,
            Math.floor((now.getTime() - scheduledCheckoutAt.getTime()) / (1000 * 60))
          );
          const { feeAmount, banApplied } = calculateLateFee(lateMinutes);

          // Cancel active waitlist entries for this visit (system cancel on checkout)
          const waitlistResult = await client.query<WaitlistStatusRow>(
            `SELECT id, status
             FROM waitlist
             WHERE visit_id = $1 AND status IN ('ACTIVE','OFFERED')
             FOR UPDATE`,
            [row.visit_id]
          );

          if (waitlistResult.rows.length > 0) {
            const waitlistIds = waitlistResult.rows.map((r) => r.id);

            await client.query(
              `UPDATE waitlist
               SET status = 'CANCELLED',
                   cancelled_at = NOW(),
                   cancelled_by_staff_id = NULL,
                   updated_at = NOW()
               WHERE id = ANY($1::uuid[])`,
              [waitlistIds]
            );

            const auditStaffId = looksLikeUuid(staffId) ? staffId : null;
            for (const wl of waitlistResult.rows) {
              await insertAuditLog(client, {
                staffId: auditStaffId,
                action: 'WAITLIST_CANCELLED',
                entityType: 'waitlist',
                entityId: wl.id,
                oldValue: { status: wl.status },
                newValue: { status: 'CANCELLED', reason: 'CHECKED_OUT' },
              });
            }
          }

          // Update room to DIRTY or locker to CLEAN and unassign
          if (row.room_id) {
            await client.query(
              `UPDATE rooms SET status = $1, assigned_to_customer_id = NULL, updated_at = NOW() WHERE id = $2`,
              [RoomStatus.DIRTY, row.room_id]
            );
          }
          if (row.locker_id) {
            await client.query(
              `UPDATE lockers SET status = $1, assigned_to_customer_id = NULL, updated_at = NOW() WHERE id = $2`,
              [RoomStatus.CLEAN, row.locker_id]
            );
          }

          // End the visit
          await client.query(`UPDATE visits SET ended_at = NOW(), updated_at = NOW() WHERE id = $1`, [
            row.visit_id,
          ]);

          // Apply ban if needed
          if (banApplied) {
            const banUntil = new Date();
            banUntil.setDate(banUntil.getDate() + 30);
            await client.query(`UPDATE customers SET banned_until = $1, updated_at = NOW() WHERE id = $2`, [
              banUntil,
              row.customer_id,
            ]);
          }

          // Update past due balance + itemized charge + system note if fee > 0
          if (feeAmount > 0) {
            await client.query(
              `UPDATE customers
               SET past_due_balance = past_due_balance + $1,
                   updated_at = NOW()
               WHERE id = $2`,
              [feeAmount, row.customer_id]
            );
            // Record as an itemized charge tied to the visit/block (idempotent per occupancy).
            const existingLate = await client.query<{ id: string }>(
              `SELECT id FROM charges WHERE checkin_block_id = $1 AND type = 'LATE_FEE' LIMIT 1`,
              [row.occupancy_id]
            );
            if (existingLate.rows.length === 0) {
              await client.query(
                `INSERT INTO charges (visit_id, checkin_block_id, type, amount, payment_intent_id)
                 VALUES ($1, $2, 'LATE_FEE', $3, NULL)`,
                [row.visit_id, row.occupancy_id, feeAmount]
              );
            }

            // System note: visible on next visit, then auto-archived during next successful check-in.
            const visitRow = await client.query<VisitDateRow>(
              `SELECT started_at FROM visits WHERE id = $1 LIMIT 1`,
              [row.visit_id]
            );
            const visitDate = visitRow.rows[0]?.started_at
              ? visitRow.rows[0]!.started_at.toISOString().slice(0, 10)
              : now.toISOString().slice(0, 10);
            const noteLine = buildSystemLateFeeNote({
              lateMinutes,
              visitDate,
              feeAmount,
            });
            await client.query(
              `UPDATE customers
               SET notes = CASE
                 WHEN notes IS NULL OR notes = '' THEN $1
                 ELSE notes || E'\\n' || $1
               END,
               updated_at = NOW()
               WHERE id = $2`,
              [noteLine, row.customer_id]
            );
          }

          // Log late checkout event if late >= 30 minutes
          if (lateMinutes >= 30) {
            await client.query(
              `INSERT INTO late_checkout_events (customer_id, occupancy_id, checkout_request_id, late_minutes, fee_amount, ban_applied)
               VALUES ($1, $2, NULL, $3, $4, $5)`,
              [row.customer_id, row.occupancy_id, lateMinutes, feeAmount, banApplied]
            );
          }

          return {
            alreadyCheckedOut: false,
            row,
            lateMinutes,
            feeAmount,
            banApplied,
            cancelledWaitlistIds: waitlistResult.rows.map((r) => r.id),
            visitId: row.visit_id,
          };
        });

        const row = 'row' in result ? result.row : (result as any).row;
        const alreadyCheckedOut = (result as any).alreadyCheckedOut === true;

        const resourceType: ManualCheckoutResourceType = row.locker_id ? 'LOCKER' : 'ROOM';
        const number = resourceType === 'LOCKER' ? row.locker_number : row.room_number;
        const scheduledCheckoutAt =
          row.scheduled_checkout_at instanceof Date
            ? row.scheduled_checkout_at
            : new Date(row.scheduled_checkout_at);

        if (!number) return reply.status(500).send({ error: 'Resource not found for occupancy' });

        // Broadcast inventory updates (same event types as existing checkout completion)
        if (fastify.broadcaster && !alreadyCheckedOut) {
          await broadcastInventoryUpdate(fastify.broadcaster);

          if (row.room_id) {
            fastify.broadcaster.broadcastRoomStatusChanged({
              roomId: row.room_id,
              previousStatus: RoomStatus.CLEAN,
              newStatus: RoomStatus.DIRTY,
              changedBy: staffId,
              override: false,
            });
          }
        }

        // Broadcast WAITLIST_UPDATED for system-cancelled waitlist entries (after commit)
        if (
          fastify.broadcaster &&
          !alreadyCheckedOut &&
          Array.isArray((result as any).cancelledWaitlistIds) &&
          (result as any).cancelledWaitlistIds.length > 0
        ) {
          for (const waitlistId of (result as any).cancelledWaitlistIds) {
            fastify.broadcaster.broadcast({
              type: 'WAITLIST_UPDATED',
              payload: {
                waitlistId,
                status: 'CANCELLED',
                visitId: (result as any).visitId,
              },
              timestamp: new Date().toISOString(),
            });
          }
        }

        const now = new Date();
        const lateMinutes =
          alreadyCheckedOut && typeof (result as any).lateMinutes !== 'number'
            ? Math.max(0, Math.floor((now.getTime() - scheduledCheckoutAt.getTime()) / (1000 * 60)))
            : (result as any).lateMinutes ?? Math.max(0, Math.floor((now.getTime() - scheduledCheckoutAt.getTime()) / (1000 * 60)));
        const fee = (result as any).feeAmount ?? calculateLateFee(lateMinutes).feeAmount;
        const banApplied = (result as any).banApplied ?? calculateLateFee(lateMinutes).banApplied;

        return reply.send({
          occupancyId: row.occupancy_id,
          resourceType,
          number,
          customerName: row.customer_name,
          checkinAt: row.checkin_at,
          scheduledCheckoutAt,
          lateMinutes,
          fee,
          banApplied,
          alreadyCheckedOut,
        });
      } catch (error) {
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message: string };
          return reply.status(err.statusCode).send({ error: err.message });
        }
        fastify.log.error(error, 'Failed to complete manual checkout');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * POST /v1/checkout/resolve-key - Resolve a key tag to checkout information
   *
   * Public endpoint for checkout kiosk to resolve a scanned key QR code.
   * Returns customer info, scheduled checkout time, and computed late fees.
   */
  fastify.post<{ Body: ResolveKeyInput }>('/v1/checkout/resolve-key', async (request, reply) => {
    let body: ResolveKeyInput;

    try {
      body = ResolveKeySchema.parse(request.body);
    } catch (error) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: error instanceof z.ZodError ? error.errors : 'Invalid input',
      });
    }

    try {
      // 1. Find the key tag
      const tagResult = await query<KeyTagRow>(
        `SELECT id, room_id, locker_id, tag_code, is_active
         FROM key_tags
         WHERE tag_code = $1 AND is_active = true`,
        [body.token]
      );

      if (tagResult.rows.length === 0) {
        return reply.status(404).send({
          error: 'Key tag not found or inactive',
        });
      }

      const tag = tagResult.rows[0]!;

      // 2. Find the active checkin block for this key
      let blockResult;
      if (tag.room_id) {
        blockResult = await query<CheckinBlockRow>(
          `SELECT cb.id, cb.visit_id, cb.block_type, cb.starts_at, cb.ends_at,
                  cb.rental_type::text as rental_type, cb.room_id, cb.locker_id, cb.session_id, cb.has_tv_remote
           FROM checkin_blocks cb
           JOIN visits v ON cb.visit_id = v.id
           WHERE cb.room_id = $1 AND v.ended_at IS NULL
           ORDER BY cb.ends_at DESC
           LIMIT 1`,
          [tag.room_id]
        );
      } else if (tag.locker_id) {
        blockResult = await query<CheckinBlockRow>(
          `SELECT cb.id, cb.visit_id, cb.block_type, cb.starts_at, cb.ends_at,
                  cb.rental_type::text as rental_type, cb.room_id, cb.locker_id, cb.session_id, cb.has_tv_remote
           FROM checkin_blocks cb
           JOIN visits v ON cb.visit_id = v.id
           WHERE cb.locker_id = $1 AND v.ended_at IS NULL
           ORDER BY cb.ends_at DESC
           LIMIT 1`,
          [tag.locker_id]
        );
      } else {
        return reply.status(404).send({
          error: 'Key tag is not associated with a room or locker',
        });
      }

      if (blockResult.rows.length === 0) {
        return reply.status(404).send({
          error: 'No active occupancy found for this key',
        });
      }

      const block = blockResult.rows[0]!;

      // 3. Get customer information
      const visitResult = await query<{ customer_id: string }>(
        'SELECT customer_id FROM visits WHERE id = $1',
        [block.visit_id]
      );

      if (visitResult.rows.length === 0) {
        return reply.status(404).send({
          error: 'Visit not found',
        });
      }

      const customerId = visitResult.rows[0]!.customer_id;

      const customerResult = await query<CustomerRow>(
        'SELECT id, name, membership_number, banned_until FROM customers WHERE id = $1',
        [customerId]
      );

      if (customerResult.rows.length === 0) {
        return reply.status(404).send({
          error: 'Customer not found',
        });
      }

      const customer = customerResult.rows[0]!;

      // 4. Get room/locker details
      let roomNumber: string | undefined;
      let lockerNumber: string | undefined;

      if (block.room_id) {
        const roomResult = await query<RoomRow>(
          'SELECT id, number, type FROM rooms WHERE id = $1',
          [block.room_id]
        );
        if (roomResult.rows.length > 0) {
          roomNumber = roomResult.rows[0]!.number;
        }
      }

      if (block.locker_id) {
        const lockerResult = await query<LockerRow>(
          'SELECT id, number FROM lockers WHERE id = $1',
          [block.locker_id]
        );
        if (lockerResult.rows.length > 0) {
          lockerNumber = lockerResult.rows[0]!.number;
        }
      }

      // 5. Calculate lateness
      const now = new Date();
      // Ensure ends_at is a Date object (PostgreSQL returns it as a Date, but be safe)
      const scheduledCheckoutAt =
        block.ends_at instanceof Date ? block.ends_at : new Date(block.ends_at);
      const lateMinutes = Math.max(
        0,
        Math.floor((now.getTime() - scheduledCheckoutAt.getTime()) / (1000 * 60))
      );
      const { feeAmount, banApplied } = calculateLateFee(lateMinutes);

      const result: ResolvedCheckoutKey = {
        keyTagId: tag.id,
        occupancyId: block.id,
        customerId: customer.id,
        customerName: customer.name,
        membershipNumber: customer.membership_number || undefined,
        rentalType: block.rental_type,
        roomId: block.room_id || undefined,
        roomNumber,
        lockerId: block.locker_id || undefined,
        lockerNumber,
        scheduledCheckoutAt,
        hasTvRemote: block.has_tv_remote,
        lateMinutes,
        lateFeeAmount: feeAmount,
        banApplied,
      };

      return reply.send(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      fastify.log.error(
        { error: errorMessage, stack: errorStack },
        'Failed to resolve checkout key'
      );
      return reply.status(500).send({
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'test' ? errorMessage : undefined,
      });
    }
  });

  /**
   * POST /v1/checkout/request - Create a checkout request
   *
   * Public endpoint for checkout kiosk to submit a checkout request.
   * Triggers CHECKOUT_REQUESTED WebSocket event.
   */
  fastify.post<{ Body: CreateCheckoutRequestInput }>(
    '/v1/checkout/request',
    async (request, reply) => {
      let body: CreateCheckoutRequestInput;

      try {
        body = CreateCheckoutRequestSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      try {
        const result = await serializableTransaction(async (client) => {
          // 1. Verify the block exists and is active
          const blockResult = await client.query<CheckinBlockRow & { customer_id: string }>(
            `SELECT cb.id, cb.visit_id, cb.block_type, cb.starts_at, cb.ends_at,
                  cb.rental_type::text as rental_type, cb.room_id, cb.locker_id, cb.session_id, cb.has_tv_remote,
                  v.customer_id
           FROM checkin_blocks cb
           JOIN visits v ON cb.visit_id = v.id
           WHERE cb.id = $1 AND v.ended_at IS NULL`,
            [body.occupancyId]
          );

          if (blockResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Active occupancy not found' };
          }

          const block = blockResult.rows[0]!;

          // 2. Check for existing active request
          const existingRequest = await client.query<CheckoutRequestRow>(
            `SELECT id FROM checkout_requests
           WHERE occupancy_id = $1 AND status IN ('SUBMITTED', 'CLAIMED')`,
            [body.occupancyId]
          );

          if (existingRequest.rows.length > 0) {
            throw {
              statusCode: 409,
              message: 'Checkout request already exists for this occupancy',
            };
          }

          // 3. Calculate lateness (same as resolve-key)
          const now = new Date();
          const scheduledCheckoutAt = block.ends_at;
          const lateMinutes = Math.max(
            0,
            Math.floor((now.getTime() - scheduledCheckoutAt.getTime()) / (1000 * 60))
          );
          const { feeAmount, banApplied } = calculateLateFee(lateMinutes);

          // 4. Get key tag ID if available
          let keyTagId: string | null = null;
          if (block.room_id) {
            const keyResult = await client.query<{ id: string }>(
              `SELECT id FROM key_tags WHERE room_id = $1 AND is_active = true LIMIT 1`,
              [block.room_id]
            );
            if (keyResult.rows.length > 0) {
              keyTagId = keyResult.rows[0]!.id;
            }
          } else if (block.locker_id) {
            const keyResult = await client.query<{ id: string }>(
              `SELECT id FROM key_tags WHERE locker_id = $1 AND is_active = true LIMIT 1`,
              [block.locker_id]
            );
            if (keyResult.rows.length > 0) {
              keyTagId = keyResult.rows[0]!.id;
            }
          }

          // 5. Create the checkout request
          const requestResult = await client.query<CheckoutRequestRow>(
            `INSERT INTO checkout_requests (
            occupancy_id, customer_id, key_tag_id, kiosk_device_id,
            customer_checklist_json, late_minutes, late_fee_amount, ban_applied
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id, occupancy_id, customer_id, key_tag_id, kiosk_device_id,
                    created_at, claimed_by_staff_id, claimed_at, claim_expires_at,
                    customer_checklist_json, status, late_minutes, late_fee_amount,
                    ban_applied, items_confirmed, fee_paid, completed_at`,
            [
              body.occupancyId,
              block.customer_id,
              keyTagId,
              body.kioskDeviceId,
              JSON.stringify(body.checklist),
              lateMinutes,
              feeAmount,
              banApplied,
            ]
          );

          return requestResult.rows[0]!;
        });

        // 6. Get customer and room/locker info for WebSocket event
        const blockResult = await query<CheckinBlockRow & { customer_id: string }>(
          `SELECT cb.id, cb.visit_id, cb.block_type, cb.starts_at, cb.ends_at,
                cb.rental_type::text as rental_type, cb.room_id, cb.locker_id, cb.session_id, cb.has_tv_remote,
                v.customer_id
         FROM checkin_blocks cb
         JOIN visits v ON cb.visit_id = v.id
         WHERE cb.id = $1`,
          [body.occupancyId]
        );
        const block = blockResult.rows[0]!;

        const customerResult = await query<CustomerRow>(
          'SELECT id, name, membership_number FROM customers WHERE id = $1',
          [block.customer_id]
        );
        const customer = customerResult.rows[0]!;

        let roomNumber: string | undefined;
        let lockerNumber: string | undefined;

        if (block.room_id) {
          const roomResult = await query<RoomRow>('SELECT number FROM rooms WHERE id = $1', [
            block.room_id,
          ]);
          if (roomResult.rows.length > 0) {
            roomNumber = roomResult.rows[0]!.number;
          }
        }

        if (block.locker_id) {
          const lockerResult = await query<LockerRow>('SELECT number FROM lockers WHERE id = $1', [
            block.locker_id,
          ]);
          if (lockerResult.rows.length > 0) {
            lockerNumber = lockerResult.rows[0]!.number;
          }
        }

        // 7. Broadcast CHECKOUT_REQUESTED event
        if (fastify.broadcaster) {
          const summary: CheckoutRequestSummary = {
            requestId: result.id,
            customerId: customer.id,
            customerName: customer.name,
            membershipNumber: customer.membership_number || undefined,
            rentalType: block.rental_type,
            roomNumber,
            lockerNumber,
            scheduledCheckoutAt: block.ends_at,
            currentTime: new Date(),
            lateMinutes: result.late_minutes,
            lateFeeAmount: result.late_fee_amount,
            banApplied: result.ban_applied,
          };

          const payload: CheckoutRequestedPayload = {
            request: summary,
          };

          fastify.broadcaster.broadcast({
            type: 'CHECKOUT_REQUESTED',
            payload,
            timestamp: new Date().toISOString(),
          });
        }

        return reply.status(201).send({
          requestId: result.id,
        });
      } catch (error) {
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message: string };
          return reply.status(err.statusCode).send({ error: err.message });
        }
        fastify.log.error(error, 'Failed to create checkout request');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * POST /v1/checkout/:requestId/claim - Claim a checkout request
   *
   * Employee endpoint to claim ownership of a checkout request.
   * Only employees not "mid-checkin" can claim.
   * Sets a 2-minute TTL lock.
   */
  fastify.post<{ Params: { requestId: string } }>(
    '/v1/checkout/:requestId/claim',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
      const staffId = request.staff.staffId;

      try {
        const result = await serializableTransaction(async (client) => {
          // 1. Check if employee is mid-checkin
          // For now, we'll allow claiming - in a production system, you might track
          // which staff member is working on which lane/session
          // This is a placeholder check - adjust based on your business logic

          // 2. Get the request and verify it's claimable
          const requestResult = await client.query<CheckoutRequestRow>(
            `SELECT id, occupancy_id, customer_id, key_tag_id, kiosk_device_id,
                  created_at, claimed_by_staff_id, claimed_at, claim_expires_at,
                  customer_checklist_json, status, late_minutes, late_fee_amount,
                  ban_applied, items_confirmed, fee_paid, completed_at
           FROM checkout_requests
           WHERE id = $1 FOR UPDATE`,
            [request.params.requestId]
          );

          if (requestResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Checkout request not found' };
          }

          const checkoutRequest = requestResult.rows[0]!;

          if (checkoutRequest.status !== 'SUBMITTED') {
            // Check if claim expired
            if (checkoutRequest.status === 'CLAIMED' && checkoutRequest.claim_expires_at) {
              const now = new Date();
              if (now > checkoutRequest.claim_expires_at) {
                // Claim expired, allow re-claim
                // Continue to claim logic
              } else {
                throw { statusCode: 409, message: 'Checkout request already claimed' };
              }
            } else {
              throw { statusCode: 409, message: `Checkout request is ${checkoutRequest.status}` };
            }
          }

          // 3. Claim the request with 2-minute TTL
          const now = new Date();
          const claimExpiresAt = new Date(now.getTime() + 2 * 60 * 1000); // 2 minutes

          const updateResult = await client.query<CheckoutRequestRow>(
            `UPDATE checkout_requests
           SET claimed_by_staff_id = $1, claimed_at = $2, claim_expires_at = $3, status = 'CLAIMED', updated_at = NOW()
           WHERE id = $4
           RETURNING id, occupancy_id, customer_id, key_tag_id, kiosk_device_id,
                     created_at, claimed_by_staff_id, claimed_at, claim_expires_at,
                     customer_checklist_json, status, late_minutes, late_fee_amount,
                     ban_applied, items_confirmed, fee_paid, completed_at`,
            [staffId, now, claimExpiresAt, request.params.requestId]
          );

          return updateResult.rows[0]!;
        });

        // 5. Broadcast CHECKOUT_CLAIMED event
        if (fastify.broadcaster) {
          const payload: CheckoutClaimedPayload = {
            requestId: result.id,
            claimedBy: staffId,
          };

          fastify.broadcaster.broadcast({
            type: 'CHECKOUT_CLAIMED',
            payload,
            timestamp: new Date().toISOString(),
          });
        }

        return reply.send({
          requestId: result.id,
          claimedBy: staffId,
          claimedAt: result.claimed_at,
          claimExpiresAt: result.claim_expires_at,
        });
      } catch (error) {
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message: string };
          return reply.status(err.statusCode).send({ error: err.message });
        }
        fastify.log.error(error, 'Failed to claim checkout request');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * POST /v1/checkout/:requestId/mark-fee-paid - Mark late fee as paid
   *
   * Employee endpoint to record manual payment confirmation.
   */
  fastify.post<{ Params: { requestId: string }; Body: MarkFeePaidInput }>(
    '/v1/checkout/:requestId/mark-fee-paid',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
      const staffId = request.staff.staffId;

      let body: MarkFeePaidInput;
      try {
        body = MarkFeePaidSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }
      void body;

      try {
        const result = await transaction(async (client) => {
          // 1. Verify request is claimed by this staff member
          const requestResult = await client.query<CheckoutRequestRow>(
            `SELECT id, claimed_by_staff_id, status, fee_paid
           FROM checkout_requests
           WHERE id = $1`,
            [request.params.requestId]
          );

          if (requestResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Checkout request not found' };
          }

          const checkoutRequest = requestResult.rows[0]!;

          if (checkoutRequest.claimed_by_staff_id !== staffId) {
            throw { statusCode: 403, message: 'Not authorized to update this checkout request' };
          }

          if (checkoutRequest.status !== 'CLAIMED') {
            throw { statusCode: 409, message: `Checkout request is ${checkoutRequest.status}` };
          }

          // 2. Mark fee as paid
          const updateResult = await client.query<CheckoutRequestRow>(
            `UPDATE checkout_requests
           SET fee_paid = true, updated_at = NOW()
           WHERE id = $1
           RETURNING id, items_confirmed, fee_paid`,
            [request.params.requestId]
          );

          return updateResult.rows[0]!;
        });

        // 3. Broadcast CHECKOUT_UPDATED event
        if (fastify.broadcaster) {
          const payload: CheckoutUpdatedPayload = {
            requestId: result.id,
            itemsConfirmed: result.items_confirmed,
            feePaid: result.fee_paid,
          };

          fastify.broadcaster.broadcast({
            type: 'CHECKOUT_UPDATED',
            payload,
            timestamp: new Date().toISOString(),
          });
        }

        return reply.send({
          requestId: result.id,
          feePaid: result.fee_paid,
        });
      } catch (error) {
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message: string };
          return reply.status(err.statusCode).send({ error: err.message });
        }
        fastify.log.error(error, 'Failed to mark fee as paid');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * POST /v1/checkout/:requestId/confirm-items - Confirm items returned
   *
   * Employee endpoint to mark items as verified.
   */
  fastify.post<{ Params: { requestId: string } }>(
    '/v1/checkout/:requestId/confirm-items',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
      const staffId = request.staff.staffId;

      try {
        const result = await transaction(async (client) => {
          // 1. Verify request is claimed by this staff member
          const requestResult = await client.query<CheckoutRequestRow>(
            `SELECT id, claimed_by_staff_id, status, items_confirmed
           FROM checkout_requests
           WHERE id = $1`,
            [request.params.requestId]
          );

          if (requestResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Checkout request not found' };
          }

          const checkoutRequest = requestResult.rows[0]!;

          if (checkoutRequest.claimed_by_staff_id !== staffId) {
            throw { statusCode: 403, message: 'Not authorized to update this checkout request' };
          }

          if (checkoutRequest.status !== 'CLAIMED') {
            throw { statusCode: 409, message: `Checkout request is ${checkoutRequest.status}` };
          }

          // 2. Mark items as confirmed
          const updateResult = await client.query<CheckoutRequestRow>(
            `UPDATE checkout_requests
           SET items_confirmed = true, updated_at = NOW()
           WHERE id = $1
           RETURNING id, items_confirmed, fee_paid`,
            [request.params.requestId]
          );

          return updateResult.rows[0]!;
        });

        // 3. Broadcast CHECKOUT_UPDATED event
        if (fastify.broadcaster) {
          const payload: CheckoutUpdatedPayload = {
            requestId: result.id,
            itemsConfirmed: result.items_confirmed,
            feePaid: result.fee_paid,
          };

          fastify.broadcaster.broadcast({
            type: 'CHECKOUT_UPDATED',
            payload,
            timestamp: new Date().toISOString(),
          });
        }

        return reply.send({
          requestId: result.id,
          itemsConfirmed: result.items_confirmed,
        });
      } catch (error) {
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message: string };
          return reply.status(err.statusCode).send({ error: err.message });
        }
        fastify.log.error(error, 'Failed to confirm items');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * POST /v1/checkout/:requestId/complete - Complete checkout
   *
   * Employee endpoint to finalize checkout.
   * Updates room/locker status, logs events, applies bans, and emits WebSocket updates.
   */
  fastify.post<{ Params: { requestId: string } }>(
    '/v1/checkout/:requestId/complete',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
      const staffId = request.staff.staffId;

      try {
        const result = await serializableTransaction(async (client) => {
          // 1. Get the checkout request
          const requestResult = await client.query<CheckoutRequestRow>(
            `SELECT id, occupancy_id, customer_id, key_tag_id, kiosk_device_id,
                  created_at, claimed_by_staff_id, claimed_at, claim_expires_at,
                  customer_checklist_json, status, late_minutes, late_fee_amount,
                  ban_applied, items_confirmed, fee_paid, completed_at
           FROM checkout_requests
           WHERE id = $1 FOR UPDATE`,
            [request.params.requestId]
          );

          if (requestResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Checkout request not found' };
          }

          const checkoutRequest = requestResult.rows[0]!;

          if (checkoutRequest.claimed_by_staff_id !== staffId) {
            throw { statusCode: 403, message: 'Not authorized to complete this checkout request' };
          }

          if (checkoutRequest.status !== 'CLAIMED') {
            throw { statusCode: 409, message: `Checkout request is ${checkoutRequest.status}` };
          }

          if (!checkoutRequest.items_confirmed) {
            throw {
              statusCode: 400,
              message: 'Items must be confirmed before completing checkout',
            };
          }

          if (checkoutRequest.late_fee_amount > 0 && !checkoutRequest.fee_paid) {
            throw { statusCode: 400, message: 'Late fee must be paid before completing checkout' };
          }

          // 2. Get the checkin block
          const blockResult = await client.query<CheckinBlockRow & { customer_id: string }>(
            `SELECT cb.id, cb.visit_id, cb.block_type, cb.starts_at, cb.ends_at,
                  cb.rental_type::text as rental_type, cb.room_id, cb.locker_id, cb.session_id, cb.has_tv_remote,
                  v.customer_id
           FROM checkin_blocks cb
           JOIN visits v ON cb.visit_id = v.id
           WHERE cb.id = $1`,
            [checkoutRequest.occupancy_id]
          );

          if (blockResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Occupancy not found' };
          }

          const block = blockResult.rows[0]!;

          // 2b. Cancel any active waitlist entries for this visit (system cancel on checkout)
          const waitlistResult = await client.query<WaitlistStatusRow>(
            `SELECT id, status
             FROM waitlist
             WHERE visit_id = $1 AND status IN ('ACTIVE','OFFERED')
             FOR UPDATE`,
            [block.visit_id]
          );

          if (waitlistResult.rows.length > 0) {
            const waitlistIds = waitlistResult.rows.map((r) => r.id);

            await client.query(
              `UPDATE waitlist
               SET status = 'CANCELLED',
                   cancelled_at = NOW(),
                   cancelled_by_staff_id = NULL,
                   updated_at = NOW()
               WHERE id = ANY($1::uuid[])`,
              [waitlistIds]
            );

            const auditStaffId = looksLikeUuid(staffId) ? staffId : null;
            for (const row of waitlistResult.rows) {
              await insertAuditLog(client, {
                staffId: auditStaffId,
                action: 'WAITLIST_CANCELLED',
                entityType: 'waitlist',
                entityId: row.id,
                oldValue: { status: row.status },
                newValue: { status: 'CANCELLED', reason: 'CHECKED_OUT' },
              });
            }
          }

          // 3. Update room to DIRTY or locker to AVAILABLE
          if (block.room_id) {
            await client.query(
              `UPDATE rooms SET status = $1, assigned_to_customer_id = NULL, updated_at = NOW() WHERE id = $2`,
              [RoomStatus.DIRTY, block.room_id]
            );
          }

          if (block.locker_id) {
            await client.query(
              `UPDATE lockers SET status = $1, assigned_to_customer_id = NULL, updated_at = NOW() WHERE id = $2`,
              [RoomStatus.CLEAN, block.locker_id] // CLEAN = AVAILABLE for lockers
            );
          }

          // 4. End the visit
          await client.query(
            `UPDATE visits SET ended_at = NOW(), updated_at = NOW() WHERE id = $1`,
            [block.visit_id]
          );

          // 6. Apply ban if needed
          if (checkoutRequest.ban_applied) {
            const banUntil = new Date();
            banUntil.setDate(banUntil.getDate() + 30); // 30 days from now
            await client.query(
              `UPDATE customers SET banned_until = $1, updated_at = NOW() WHERE id = $2`,
              [banUntil, checkoutRequest.customer_id]
            );
          }

          // 6b. Late fee bookkeeping (NO amount/rate changes):
          // - itemize as a charges row
          // - increment past_due_balance
          // - append system note (auto-archived on next successful check-in)
          const feeAmount = Number(checkoutRequest.late_fee_amount) || 0;
          if (feeAmount > 0) {
            await client.query(
              `UPDATE customers
               SET past_due_balance = past_due_balance + $1,
                   updated_at = NOW()
               WHERE id = $2`,
              [feeAmount, checkoutRequest.customer_id]
            );

            const existingLate = await client.query<{ id: string }>(
              `SELECT id FROM charges WHERE checkin_block_id = $1 AND type = 'LATE_FEE' LIMIT 1`,
              [block.id]
            );
            if (existingLate.rows.length === 0) {
              await client.query(
                `INSERT INTO charges (visit_id, checkin_block_id, type, amount, payment_intent_id)
                 VALUES ($1, $2, 'LATE_FEE', $3, NULL)`,
                [block.visit_id, block.id, feeAmount]
              );
            }

            const now = new Date();
            const scheduledCheckoutAt =
              block.ends_at instanceof Date ? block.ends_at : new Date(block.ends_at);
            const lateMinutesActual = Math.max(
              0,
              Math.floor((now.getTime() - scheduledCheckoutAt.getTime()) / (1000 * 60))
            );
            const visitRow = await client.query<VisitDateRow>(
              `SELECT started_at FROM visits WHERE id = $1 LIMIT 1`,
              [block.visit_id]
            );
            const visitDate = visitRow.rows[0]?.started_at
              ? visitRow.rows[0]!.started_at.toISOString().slice(0, 10)
              : now.toISOString().slice(0, 10);
            const noteLine = buildSystemLateFeeNote({
              lateMinutes: lateMinutesActual,
              visitDate,
              feeAmount,
            });
            await client.query(
              `UPDATE customers
               SET notes = CASE
                 WHEN notes IS NULL OR notes = '' THEN $1
                 ELSE notes || E'\\n' || $1
               END,
               updated_at = NOW()
               WHERE id = $2`,
              [noteLine, checkoutRequest.customer_id]
            );
          }

          // 7. Log late checkout event if late >= 30 minutes
          if (checkoutRequest.late_minutes >= 30) {
            await client.query(
              `INSERT INTO late_checkout_events (customer_id, occupancy_id, checkout_request_id, late_minutes, fee_amount, ban_applied)
             VALUES ($1, $2, $3, $4, $5, $6)`,
              [
                checkoutRequest.customer_id,
                checkoutRequest.occupancy_id,
                checkoutRequest.id,
                checkoutRequest.late_minutes,
                checkoutRequest.late_fee_amount,
                checkoutRequest.ban_applied,
              ]
            );
          }

          // 8. Mark checkout request as completed
          const now = new Date();
          await client.query(
            `UPDATE checkout_requests
           SET status = 'VERIFIED', completed_at = $1, updated_at = NOW()
           WHERE id = $2`,
            [now, checkoutRequest.id]
          );

          return {
            requestId: checkoutRequest.id,
            kioskDeviceId: checkoutRequest.kiosk_device_id,
            roomId: block.room_id,
            lockerId: block.locker_id,
            visitId: block.visit_id,
            cancelledWaitlistIds: waitlistResult.rows.map((r) => r.id),
          };
        });

        // 9. Broadcast inventory updates
        if (fastify.broadcaster) {
          // Import inventory broadcast function
          await broadcastInventoryUpdate(fastify.broadcaster);

          // Broadcast room status changes if applicable
          if (result.roomId) {
            fastify.broadcaster.broadcastRoomStatusChanged({
              roomId: result.roomId,
              previousStatus: RoomStatus.CLEAN,
              newStatus: RoomStatus.DIRTY,
              changedBy: staffId,
              override: false,
            });
          }
        }

        // 9b. Broadcast WAITLIST_UPDATED for system-cancelled waitlist entries (after commit)
        if (fastify.broadcaster && result.cancelledWaitlistIds.length > 0) {
          for (const waitlistId of result.cancelledWaitlistIds) {
            fastify.broadcaster.broadcast({
              type: 'WAITLIST_UPDATED',
              payload: {
                waitlistId,
                status: 'CANCELLED',
                visitId: result.visitId,
              },
              timestamp: new Date().toISOString(),
            });
          }
        }

        // 10. Broadcast CHECKOUT_COMPLETED event (for kiosk)
        if (fastify.broadcaster) {
          const payload: CheckoutCompletedPayload = {
            requestId: result.requestId,
            kioskDeviceId: result.kioskDeviceId,
            success: true,
          };

          fastify.broadcaster.broadcast({
            type: 'CHECKOUT_COMPLETED',
            payload,
            timestamp: new Date().toISOString(),
          });
        }

        return reply.send({
          requestId: result.requestId,
          completed: true,
        });
      } catch (error) {
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message: string };
          return reply.status(err.statusCode).send({ error: err.message });
        }
        fastify.log.error(error, 'Failed to complete checkout');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
