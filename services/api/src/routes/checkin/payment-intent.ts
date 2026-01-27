import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../auth/middleware';
import { calculatePriceQuote, calculateRenewalQuote, type PricingInput } from '../../pricing/engine';
import { transaction } from '../../db';
import type { CustomerRow, LaneSessionRow, PaymentIntentRow } from '../../checkin/types';
import { buildFullSessionUpdatedPayload } from '../../checkin/payload';
import { getHttpError, toDate, toNumber } from '../../checkin/utils';
import { calculateAge } from '../../checkin/identity';
import { insertAuditLog } from '../../audit/auditLog';

export function registerCheckinPaymentIntentRoutes(fastify: FastifyInstance): void {
  /**
   * POST /v1/checkin/lane/:laneId/create-payment-intent
   *
   * Create a payment intent with DUE status from the price quote.
   */
  fastify.post<{
    Params: { laneId: string };
  }>(
    '/v1/checkin/lane/:laneId/create-payment-intent',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const { laneId } = request.params;

      try {
        const result = await transaction(async (client) => {
          // Get active session
          const sessionResult = await client.query<LaneSessionRow>(
            `SELECT * FROM lane_sessions
           WHERE lane_id = $1 AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT')
           ORDER BY created_at DESC
           LIMIT 1`,
            [laneId]
          );

          if (sessionResult.rows.length === 0) {
            throw { statusCode: 404, message: 'No active session found' };
          }

          const session = sessionResult.rows[0]!;

          // Payment intent is created once selection is confirmed/locked (no inventory assignment required)
          if (!session.selection_confirmed || !session.selection_locked_at) {
            throw {
              statusCode: 400,
              message: 'Selection must be confirmed/locked before creating payment intent',
            };
          }

          if (!session.desired_rental_type && !session.backup_rental_type) {
            throw { statusCode: 400, message: 'No desired rental type set on session' };
          }

          // Get customer info for pricing
          let customerAge: number | undefined;
          let membershipCardType: 'NONE' | 'SIX_MONTH' | undefined;
          let membershipValidUntil: Date | undefined;

          if (session.customer_id) {
            const customerResult = await client.query<CustomerRow>(
              `SELECT dob, membership_card_type, membership_valid_until FROM customers WHERE id = $1`,
              [session.customer_id]
            );
            if (customerResult.rows.length > 0) {
              const customer = customerResult.rows[0]!;
              customerAge = calculateAge(customer.dob);
              membershipCardType =
                (customer.membership_card_type as 'NONE' | 'SIX_MONTH') || undefined;
              membershipValidUntil = toDate(customer.membership_valid_until) || undefined;
            }
          }

          // Determine rental type
          const rentalType = (session.desired_rental_type ||
            session.backup_rental_type ||
            'LOCKER') as 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL' | 'GYM_LOCKER';

          const isRenewal = session.checkin_mode === 'RENEWAL';
          const renewalHours =
            session.renewal_hours === 2 || session.renewal_hours === 6
              ? session.renewal_hours
              : null;
          if (isRenewal && !renewalHours) {
            throw { statusCode: 400, message: 'Renewal hours not set for this session' };
          }

          // Calculate price quote
          const pricingInput: PricingInput = {
            rentalType,
            customerAge,
            checkInTime: new Date(),
            membershipCardType,
            membershipValidUntil,
            includeSixMonthMembershipPurchase: !!session.membership_purchase_intent,
          };

          const quote = isRenewal
            ? calculateRenewalQuote({
                ...pricingInput,
                renewalHours,
              })
            : calculatePriceQuote(pricingInput);

          // Ensure at most one active DUE payment intent for this lane session.
          // - If one exists, reuse newest DUE and cancel extras.
          // - Otherwise create a new one.
          const dueIntents = await client.query<PaymentIntentRow>(
            `SELECT * FROM payment_intents
           WHERE lane_session_id = $1 AND status = 'DUE'
           ORDER BY created_at DESC`,
            [session.id]
          );

          let intent: PaymentIntentRow;
          if (dueIntents.rows.length > 0) {
            intent = dueIntents.rows[0]!;
            if (dueIntents.rows.length > 1) {
              const extraIds = dueIntents.rows.slice(1).map((r) => r.id);
              await client.query(
                `UPDATE payment_intents SET status = 'CANCELLED', updated_at = NOW() WHERE id = ANY($1::uuid[])`,
                [extraIds]
              );
            }
            // Keep the intent quote authoritative to the locked selection
            await client.query(
              `UPDATE payment_intents
             SET amount = $1,
                 quote_json = $2,
                 updated_at = NOW()
             WHERE id = $3`,
              [quote.total, JSON.stringify(quote), intent.id]
            );
          } else {
            const intentResult = await client.query<PaymentIntentRow>(
              `INSERT INTO payment_intents 
             (lane_session_id, amount, status, quote_json)
             VALUES ($1, $2, 'DUE', $3)
             RETURNING *`,
              [session.id, quote.total, JSON.stringify(quote)]
            );
            intent = intentResult.rows[0]!;
          }

          // Update session with payment intent and quote
          await client.query(
            `UPDATE lane_sessions
           SET payment_intent_id = $1,
               price_quote_json = $2,
               status = 'AWAITING_PAYMENT',
               updated_at = NOW()
           WHERE id = $3`,
            [intent.id, JSON.stringify(quote), session.id]
          );

          return {
            sessionId: session.id,
            paymentIntentId: intent.id,
            amount: toNumber(intent.amount),
            quote,
          };
        });

        // Broadcast full session update (stable payload)
        const { payload } = await transaction((client) =>
          buildFullSessionUpdatedPayload(client, result.sessionId)
        );
        fastify.broadcaster.broadcastSessionUpdated(payload, laneId);

        return reply.send({
          paymentIntentId: result.paymentIntentId,
          amount: result.amount,
          quote: result.quote,
        });
      } catch (error: unknown) {
        request.log.error(error, 'Failed to create payment intent');
        const httpErr = getHttpError(error);
        if (httpErr) {
          return reply.status(httpErr.statusCode).send({
            error: httpErr.message ?? 'Failed to create payment intent',
          });
        }
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to create payment intent',
        });
      }
    }
  );

  /**
   * POST /v1/payments/:id/mark-paid
   *
   * Mark a payment intent as PAID (called after Square payment).
   */
  fastify.post<{
    Params: { id: string };
    Body: { squareTransactionId?: string };
  }>(
    '/v1/payments/:id/mark-paid',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
      const staffId = request.staff.staffId;

      const { id } = request.params;
      const { squareTransactionId } = request.body;

      try {
        const result = await transaction(async (client) => {
          // Get payment intent
          const intentResult = await client.query<PaymentIntentRow>(
            `SELECT * FROM payment_intents WHERE id = $1`,
            [id]
          );

          if (intentResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Payment intent not found' };
          }

          const intent = intentResult.rows[0]!;

          if (intent.status === 'PAID') {
            return { paymentIntentId: intent.id, status: 'PAID', alreadyPaid: true };
          }

          // Mark as paid
          await client.query(
            `UPDATE payment_intents
           SET status = 'PAID',
               paid_at = NOW(),
               square_transaction_id = $1,
               updated_at = NOW()
           WHERE id = $2`,
            [squareTransactionId || null, id]
          );

          // Check payment intent type from quote_json
          const quote = intent.quote_json as {
            type?: string;
            waitlistId?: string;
            visitId?: string;
            blockId?: string;
          };
          const paymentType = quote.type;

          // Handle upgrade payment completion
          if (paymentType === 'UPGRADE' && quote.waitlistId) {
            // Import upgrade completion function (will be called via API)
            // For now, log that upgrade payment is ready
            await insertAuditLog(client, {
              staffId,
              action: 'UPGRADE_PAID',
              entityType: 'payment_intent',
              entityId: id,
              oldValue: { status: 'DUE' },
              newValue: { status: 'PAID', waitlistId: quote.waitlistId },
            });
            // Note: Actual upgrade completion should be called via /v1/upgrades/complete
          }
          // Handle final extension payment completion
          else if (paymentType === 'FINAL_EXTENSION' && quote.visitId && quote.blockId) {
            await insertAuditLog(client, {
              staffId,
              action: 'FINAL_EXTENSION_PAID',
              entityType: 'payment_intent',
              entityId: id,
              oldValue: { status: 'DUE' },
              newValue: { status: 'PAID', visitId: quote.visitId, blockId: quote.blockId },
            });

            // Mark final extension as completed
            await insertAuditLog(client, {
              staffId,
              action: 'FINAL_EXTENSION_COMPLETED',
              entityType: 'visit',
              entityId: quote.visitId,
              oldValue: { paymentIntentId: id, status: 'DUE' },
              newValue: { paymentIntentId: id, status: 'PAID', blockId: quote.blockId },
            });
          }
          // Handle regular check-in payment
          else {
            // Update lane session status
            const sessionResult = await client.query<LaneSessionRow>(
              `SELECT * FROM lane_sessions WHERE payment_intent_id = $1`,
              [id]
            );

            if (sessionResult.rows.length > 0) {
              const session = sessionResult.rows[0]!;

              // For the demo check-in flow, payment completion moves the session to signature gating.
              // Inventory assignment happens after agreement signing.
              const newStatus = 'AWAITING_SIGNATURE';

              await client.query(
                `UPDATE lane_sessions SET status = $1, updated_at = NOW() WHERE id = $2`,
                [newStatus, session.id]
              );

              return {
                paymentIntentId: intent.id,
                status: 'PAID',
                laneSessionToBroadcast: { sessionId: session.id, laneId: session.lane_id },
              };
            }
          }

          return {
            paymentIntentId: intent.id,
            status: 'PAID',
            laneSessionToBroadcast: null as null | { sessionId: string; laneId: string },
          };
        });

        if (result.laneSessionToBroadcast) {
          const { payload } = await transaction((client) =>
            buildFullSessionUpdatedPayload(client, result.laneSessionToBroadcast!.sessionId)
          );
          fastify.broadcaster.broadcastSessionUpdated(
            payload,
            result.laneSessionToBroadcast.laneId
          );
        }

        const { laneSessionToBroadcast, ...apiResult } = result;
        void laneSessionToBroadcast;
        return reply.send(apiResult);
      } catch (error: unknown) {
        request.log.error(error, 'Failed to mark payment as paid');
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message?: string };
          return reply.status(err.statusCode).send({
            error: err.message || 'Failed to mark payment as paid',
          });
        }
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to mark payment as paid',
        });
      }
    }
  );
}
