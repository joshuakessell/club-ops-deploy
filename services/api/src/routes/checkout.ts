import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { serializableTransaction, query, transaction } from '../db/index.js';
import { requireAuth } from '../auth/middleware.js';
import type { Broadcaster } from '../websocket/broadcaster.js';
import type {
  CheckoutRequestedPayload,
  CheckoutClaimedPayload,
  CheckoutUpdatedPayload,
  CheckoutCompletedPayload,
  ResolvedCheckoutKey,
  CheckoutRequestSummary,
} from '@club-ops/shared';
import { RoomStatus } from '@club-ops/shared';

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

/**
 * Checkout routes for customer-operated checkout kiosk and employee verification.
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function checkoutRoutes(fastify: FastifyInstance): Promise<void> {
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

          // 5. Update session status if exists
          if (block.session_id) {
            await client.query(
              `UPDATE sessions SET status = 'COMPLETED', check_out_time = NOW(), updated_at = NOW() WHERE id = $1`,
              [block.session_id]
            );
          }

          // 6. Apply ban if needed
          if (checkoutRequest.ban_applied) {
            const banUntil = new Date();
            banUntil.setDate(banUntil.getDate() + 30); // 30 days from now
            await client.query(
              `UPDATE customers SET banned_until = $1, updated_at = NOW() WHERE id = $2`,
              [banUntil, checkoutRequest.customer_id]
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
          };
        });

        // 9. Broadcast inventory updates
        if (fastify.broadcaster) {
          // Import inventory broadcast function
          const { broadcastInventoryUpdate } = await import('./sessions.js');
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
