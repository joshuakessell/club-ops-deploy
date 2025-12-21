import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { query, transaction, serializableTransaction } from '../db/index.js';
import { requireAuth } from '../auth/middleware.js';
import type { Broadcaster } from '../websocket/broadcaster.js';
import type { 
  SessionUpdatedPayload,
  CustomerConfirmationRequiredPayload,
  CustomerConfirmedPayload,
  CustomerDeclinedPayload,
  AssignmentCreatedPayload,
  AssignmentFailedPayload,
} from '@club-ops/shared';
import { calculatePriceQuote, type PricingInput } from '../pricing/engine.js';

declare module 'fastify' {
  interface FastifyInstance {
    broadcaster: Broadcaster;
  }
}

// Import getRoomTier from checkin routes (defined locally)
// This is used in completeCheckIn and elsewhere

interface LaneSessionRow {
  id: string;
  lane_id: string;
  status: string;
  staff_id: string | null;
  customer_id: string | null;
  customer_display_name: string | null;
  membership_number: string | null;
  desired_rental_type: string | null;
  waitlist_desired_type: string | null;
  backup_rental_type: string | null;
  assigned_resource_id: string | null;
  assigned_resource_type: string | null;
  price_quote_json: unknown;
  disclaimers_ack_json: unknown;
  payment_intent_id: string | null;
  checkin_mode: string | null; // 'CHECKIN' or 'RENEWAL' (matches SCHEMA_OVERVIEW LaneSessionMode)
  created_at: Date;
  updated_at: Date;
}

interface CustomerRow {
  id: string;
  name: string;
  dob: Date | null;
  membership_number: string | null;
  membership_card_type: string | null;
  membership_valid_until: Date | null;
  banned_until: Date | null;
}


interface RoomRow {
  id: string;
  number: string;
  type: string;
  status: string;
  assigned_to_customer_id: string | null;
}

interface LockerRow {
  id: string;
  number: string;
  status: string;
  assigned_to_customer_id: string | null;
}

interface PaymentIntentRow {
  id: string;
  lane_session_id: string;
  amount: number;
  status: string;
  quote_json: unknown;
}

/**
 * Check if a membership number is eligible for Gym Locker rental.
 */
function isGymLockerEligible(membershipNumber: string | null | undefined): boolean {
  if (!membershipNumber) {
    return false;
  }

  const rangesEnv = process.env.GYM_LOCKER_ELIGIBLE_RANGES || '';
  if (!rangesEnv.trim()) {
    return false;
  }

  const membershipNum = parseInt(membershipNumber, 10);
  if (isNaN(membershipNum)) {
    return false;
  }

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
  const allowed: string[] = ['LOCKER', 'STANDARD', 'DOUBLE', 'SPECIAL'];
  
  if (isGymLockerEligible(membershipNumber)) {
    allowed.push('GYM_LOCKER');
  }
  
  return allowed;
}

/**
 * Parse membership number from scan input.
 * Supports configurable regex pattern.
 */
function parseMembershipNumber(scanValue: string): string | null {
  // Default: extract digits only
  const pattern = process.env.MEMBERSHIP_SCAN_PATTERN || '\\d+';
  const regex = new RegExp(pattern);
  const match = scanValue.match(regex);
  return match ? match[0] : null;
}

/**
 * Calculate customer age from date of birth.
 */
function calculateAge(dob: Date | null): number | undefined {
  if (!dob) {
    return undefined;
  }
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

/**
 * Map room number to tier (Special, Double, or Standard).
 */
function getRoomTier(roomNumber: string): 'SPECIAL' | 'DOUBLE' | 'STANDARD' {
  const num = parseInt(roomNumber, 10);
  
  // Special: rooms 201, 232, 256
  if (num === 201 || num === 232 || num === 256) {
    return 'SPECIAL';
  }
  
  // Double: even rooms 216, 218, 232, 252, 256, 262 and odd room 225
  if (num === 216 || num === 218 || num === 232 || num === 252 || num === 256 || num === 262 || num === 225) {
    return 'DOUBLE';
  }
  
  // All else standard
  return 'STANDARD';
}

/**
 * Check-in flow routes.
 */
export async function checkinRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /v1/checkin/lane/:laneId/start
   * 
   * Start a lane session with customer identification.
   * Input: { idScanValue, membershipScanValue? }
   * Output: laneSession + customer display fields
   */
  fastify.post('/v1/checkin/lane/:laneId/start', {
    preHandler: [requireAuth],
  }, async (
    request: FastifyRequest<{
      Params: { laneId: string };
      Body: { idScanValue: string; membershipScanValue?: string; checkinMode?: 'CHECKIN' | 'RENEWAL'; visitId?: string };
    }>,
    reply: FastifyReply
  ) => {
    if (!request.staff) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { laneId } = request.params;
    const { idScanValue, membershipScanValue, checkinMode = 'CHECKIN', visitId } = request.body;

    // Validate checkinMode
    if (checkinMode !== 'CHECKIN' && checkinMode !== 'RENEWAL') {
      return reply.status(400).send({ error: 'Invalid checkinMode. Must be CHECKIN or RENEWAL' });
    }

    // For RENEWAL mode, visitId is required
    if (checkinMode === 'RENEWAL' && !visitId) {
      return reply.status(400).send({ error: 'visitId is required for RENEWAL mode' });
    }

    try {
      const result = await transaction(async (client) => {
        // Parse membership number if provided
        const membershipNumber = membershipScanValue 
          ? parseMembershipNumber(membershipScanValue) 
          : null;

        // Look up or create customer
        let customerId: string | null = null;
        let customerName = 'Customer'; // Default, will be updated from ID scan
        
        // For Phase 2: Store ID scan hash and value
        // For now, use ID scan value as display name (simplified)
        customerName = idScanValue;

        // Try to find existing customer by membership number
        if (membershipNumber) {
          const customerResult = await client.query<CustomerRow>(
            `SELECT id, name, dob, membership_number, membership_card_type, membership_valid_until, banned_until
             FROM customers
             WHERE membership_number = $1
             LIMIT 1`,
            [membershipNumber]
          );

          if (customerResult.rows.length > 0) {
            const customer = customerResult.rows[0]!;
            customerId = customer.id;
            customerName = customer.name;
            
            // Check if banned
            if (customer.banned_until && new Date() < customer.banned_until) {
              throw { statusCode: 403, message: 'Customer is banned until ' + customer.banned_until.toISOString() };
            }
          }
        }

        // For RENEWAL mode, fetch visit information
        let visitIdForSession: string | null = null;
        let blockEndsAt: Date | null = null;
        let currentTotalHours = 0;

        if (checkinMode === 'RENEWAL' && visitId) {
          // Verify visit exists and belongs to customer
          const visitResult = await client.query<{
            id: string;
            customer_id: string;
            started_at: Date;
          }>(
            `SELECT id, customer_id, started_at FROM visits WHERE id = $1`,
            [visitId]
          );

          if (visitResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Visit not found' };
          }

          const visit = visitResult.rows[0]!;
          if (customerId && visit.customer_id !== customerId) {
            throw { statusCode: 403, message: 'Visit does not belong to this customer' };
          }

          visitIdForSession = visit.id;

          // Get current blocks to calculate total hours and find latest checkout time
          const blocksResult = await client.query<{
            ends_at: Date;
            starts_at: Date;
          }>(
            `SELECT starts_at, ends_at FROM checkin_blocks 
             WHERE visit_id = $1 ORDER BY ends_at DESC`,
            [visitId]
          );

          if (blocksResult.rows.length > 0) {
            // Latest block end time is the checkout time for renewal
            blockEndsAt = blocksResult.rows[0]!.ends_at;

            // Calculate total hours
            for (const block of blocksResult.rows) {
              const hours = (block.ends_at.getTime() - block.starts_at.getTime()) / (1000 * 60 * 60);
              currentTotalHours += hours;
            }
          }
        }

        // Create or update lane session
        const existingSession = await client.query<LaneSessionRow>(
          `SELECT id, status FROM lane_sessions
           WHERE lane_id = $1 AND status IN ('IDLE', 'ACTIVE', 'AWAITING_CUSTOMER')
           ORDER BY created_at DESC
           LIMIT 1`,
          [laneId]
        );

        let session: LaneSessionRow;

        if (existingSession.rows.length > 0 && existingSession.rows[0]!.status !== 'COMPLETED') {
          // Update existing session
          const updateResult = await client.query<LaneSessionRow>(
            `UPDATE lane_sessions
             SET customer_display_name = $1,
                 membership_number = $2,
                 customer_id = $3,
                 status = 'ACTIVE',
                 staff_id = $4,
                 checkin_mode = $5,
                 updated_at = NOW()
             WHERE id = $6
             RETURNING *`,
            [customerName, membershipNumber, customerId, request.staff.staffId, checkinMode, existingSession.rows[0]!.id]
          );
          session = updateResult.rows[0]!;
        } else {
          // Create new session
          const newSessionResult = await client.query<LaneSessionRow>(
            `INSERT INTO lane_sessions 
             (lane_id, status, staff_id, customer_id, customer_display_name, membership_number, checkin_mode)
             VALUES ($1, 'ACTIVE', $2, $3, $4, $5, $6)
             RETURNING *`,
            [laneId, request.staff.staffId, customerId, customerName, membershipNumber, checkinMode]
          );
          session = newSessionResult.rows[0]!;
        }

        // Determine allowed rentals
        const allowedRentals = getAllowedRentals(membershipNumber);

        // Broadcast SESSION_UPDATED event
        const payload: SessionUpdatedPayload = {
          sessionId: session.id,
          customerName: session.customer_display_name || '',
          membershipNumber: session.membership_number || undefined,
          allowedRentals,
          mode: checkinMode === 'RENEWAL' ? 'RENEWAL' : 'CHECKIN',
          blockEndsAt: blockEndsAt ? blockEndsAt.toISOString() : undefined,
          visitId: visitIdForSession || undefined,
          status: session.status,
        };

        fastify.broadcaster.broadcastSessionUpdated(payload, laneId);

        return {
          sessionId: session.id,
          customerName: session.customer_display_name,
          membershipNumber: session.membership_number,
          allowedRentals,
          mode: checkinMode,
          blockEndsAt: blockEndsAt ? blockEndsAt.toISOString() : undefined,
          visitId: visitIdForSession || undefined,
          currentTotalHours: checkinMode === 'RENEWAL' ? currentTotalHours : undefined,
        };
      });

      return reply.send(result);
    } catch (error: unknown) {
      request.log.error(error, 'Failed to start lane session');
      if (error && typeof error === 'object' && 'statusCode' in error) {
        return reply.status((error as { statusCode: number }).statusCode).send({
          error: (error as { message: string }).message || 'Failed to start session',
        });
      }
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to start lane session',
      });
    }
  });

  /**
   * POST /v1/checkin/lane/:laneId/select-rental
   * 
   * Customer selects rental type (with optional waitlist).
   * Input: { rentalType, waitlistDesiredType?, backupRentalType? }
   */
  fastify.post('/v1/checkin/lane/:laneId/select-rental', {
    preHandler: [requireAuth],
  }, async (
    request: FastifyRequest<{
      Params: { laneId: string };
      Body: { 
        rentalType: string;
        waitlistDesiredType?: string;
        backupRentalType?: string;
      };
    }>,
    reply: FastifyReply
  ) => {
    if (!request.staff) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { laneId } = request.params;
    const { rentalType, waitlistDesiredType, backupRentalType } = request.body;

    try {
      const result = await transaction(async (client) => {
        // Get active session
        const sessionResult = await client.query<LaneSessionRow>(
          `SELECT * FROM lane_sessions
           WHERE lane_id = $1 AND status = 'ACTIVE'
           ORDER BY created_at DESC
           LIMIT 1`,
          [laneId]
        );

        if (sessionResult.rows.length === 0) {
          throw { statusCode: 404, message: 'No active session found' };
        }

        const session = sessionResult.rows[0]!;

        // Update session with rental selection
        const updateResult = await client.query<LaneSessionRow>(
          `UPDATE lane_sessions
           SET desired_rental_type = $1,
               waitlist_desired_type = $2,
               backup_rental_type = $3,
               status = 'AWAITING_ASSIGNMENT',
               updated_at = NOW()
           WHERE id = $4
           RETURNING *`,
          [rentalType, waitlistDesiredType || null, backupRentalType || null, session.id]
        );

        // Broadcast update
        const payload: SessionUpdatedPayload = {
          sessionId: updateResult.rows[0]!.id,
          customerName: updateResult.rows[0]!.customer_display_name || '',
          membershipNumber: updateResult.rows[0]!.membership_number || undefined,
          allowedRentals: getAllowedRentals(updateResult.rows[0]!.membership_number),
          status: updateResult.rows[0]!.status,
        };

        fastify.broadcaster.broadcastSessionUpdated(payload, laneId);

        return {
          sessionId: updateResult.rows[0]!.id,
          desiredRentalType: rentalType,
          waitlistDesiredType: waitlistDesiredType || null,
          backupRentalType: backupRentalType || null,
        };
      });

      return reply.send(result);
    } catch (error: unknown) {
      request.log.error(error, 'Failed to select rental');
      if (error && typeof error === 'object' && 'statusCode' in error) {
        return reply.status((error as { statusCode: number }).statusCode).send({
          error: (error as { message: string }).message || 'Failed to select rental',
        });
      }
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to select rental',
      });
    }
  });

  /**
   * POST /v1/checkin/lane/:laneId/assign
   * 
   * Assign a resource (room or locker) to the lane session.
   * Uses transactional locking to prevent double-booking.
   */
  fastify.post('/v1/checkin/lane/:laneId/assign', {
    preHandler: [requireAuth],
  }, async (
    request: FastifyRequest<{
      Params: { laneId: string };
      Body: { resourceType: 'room' | 'locker'; resourceId: string };
    }>,
    reply: FastifyReply
  ) => {
    if (!request.staff) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { laneId } = request.params;
    const { resourceType, resourceId } = request.body;

    try {
      const result = await serializableTransaction(async (client) => {
        // Get active session
        const sessionResult = await client.query<LaneSessionRow>(
          `SELECT * FROM lane_sessions
           WHERE lane_id = $1 AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT')
           ORDER BY created_at DESC
           LIMIT 1`,
          [laneId]
        );

        if (sessionResult.rows.length === 0) {
          throw { statusCode: 404, message: 'No active session found' };
        }

        const session = sessionResult.rows[0]!;

        // Lock and validate resource availability
        if (resourceType === 'room') {
          const roomResult = await client.query<RoomRow>(
            `SELECT id, number, type, status, assigned_to_customer_id FROM rooms
             WHERE id = $1 FOR UPDATE`,
            [resourceId]
          );

          if (roomResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Room not found' };
          }

          const room = roomResult.rows[0]!;

          if (room.status !== 'CLEAN') {
            throw { statusCode: 400, message: `Room ${room.number} is not available (status: ${room.status})` };
          }

          if (room.assigned_to_customer_id) {
            throw { statusCode: 409, message: `Room ${room.number} is already assigned (race condition)` };
          }

          // Verify tier matches desired rental type
          const roomTier = getRoomTier(room.number);
          const desiredType = session.desired_rental_type || session.backup_rental_type;
          const needsConfirmation = desiredType && roomTier !== desiredType;

          // Assign room
          await client.query(
            `UPDATE rooms SET assigned_to_customer_id = $1, updated_at = NOW() WHERE id = $2`,
            [session.customer_id || session.id, resourceId]
          );

          // Update session
          await client.query(
            `UPDATE lane_sessions
             SET assigned_resource_id = $1,
                 assigned_resource_type = 'room',
                 status = 'AWAITING_PAYMENT',
                 updated_at = NOW()
             WHERE id = $2`,
            [resourceId, session.id]
          );

          // Log audit
          await client.query(
            `INSERT INTO audit_log 
             (staff_id, action, entity_type, entity_id, old_value, new_value)
             VALUES ($1, 'ROOM_ASSIGNED', 'room', $2, $3, $4)`,
            [
              request.staff.staffId,
              resourceId,
              JSON.stringify({ assigned_to_customer_id: null }),
              JSON.stringify({ assigned_to_customer_id: session.customer_id || session.id, lane_session_id: session.id }),
            ]
          );

          // Broadcast assignment created
          const assignmentPayload: AssignmentCreatedPayload = {
            sessionId: session.id,
            roomId: resourceId,
            roomNumber: room.number,
            rentalType: roomTier,
          };
          fastify.broadcaster.broadcastAssignmentCreated(assignmentPayload, laneId);

          // If cross-type assignment, require customer confirmation
          if (needsConfirmation && desiredType) {
            const confirmationPayload: CustomerConfirmationRequiredPayload = {
              sessionId: session.id,
              requestedType: desiredType,
              selectedType: roomTier,
              selectedNumber: room.number,
            };
            fastify.broadcaster.broadcastCustomerConfirmationRequired(confirmationPayload, laneId);
          }

          return {
            success: true,
            resourceType: 'room',
            resourceId,
            roomNumber: room.number,
            needsConfirmation,
          };
        } else {
          // Locker assignment
          const lockerResult = await client.query<LockerRow>(
            `SELECT id, number, status, assigned_to_customer_id FROM lockers
             WHERE id = $1 FOR UPDATE`,
            [resourceId]
          );

          if (lockerResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Locker not found' };
          }

          const locker = lockerResult.rows[0]!;

          if (locker.assigned_to_customer_id) {
            throw { statusCode: 409, message: `Locker ${locker.number} is already assigned (race condition)` };
          }

          // Assign locker
          await client.query(
            `UPDATE lockers SET assigned_to_customer_id = $1, updated_at = NOW() WHERE id = $2`,
            [session.customer_id || session.id, resourceId]
          );

          // Update session
          await client.query(
            `UPDATE lane_sessions
             SET assigned_resource_id = $1,
                 assigned_resource_type = 'locker',
                 status = 'AWAITING_PAYMENT',
                 updated_at = NOW()
             WHERE id = $2`,
            [resourceId, session.id]
          );

          // Log audit
          await client.query(
            `INSERT INTO audit_log 
             (staff_id, action, entity_type, entity_id, old_value, new_value)
             VALUES ($1, 'ROOM_ASSIGNED', 'locker', $2, $3, $4)`,
            [
              request.staff.staffId,
              resourceId,
              JSON.stringify({ assigned_to_customer_id: null }),
              JSON.stringify({ assigned_to_customer_id: session.customer_id || session.id, lane_session_id: session.id }),
            ]
          );

          // Broadcast assignment created
          const assignmentPayload: AssignmentCreatedPayload = {
            sessionId: session.id,
            lockerId: resourceId,
            lockerNumber: locker.number,
            rentalType: 'LOCKER',
          };
          fastify.broadcaster.broadcastAssignmentCreated(assignmentPayload, laneId);

          return {
            success: true,
            resourceType: 'locker',
            resourceId,
            lockerNumber: locker.number,
          };
        }
      });

      return reply.send(result);
    } catch (error: unknown) {
      request.log.error(error, 'Failed to assign resource');
      
      // Broadcast assignment failed if we have session info
      if (error && typeof error === 'object' && 'statusCode' in error) {
        const statusCode = (error as { statusCode: number }).statusCode;
        if (statusCode === 409) {
          // Race condition - try to get session to broadcast failure
          try {
            const sessionResult = await query<LaneSessionRow>(
              `SELECT id FROM lane_sessions WHERE lane_id = $1 AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT') ORDER BY created_at DESC LIMIT 1`,
              [laneId]
            );
            if (sessionResult.rows.length > 0) {
              const failedPayload: AssignmentFailedPayload = {
                sessionId: sessionResult.rows[0]!.id,
                reason: (error as { message: string }).message || 'Resource already assigned',
                requestedRoomId: request.body.resourceType === 'room' ? request.body.resourceId : undefined,
                requestedLockerId: request.body.resourceType === 'locker' ? request.body.resourceId : undefined,
              };
              fastify.broadcaster.broadcastAssignmentFailed(failedPayload, laneId);
            }
          } catch {
            // Ignore broadcast errors
          }
        }
        
        return reply.status(statusCode).send({
          error: (error as { message: string }).message || 'Failed to assign resource',
          raceLost: statusCode === 409,
        });
      }
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to assign resource',
      });
    }
  });

  /**
   * POST /v1/checkin/lane/:laneId/create-payment-intent
   * 
   * Create a payment intent with DUE status from the price quote.
   */
  fastify.post('/v1/checkin/lane/:laneId/create-payment-intent', {
    preHandler: [requireAuth],
  }, async (
    request: FastifyRequest<{
      Params: { laneId: string };
    }>,
    reply: FastifyReply
  ) => {
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

        if (!session.assigned_resource_id || !session.assigned_resource_type) {
          throw { statusCode: 400, message: 'Resource must be assigned before creating payment intent' };
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
            membershipCardType = (customer.membership_card_type as 'NONE' | 'SIX_MONTH') || undefined;
            membershipValidUntil = customer.membership_valid_until || undefined;
          }
        }

        // Determine rental type
        const rentalType = (session.desired_rental_type || session.backup_rental_type || 'LOCKER') as 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL' | 'GYM_LOCKER';

        // Calculate price quote
        const pricingInput: PricingInput = {
          rentalType,
          customerAge,
          checkInTime: new Date(),
          membershipCardType,
          membershipValidUntil,
        };

        const quote = calculatePriceQuote(pricingInput);

        // Create payment intent
        const intentResult = await client.query<PaymentIntentRow>(
          `INSERT INTO payment_intents 
           (lane_session_id, amount, status, quote_json)
           VALUES ($1, $2, 'DUE', $3)
           RETURNING *`,
          [session.id, quote.total, JSON.stringify(quote)]
        );

        const intent = intentResult.rows[0]!;

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
          paymentIntentId: intent.id,
          amount: typeof intent.amount === 'string' ? parseFloat(intent.amount) : intent.amount,
          quote,
        };
      });

      return reply.send(result);
    } catch (error: unknown) {
      request.log.error(error, 'Failed to create payment intent');
      if (error && typeof error === 'object' && 'statusCode' in error) {
        return reply.status((error as { statusCode: number }).statusCode).send({
          error: (error as { message: string }).message || 'Failed to create payment intent',
        });
      }
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to create payment intent',
      });
    }
  });

  /**
   * POST /v1/payments/:id/mark-paid
   * 
   * Mark a payment intent as PAID (called after Square payment).
   */
  fastify.post('/v1/payments/:id/mark-paid', {
    preHandler: [requireAuth],
  }, async (
    request: FastifyRequest<{
      Params: { id: string };
      Body: { squareTransactionId?: string };
    }>,
    reply: FastifyReply
  ) => {
    if (!request.staff) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

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
        const quote = intent.quote_json as { type?: string; waitlistId?: string; visitId?: string; blockId?: string };
        const paymentType = quote.type;

        // Handle upgrade payment completion
        if (paymentType === 'UPGRADE' && quote.waitlistId) {
          // Import upgrade completion function (will be called via API)
          // For now, log that upgrade payment is ready
          await client.query(
            `INSERT INTO audit_log 
             (staff_id, action, entity_type, entity_id, old_value, new_value)
             VALUES ($1, 'UPGRADE_PAID', 'payment_intent', $2, $3, $4)`,
            [
              request.staff.staffId,
              id,
              JSON.stringify({ status: 'DUE' }),
              JSON.stringify({ status: 'PAID', waitlistId: quote.waitlistId }),
            ]
          );
          // Note: Actual upgrade completion should be called via /v1/upgrades/complete
        }
        // Handle final extension payment completion
        else if (paymentType === 'FINAL_EXTENSION' && quote.visitId && quote.blockId) {
          await client.query(
            `INSERT INTO audit_log 
             (staff_id, action, entity_type, entity_id, old_value, new_value)
             VALUES ($1, 'FINAL_EXTENSION_PAID', 'payment_intent', $2, $3, $4)`,
            [
              request.staff.staffId,
              id,
              JSON.stringify({ status: 'DUE' }),
              JSON.stringify({ status: 'PAID', visitId: quote.visitId, blockId: quote.blockId }),
            ]
          );

          // Mark final extension as completed
          await client.query(
            `INSERT INTO audit_log 
             (staff_id, action, entity_type, entity_id, old_value, new_value)
             VALUES ($1, 'FINAL_EXTENSION_COMPLETED', 'visit', $2, $3, $4)`,
            [
              request.staff.staffId,
              quote.visitId,
              JSON.stringify({ paymentIntentId: id, status: 'DUE' }),
              JSON.stringify({ paymentIntentId: id, status: 'PAID', blockId: quote.blockId }),
            ]
          );
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
            // After payment is marked paid, check if signature is already done
            // If signature is done and resource is assigned, we can complete; otherwise await signature
            const signatureDone = !!session.disclaimers_ack_json;
            const resourceAssigned = !!session.assigned_resource_id;
            
            let newStatus: string;
            if (signatureDone && resourceAssigned) {
              // All conditions met - will be completed when signature endpoint is called
              newStatus = 'AWAITING_SIGNATURE'; // Will transition to COMPLETED in sign-agreement endpoint
            } else {
              // Still need signature
              newStatus = 'AWAITING_SIGNATURE';
            }
            
            await client.query(
              `UPDATE lane_sessions SET status = $1, updated_at = NOW() WHERE id = $2`,
              [newStatus, session.id]
            );

            // Broadcast update
            const payload: SessionUpdatedPayload = {
              sessionId: session.id,
              customerName: session.customer_display_name || '',
              membershipNumber: session.membership_number || undefined,
              allowedRentals: getAllowedRentals(session.membership_number),
              mode: session.checkin_mode === 'RENEWAL' ? 'RENEWAL' : (session.checkin_mode === 'CHECKIN' ? 'CHECKIN' : 'CHECKIN'), // Support legacy INITIAL
              status: newStatus,
            };
            fastify.broadcaster.broadcastSessionUpdated(payload, session.lane_id);
          }
        }

        return {
          paymentIntentId: intent.id,
          status: 'PAID',
        };
      });

      return reply.send(result);
    } catch (error: unknown) {
      request.log.error(error, 'Failed to mark payment as paid');
      if (error && typeof error === 'object' && 'statusCode' in error) {
        return reply.status((error as { statusCode: number }).statusCode).send({
          error: (error as { message: string }).message || 'Failed to mark payment as paid',
        });
      }
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to mark payment as paid',
      });
    }
  });

  /**
   * POST /v1/checkin/lane/:laneId/sign-agreement
   * 
   * Store agreement signature and link to check-in block.
   * Public endpoint (customer kiosk can call without auth).
   */
  fastify.post('/v1/checkin/lane/:laneId/sign-agreement', async (
    request: FastifyRequest<{
      Params: { laneId: string };
      Body: { signaturePayload: string; sessionId?: string }; // PNG data URL or vector points JSON
    }>,
    reply: FastifyReply
  ) => {

    const { laneId } = request.params;
    const { signaturePayload } = request.body;

    try {
      const result = await transaction(async (client) => {
        // Get active session (by sessionId if provided, otherwise latest for lane)
        let sessionResult;
        if (request.body.sessionId) {
          sessionResult = await client.query<LaneSessionRow>(
            `SELECT * FROM lane_sessions
             WHERE id = $1 AND lane_id = $2 AND status IN ('AWAITING_SIGNATURE', 'AWAITING_PAYMENT')
             LIMIT 1`,
            [request.body.sessionId, laneId]
          );
        } else {
          sessionResult = await client.query<LaneSessionRow>(
            `SELECT * FROM lane_sessions
             WHERE lane_id = $1 AND status IN ('AWAITING_SIGNATURE', 'AWAITING_PAYMENT')
             ORDER BY created_at DESC
             LIMIT 1`,
            [laneId]
          );
        }

        if (sessionResult.rows.length === 0) {
          throw { statusCode: 404, message: 'No active session found' };
        }

        const session = sessionResult.rows[0]!;

        // Check payment is paid
        if (session.payment_intent_id) {
          const intentResult = await client.query<PaymentIntentRow>(
            `SELECT status FROM payment_intents WHERE id = $1`,
            [session.payment_intent_id]
          );
          if (intentResult.rows.length > 0 && intentResult.rows[0]!.status !== 'PAID') {
            throw { statusCode: 400, message: 'Payment must be marked as paid before signing agreement' };
          }
        }

        // Store signature (simplified - convert PNG data URL to binary if needed)
        // For now, store as text/JSON
        const signatureData = signaturePayload.startsWith('data:') 
          ? signaturePayload.split(',')[1] // Extract base64
          : signaturePayload;

        // Update session with signature
        await client.query(
          `UPDATE lane_sessions
           SET disclaimers_ack_json = $1,
               status = CASE 
                 WHEN payment_intent_id IS NOT NULL AND 
                      (SELECT status FROM payment_intents WHERE id = lane_sessions.payment_intent_id) = 'PAID'
                 THEN 'COMPLETED'
                 ELSE status
               END,
               updated_at = NOW()
           WHERE id = $2`,
          [JSON.stringify({ signature: signatureData, signedAt: new Date().toISOString() }), session.id]
        );

        // Completion guardrails: Only complete if all conditions are met
        if (session.payment_intent_id && session.assigned_resource_id) {
          const intentResult = await client.query<PaymentIntentRow>(
            `SELECT status FROM payment_intents WHERE id = $1`,
            [session.payment_intent_id]
          );
          
          // Check payment is paid
          const paymentPaid = intentResult.rows.length > 0 && intentResult.rows[0]!.status === 'PAID';
          
          // Check signature is stored
          const signatureStored = !!session.disclaimers_ack_json;
          
          // Check resource is assigned
          const resourceAssigned = !!session.assigned_resource_id && !!session.assigned_resource_type;
          
          // Only complete if all conditions met
          if (paymentPaid && signatureStored && resourceAssigned) {
            // Complete check-in: create visit and check-in block, transition room/locker to OCCUPIED
            // Use a default staff ID if not available (for public endpoint)
            const staffId = request.staff?.staffId || 'system';
            await completeCheckIn(client, session, staffId);
            
            // Broadcast completion
            const completionPayload: SessionUpdatedPayload = {
              sessionId: session.id,
              customerName: session.customer_display_name || '',
              membershipNumber: session.membership_number || undefined,
              allowedRentals: getAllowedRentals(session.membership_number),
              mode: session.checkin_mode === 'RENEWAL' ? 'RENEWAL' : (session.checkin_mode === 'CHECKIN' ? 'CHECKIN' : 'CHECKIN'), // Support legacy INITIAL
              status: 'COMPLETED',
            };
            fastify.broadcaster.broadcastSessionUpdated(completionPayload, laneId);
          }
        }

        return { success: true, sessionId: session.id };
      });

      return reply.send(result);
    } catch (error: unknown) {
      request.log.error(error, 'Failed to sign agreement');
      if (error && typeof error === 'object' && 'statusCode' in error) {
        return reply.status((error as { statusCode: number }).statusCode).send({
          error: (error as { message: string }).message || 'Failed to sign agreement',
        });
      }
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to sign agreement',
      });
    }
  });

  /**
   * POST /v1/checkin/lane/:laneId/customer-confirm
   * 
   * Customer confirms or declines cross-type assignment.
   */
  fastify.post('/v1/checkin/lane/:laneId/customer-confirm', async (
    request: FastifyRequest<{
      Params: { laneId: string };
      Body: { sessionId: string; confirmed: boolean };
    }>,
    reply: FastifyReply
  ) => {
    const { laneId } = request.params;
    const { sessionId, confirmed } = request.body;

    try {
      const result = await transaction(async (client) => {
        const sessionResult = await client.query<LaneSessionRow>(
          `SELECT * FROM lane_sessions WHERE id = $1 AND lane_id = $2`,
          [sessionId, laneId]
        );

        if (sessionResult.rows.length === 0) {
          throw { statusCode: 404, message: 'Session not found' };
        }

        const session = sessionResult.rows[0]!;

        if (confirmed) {
          // Customer confirmed - broadcast confirmation
          const confirmedPayload: CustomerConfirmedPayload = {
            sessionId: session.id,
            confirmedType: session.assigned_resource_type === 'room' ? getRoomTier(session.assigned_resource_id || '') : 'LOCKER',
            confirmedNumber: session.assigned_resource_id || '',
          };
          fastify.broadcaster.broadcastCustomerConfirmed(confirmedPayload, laneId);
        } else {
          // Customer declined - unassign resource and broadcast decline
          if (session.assigned_resource_id) {
            if (session.assigned_resource_type === 'room') {
              await client.query(
                `UPDATE rooms SET assigned_to_customer_id = NULL, updated_at = NOW() WHERE id = $1`,
                [session.assigned_resource_id]
              );
            } else if (session.assigned_resource_type === 'locker') {
              await client.query(
                `UPDATE lockers SET assigned_to_customer_id = NULL, updated_at = NOW() WHERE id = $1`,
                [session.assigned_resource_id]
              );
            }

            await client.query(
              `UPDATE lane_sessions SET assigned_resource_id = NULL, assigned_resource_type = NULL, updated_at = NOW() WHERE id = $1`,
              [session.id]
            );
          }

          const declinedPayload: CustomerDeclinedPayload = {
            sessionId: session.id,
            requestedType: session.desired_rental_type || '',
          };
          fastify.broadcaster.broadcastCustomerDeclined(declinedPayload, laneId);
        }

        return { success: true, confirmed };
      });

      return reply.send(result);
    } catch (error: unknown) {
      request.log.error(error, 'Failed to process customer confirmation');
      if (error && typeof error === 'object' && 'statusCode' in error) {
        return reply.status((error as { statusCode: number }).statusCode).send({
          error: (error as { message: string }).message || 'Failed to process confirmation',
        });
      }
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to process customer confirmation',
      });
    }
  });

  /**
   * Complete check-in: create visit, check-in block, and transition resources.
   */
  async function completeCheckIn(
    client: Parameters<Parameters<typeof transaction>[0]>[0],
    session: LaneSessionRow,
    staffId: string
  ): Promise<void> {
    if (!session.customer_id || !session.assigned_resource_id || !session.assigned_resource_type) {
      throw new Error('Cannot complete check-in without customer and resource assignment');
    }

    const isRenewal = session.checkin_mode === 'RENEWAL';
    const isCheckin = session.checkin_mode === 'CHECKIN' || session.checkin_mode === 'INITIAL'; // Support legacy INITIAL
    const rentalType = (session.desired_rental_type || session.backup_rental_type || 'LOCKER') as string;

    let visitId: string;
    let startsAt: Date;
    let endsAt: Date;
    let blockType: 'INITIAL' | 'RENEWAL';

    if (isRenewal) {
      // For RENEWAL: find existing visit and get latest block end time
      const visitResult = await client.query<{ id: string }>(
        `SELECT id FROM visits WHERE customer_id = $1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
        [session.customer_id]
      );

      if (visitResult.rows.length === 0) {
        throw new Error('No active visit found for renewal');
      }

      visitId = visitResult.rows[0]!.id;

      // Get existing blocks to calculate total hours and find latest checkout
      const blocksResult = await client.query<{
        starts_at: Date;
        ends_at: Date;
      }>(
        `SELECT starts_at, ends_at FROM checkin_blocks WHERE visit_id = $1 ORDER BY ends_at DESC`,
        [visitId]
      );

      if (blocksResult.rows.length === 0) {
        throw new Error('Visit has no blocks');
      }

      // Calculate total hours if renewal is added
      let currentTotalHours = 0;
      for (const block of blocksResult.rows) {
        const hours = (block.ends_at.getTime() - block.starts_at.getTime()) / (1000 * 60 * 60);
        currentTotalHours += hours;
      }

      // Check 14-hour limit
      if (currentTotalHours + 6 > 14) {
        throw new Error(`Renewal would exceed 14-hour maximum. Current total: ${currentTotalHours} hours, renewal would add 6 hours.`);
      }

      // Renewal extends from previous checkout time, not from now
      const latestBlockEnd = blocksResult.rows[0]!.ends_at;
      startsAt = latestBlockEnd;
      endsAt = new Date(startsAt.getTime() + 6 * 60 * 60 * 1000); // 6 hours from previous checkout
      blockType = 'RENEWAL';
    } else {
      // For CHECKIN: create new visit
      const visitResult = await client.query<{ id: string }>(
        `INSERT INTO visits (customer_id, started_at)
         VALUES ($1, NOW())
         RETURNING id`,
        [session.customer_id]
      );

      visitId = visitResult.rows[0]!.id;

      // Create check-in block (6 hours from now)
      startsAt = new Date();
      endsAt = new Date(startsAt.getTime() + 6 * 60 * 60 * 1000);
      blockType = 'INITIAL'; // block_type enum uses INITIAL, not CHECKIN (this is correct per schema)
    }

    const blockResult = await client.query<{ id: string }>(
      `INSERT INTO checkin_blocks 
       (visit_id, block_type, starts_at, ends_at, rental_type, room_id, locker_id, agreement_signed)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)
       RETURNING id`,
      [
        visitId,
        blockType,
        startsAt,
        endsAt,
        rentalType,
        session.assigned_resource_type === 'room' ? session.assigned_resource_id : null,
        session.assigned_resource_type === 'locker' ? session.assigned_resource_id : null,
      ]
    );

    const blockId = blockResult.rows[0]!.id;

    // Transition room/locker to OCCUPIED status
    if (session.assigned_resource_type === 'room') {
      await client.query(
        `UPDATE rooms 
         SET status = 'OCCUPIED', last_status_change = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [session.assigned_resource_id]
      );
    } else if (session.assigned_resource_type === 'locker') {
      await client.query(
        `UPDATE lockers 
         SET status = 'OCCUPIED', updated_at = NOW()
         WHERE id = $1`,
        [session.assigned_resource_id]
      );
    }

    // Update session status
    await client.query(
      `UPDATE lane_sessions SET status = 'COMPLETED', updated_at = NOW() WHERE id = $1`,
      [session.id]
    );

    // Log audit (only if staffId is a valid UUID)
    if (staffId && staffId !== 'system' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(staffId)) {
      await client.query(
        `INSERT INTO audit_log 
         (staff_id, action, entity_type, entity_id, old_value, new_value)
         VALUES ($1, 'SESSION_CREATED', 'visit', $2, $3, $4)`,
        [
          staffId,
          visitId,
          JSON.stringify({}),
          JSON.stringify({ visit_id: visitId, block_id: blockId, resource_type: session.assigned_resource_type }),
        ]
      );
    }

    // Create waitlist entry if waitlist_desired_type is set
    if (session.waitlist_desired_type && session.backup_rental_type) {
      const waitlistResult = await client.query<{ id: string }>(
        `INSERT INTO waitlist 
         (visit_id, checkin_block_id, desired_tier, backup_tier, locker_or_room_assigned_initially, status)
         VALUES ($1, $2, $3, $4, $5, 'ACTIVE')
         RETURNING id`,
        [
          visitId,
          blockId,
          session.waitlist_desired_type,
          session.backup_rental_type,
          session.assigned_resource_id,
        ]
      );

      const waitlistId = waitlistResult.rows[0]!.id;

      // Update checkin_block with waitlist_id
      await client.query(
        `UPDATE checkin_blocks SET waitlist_id = $1 WHERE id = $2`,
        [waitlistId, blockId]
      );

      // Log waitlist created
      if (staffId && staffId !== 'system' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(staffId)) {
        await client.query(
          `INSERT INTO audit_log 
           (staff_id, action, entity_type, entity_id, old_value, new_value)
           VALUES ($1, 'WAITLIST_CREATED', 'waitlist', $2, $3, $4)`,
          [
            staffId,
            waitlistId,
            JSON.stringify({}),
            JSON.stringify({
              visit_id: visitId,
              checkin_block_id: blockId,
              desired_tier: session.waitlist_desired_type,
              backup_tier: session.backup_rental_type,
              initial_resource_id: session.assigned_resource_id,
            }),
          ]
        );
      }

      // Broadcast waitlist update
      fastify.broadcaster.broadcast({
        type: 'WAITLIST_UPDATED',
        payload: {
          waitlistId,
          status: 'ACTIVE',
          visitId,
          desiredTier: session.waitlist_desired_type,
        },
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * GET /v1/checkin/lane-sessions
   * 
   * Get all active lane sessions for office dashboard.
   * Auth required.
   */
  fastify.get('/v1/checkin/lane-sessions', {
    preHandler: [requireAuth],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await query<LaneSessionRow>(
        `SELECT 
          ls.*,
          s.name as staff_name,
          c.name as customer_name,
          c.membership_number,
          r.number as room_number,
          l.number as locker_number
         FROM lane_sessions ls
         LEFT JOIN staff s ON ls.staff_id = s.id
         LEFT JOIN customers c ON ls.customer_id = c.id
         LEFT JOIN rooms r ON ls.assigned_resource_id = r.id AND ls.desired_rental_type NOT IN ('LOCKER', 'GYM_LOCKER')
         LEFT JOIN lockers l ON ls.assigned_resource_id = l.id AND ls.desired_rental_type IN ('LOCKER', 'GYM_LOCKER')
         WHERE ls.status != 'COMPLETED' AND ls.status != 'CANCELLED'
         ORDER BY ls.created_at DESC`
      );

      const sessions = result.rows.map(session => ({
        id: session.id,
        laneId: session.lane_id,
        status: session.status,
        staffName: (session as any).staff_name,
        customerName: session.customer_display_name || (session as any).customer_name,
        membershipNumber: session.membership_number,
        desiredRentalType: session.desired_rental_type,
        waitlistDesiredType: session.waitlist_desired_type,
        backupRentalType: session.backup_rental_type,
        assignedResource: session.assigned_resource_id ? {
          id: session.assigned_resource_id,
          number: (session as any).room_number || (session as any).locker_number,
          type: session.desired_rental_type,
        } : null,
        priceQuote: session.price_quote_json,
        paymentIntentId: session.payment_intent_id,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
      }));

      return reply.send({ sessions });
    } catch (error: unknown) {
      request.log.error(error, 'Failed to fetch lane sessions');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch lane sessions',
      });
    }
  });
}

