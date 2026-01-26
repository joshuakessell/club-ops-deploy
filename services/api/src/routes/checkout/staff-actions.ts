import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../auth/middleware';
import { serializableTransaction, transaction } from '../../db';
import type { CheckoutRequestRow, CustomerRow, KeyTagRow, LockerRow, RoomRow } from '../../checkout/types';
import { MarkFeePaidSchema, type MarkFeePaidInput } from '../../checkout/schemas';
import type { CheckoutClaimedPayload, CheckoutCompletedPayload, CheckoutUpdatedPayload } from '@club-ops/shared';
import { RoomStatus } from '@club-ops/shared';
import { broadcastInventoryUpdate } from '../../inventory/broadcast';
import { insertAuditLog } from '../../audit/auditLog';
import { calculateLateFee, looksLikeUuid } from '../../checkout/utils';
import { buildSystemLateFeeNote } from '../../utils/lateFeeNotes';

export function registerCheckoutStaffRoutes(fastify: FastifyInstance): void {
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
