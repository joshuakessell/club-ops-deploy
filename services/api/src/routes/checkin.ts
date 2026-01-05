import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, transaction, serializableTransaction } from '../db/index.js';
import { requireAuth, optionalAuth } from '../auth/middleware.js';
import { verifyPin } from '../auth/utils.js';
import { generateAgreementPdf } from '../utils/pdf-generator.js';
import type { Broadcaster } from '../websocket/broadcaster.js';
import type { 
  SessionUpdatedPayload,
  CustomerConfirmationRequiredPayload,
  CustomerConfirmedPayload,
  CustomerDeclinedPayload,
  AssignmentCreatedPayload,
  AssignmentFailedPayload,
  SelectionProposedPayload,
  SelectionLockedPayload,
  SelectionAcknowledgedPayload,
} from '@club-ops/shared';
import { calculatePriceQuote, type PricingInput } from '../pricing/engine.js';
import { IdScanPayloadSchema, type IdScanPayload } from '@club-ops/shared';
import crypto from 'crypto';

declare module 'fastify' {
  interface FastifyInstance {
    broadcaster: Broadcaster;
  }
}

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
  checkin_mode: string | null; // 'INITIAL' or 'RENEWAL'
  proposed_rental_type: string | null;
  proposed_by: string | null;
  selection_confirmed: boolean;
  selection_confirmed_by: string | null;
  selection_locked_at: Date | null;
  past_due_bypassed?: boolean;
  past_due_bypassed_by_staff_id?: string | null;
  past_due_bypassed_at?: Date | null;
  last_payment_decline_reason?: string | null;
  last_payment_decline_at?: Date | null;
  last_past_due_decline_reason?: string | null;
  last_past_due_decline_at?: Date | null;
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
  past_due_balance?: number;
  primary_language?: string;
  notes?: string;
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
  amount: number | string;
  status: string;
  quote_json: unknown;
  payment_method?: string;
  failure_reason?: string;
  failure_at?: Date | null;
  register_number?: number | null;
}

type PoolClient = Parameters<Parameters<typeof transaction>[0]>[0];

function toNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return value;
  const n = parseFloat(String(value));
  return Number.isFinite(n) ? n : undefined;
}

function toDate(value: unknown): Date | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return value;
  const d = new Date(String(value));
  return Number.isFinite(d.getTime()) ? d : undefined;
}

function getHttpError(error: unknown): { statusCode: number; message?: string } | null {
  if (!error || typeof error !== 'object') return null;
  if (!('statusCode' in error)) return null;
  const statusCode = (error as { statusCode: unknown }).statusCode;
  if (typeof statusCode !== 'number') return null;
  const message = (error as { message?: unknown }).message;
  return { statusCode, message: typeof message === 'string' ? message : undefined };
}

async function buildFullSessionUpdatedPayload(
  client: PoolClient,
  sessionId: string
): Promise<{ laneId: string; payload: SessionUpdatedPayload }> {
  const sessionResult = await client.query<LaneSessionRow>(
    `SELECT * FROM lane_sessions WHERE id = $1 LIMIT 1`,
    [sessionId]
  );

  if (sessionResult.rows.length === 0) {
    throw new Error(`Lane session not found: ${sessionId}`);
  }

  const session = sessionResult.rows[0]!;
  const laneId = session.lane_id;

  const customer =
    session.customer_id
      ? (
          await client.query<CustomerRow>(
            `SELECT id, name, dob, membership_number, membership_card_type, membership_valid_until, past_due_balance, primary_language, notes
             FROM customers
             WHERE id = $1
             LIMIT 1`,
            [session.customer_id]
          )
        ).rows[0]
      : undefined;

  const membershipNumber =
    customer?.membership_number || session.membership_number || undefined;

  const allowedRentals = getAllowedRentals(membershipNumber);

  const pastDueBalance = toNumber(customer?.past_due_balance) || 0;
  const pastDueBypassed = !!session.past_due_bypassed;
  const pastDueBlocked = pastDueBalance > 0 && !pastDueBypassed;

  let customerDobMonthDay: string | undefined;
  const customerDob = toDate(customer?.dob);
  if (customerDob) {
    customerDobMonthDay = `${String(customerDob.getMonth() + 1).padStart(2, '0')}/${String(
      customerDob.getDate()
    ).padStart(2, '0')}`;
  }

  let customerLastVisitAt: string | undefined;
  if (session.customer_id) {
    const lastVisitResult = await client.query<{ starts_at: Date }>(
      `SELECT cb.starts_at
       FROM checkin_blocks cb
       JOIN visits v ON v.id = cb.visit_id
       WHERE v.customer_id = $1
       ORDER BY cb.starts_at DESC
       LIMIT 1`,
      [session.customer_id]
    );
    if (lastVisitResult.rows.length > 0) {
      customerLastVisitAt = lastVisitResult.rows[0]!.starts_at.toISOString();
    }
  }

  // Prefer a check-in block created by this lane session (when completed)
  const blockForSession = (
    await client.query<{
      visit_id: string;
      ends_at: Date;
      agreement_signed: boolean;
    }>(
      `SELECT visit_id, ends_at, agreement_signed
       FROM checkin_blocks
       WHERE session_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [session.id]
    )
  ).rows[0];

  // Active visit info (useful for RENEWAL mode pre-completion)
  let activeVisitId: string | undefined;
  let activeBlockEndsAt: string | undefined;
  if (session.customer_id) {
    const activeVisitResult = await client.query<{ visit_id: string; ends_at: Date }>(
      `SELECT v.id as visit_id, cb.ends_at
       FROM visits v
       JOIN checkin_blocks cb ON cb.visit_id = v.id
       WHERE v.customer_id = $1 AND v.ended_at IS NULL
       ORDER BY cb.ends_at DESC
       LIMIT 1`,
      [session.customer_id]
    );
    if (activeVisitResult.rows.length > 0) {
      activeVisitId = activeVisitResult.rows[0]!.visit_id;
      activeBlockEndsAt = activeVisitResult.rows[0]!.ends_at.toISOString();
    }
  }

  let assignedResourceType = session.assigned_resource_type as 'room' | 'locker' | null;
  let assignedResourceNumber: string | undefined;

  if (session.assigned_resource_id && assignedResourceType) {
    if (assignedResourceType === 'room') {
      const roomResult = await client.query<{ number: string }>(
        `SELECT number FROM rooms WHERE id = $1 LIMIT 1`,
        [session.assigned_resource_id]
      );
      assignedResourceNumber = roomResult.rows[0]?.number;
    } else if (assignedResourceType === 'locker') {
      const lockerResult = await client.query<{ number: string }>(
        `SELECT number FROM lockers WHERE id = $1 LIMIT 1`,
        [session.assigned_resource_id]
      );
      assignedResourceNumber = lockerResult.rows[0]?.number;
    }
  }

  // Payment intent: prefer the one pinned on the session, otherwise latest for session
  let paymentIntent: PaymentIntentRow | undefined;
  if (session.payment_intent_id) {
    const intentResult = await client.query<PaymentIntentRow>(
      `SELECT * FROM payment_intents WHERE id = $1 LIMIT 1`,
      [session.payment_intent_id]
    );
    paymentIntent = intentResult.rows[0];
  } else {
    const intentResult = await client.query<PaymentIntentRow>(
      `SELECT * FROM payment_intents
       WHERE lane_session_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [session.id]
    );
    paymentIntent = intentResult.rows[0];
  }

  const paymentTotal = toNumber(paymentIntent?.amount);

  const payload: SessionUpdatedPayload = {
    sessionId: session.id,
    customerName: customer?.name || session.customer_display_name || '',
    membershipNumber,
    allowedRentals,
    mode: session.checkin_mode === 'RENEWAL' ? 'RENEWAL' : 'INITIAL',
    status: session.status,
    proposedRentalType: session.proposed_rental_type || undefined,
    proposedBy: (session.proposed_by as 'CUSTOMER' | 'EMPLOYEE' | null) || undefined,
    selectionConfirmed: !!session.selection_confirmed,
    selectionConfirmedBy: (session.selection_confirmed_by as 'CUSTOMER' | 'EMPLOYEE' | null) || undefined,
    customerPrimaryLanguage: (customer?.primary_language as 'EN' | 'ES' | undefined) || undefined,
    customerDobMonthDay,
    customerLastVisitAt,
    customerNotes: customer?.notes || undefined,
    pastDueBalance: pastDueBalance > 0 ? pastDueBalance : undefined,
    pastDueBlocked,
    pastDueBypassed,
    paymentIntentId: paymentIntent?.id,
    paymentStatus: (paymentIntent?.status as 'DUE' | 'PAID' | undefined) || undefined,
    paymentMethod: (paymentIntent?.payment_method as 'CASH' | 'CREDIT' | undefined) || undefined,
    paymentTotal,
    paymentFailureReason: paymentIntent?.failure_reason || undefined,
    agreementSigned: blockForSession ? !!blockForSession.agreement_signed : false,
    assignedResourceType: assignedResourceType || undefined,
    assignedResourceNumber,
    visitId: blockForSession?.visit_id || activeVisitId,
    blockEndsAt: blockForSession?.ends_at
      ? blockForSession.ends_at.toISOString()
      : activeBlockEndsAt,
    checkoutAt: blockForSession?.ends_at ? blockForSession.ends_at.toISOString() : undefined,
  };

  return { laneId, payload };
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
function calculateAge(dob: Date | string | null): number | undefined {
  const d = toDate(dob);
  if (!d) {
    return undefined;
  }
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const monthDiff = today.getMonth() - d.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < d.getDate())) {
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
 * Compute waitlist position and ETA for a desired tier.
 * Position is 1-based. ETA is computed from Nth occupied block's end time + 15 min buffer.
 */
async function computeWaitlistInfo(
  client: Parameters<Parameters<typeof transaction>[0]>[0],
  desiredTier: string
): Promise<{ position: number; estimatedReadyAt: Date | null }> {
  // Count active waitlist entries for this tier (position = count + 1)
  const waitlistCountResult = await client.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM waitlist 
     WHERE desired_tier = $1 AND status = 'ACTIVE'`,
    [desiredTier]
  );
  const position = parseInt(waitlistCountResult.rows[0]?.count || '0', 10) + 1;

  // Find Nth occupied checkin_block where N = position
  // Get blocks that will end and could free up a room of the desired tier
  const blocksResult = await client.query<{
    id: string;
    ends_at: Date;
    room_id: string | null;
  }>(
    `SELECT cb.id, cb.ends_at, cb.room_id
     FROM checkin_blocks cb
     LEFT JOIN rooms r ON cb.room_id = r.id
     WHERE cb.ends_at > NOW()
       AND (cb.room_id IS NOT NULL OR cb.locker_id IS NOT NULL)
     ORDER BY cb.ends_at ASC
     LIMIT $1`,
    [position]
  );

  let estimatedReadyAt: Date | null = null;
  if (blocksResult.rows.length >= position) {
    // Found Nth block - ETA = block end + 15 min buffer
    const nthBlock = blocksResult.rows[position - 1]!;
    estimatedReadyAt = new Date(nthBlock.ends_at.getTime() + 15 * 60 * 1000);
  }

  return { position, estimatedReadyAt };
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
  fastify.post<{
    Params: { laneId: string };
    Body: { idScanValue: string; membershipScanValue?: string; checkinMode?: 'INITIAL' | 'RENEWAL'; visitId?: string };
  }>('/v1/checkin/lane/:laneId/start', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    if (!request.staff) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    const staffId = request.staff.staffId;

    const { laneId } = request.params;
    const { idScanValue, membershipScanValue, checkinMode = 'INITIAL', visitId } = request.body;

    // Validate checkinMode
    if (checkinMode !== 'INITIAL' && checkinMode !== 'RENEWAL') {
      return reply.status(400).send({ error: 'Invalid checkinMode. Must be INITIAL or RENEWAL' });
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

        // Look up or create customer (customers is canonical identity; members is deprecated)
        let customerId: string | null = null;
        let customerName = 'Customer';

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
            const bannedUntil = toDate(customer.banned_until);
            if (bannedUntil && new Date() < bannedUntil) {
              throw { statusCode: 403, message: 'Customer is banned until ' + bannedUntil.toISOString() };
            }
          }
        }

        // If we couldn't resolve an existing customer, create one for the session.
        // Demo behavior: use a placeholder name derived from the scanned ID value.
        if (!customerId) {
          const newCustomer = await client.query<{ id: string }>(
            `INSERT INTO customers (name, created_at, updated_at)
             VALUES ($1, NOW(), NOW())
             RETURNING id`,
            [idScanValue || 'Customer']
          );
          customerId = newCustomer.rows[0]!.id;
          customerName = idScanValue || 'Customer';
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
            [customerName, membershipNumber, customerId, staffId, checkinMode, existingSession.rows[0]!.id]
          );
          session = updateResult.rows[0]!;
        } else {
          // Create new session
          const newSessionResult = await client.query<LaneSessionRow>(
            `INSERT INTO lane_sessions 
             (lane_id, status, staff_id, customer_id, customer_display_name, membership_number, checkin_mode)
             VALUES ($1, 'ACTIVE', $2, $3, $4, $5, $6)
             RETURNING *`,
            [laneId, staffId, customerId, customerName, membershipNumber, checkinMode]
          );
          session = newSessionResult.rows[0]!;
        }

        // Determine allowed rentals
        const allowedRentals = getAllowedRentals(membershipNumber);

        // Get customer past-due balance if customer exists
        let pastDueBalance = 0;
        let pastDueBlocked = false;
        if (session.customer_id) {
          const customerInfo = await client.query<CustomerRow>(
            `SELECT past_due_balance FROM customers WHERE id = $1`,
            [session.customer_id]
          );
          if (customerInfo.rows.length > 0) {
            pastDueBalance = parseFloat(String(customerInfo.rows[0]!.past_due_balance || 0));
            pastDueBlocked = pastDueBalance > 0 && !(session.past_due_bypassed || false);
          }
        }

        return {
          sessionId: session.id,
          customerName: session.customer_display_name,
          membershipNumber: session.membership_number,
          allowedRentals,
          mode: checkinMode,
          blockEndsAt: blockEndsAt ? blockEndsAt.toISOString() : undefined,
          visitId: visitIdForSession || undefined,
          currentTotalHours: checkinMode === 'RENEWAL' ? currentTotalHours : undefined,
          pastDueBalance,
          pastDueBlocked,
        };
      });

      // Broadcast full session update (stable payload)
      const { payload } = await transaction((client) => buildFullSessionUpdatedPayload(client, result.sessionId));
      fastify.broadcaster.broadcastSessionUpdated(payload, laneId);

      return reply.send(result);
    } catch (error: unknown) {
      request.log.error(error, 'Failed to start lane session');
      if (error && typeof error === 'object' && 'statusCode' in error) {
        const statusCode = (error as { statusCode: number }).statusCode;
        const message = (error as { message?: string }).message;
        return reply.status(statusCode).send({
          error: message ?? 'Failed to start session',
        });
      }
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to start lane session',
      });
    }
  });

  /**
   * POST /v1/checkin/lane/:laneId/scan-id
   * 
   * Scan ID (PDF417 barcode) to identify customer and start/update lane session.
   * Server-authoritative: upserts customer based on id_scan_hash, updates lane session.
   * 
   * Input: IdScanPayload (raw barcode + parsed fields)
   * Output: lane session state with customer info
   */
  fastify.post<{
    Params: { laneId: string };
    Body: IdScanPayload;
  }>('/v1/checkin/lane/:laneId/scan-id', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    if (!request.staff) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    const staffId = request.staff.staffId;

    const { laneId } = request.params;
    let body: IdScanPayload;

    try {
      body = IdScanPayloadSchema.parse(request.body);
    } catch (error) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: error instanceof z.ZodError ? error.errors : 'Invalid input',
      });
    }

    try {
      const result = await transaction(async (client) => {
        // Compute id_scan_hash from raw barcode (SHA-256 of normalized string)
        let idScanHash: string | null = null;
        if (body.raw) {
          const normalized = body.raw.trim().replace(/\s+/g, ' ');
          idScanHash = crypto.createHash('sha256').update(normalized).digest('hex');
        } else if (body.idNumber && (body.issuer || body.jurisdiction)) {
          // Fallback: derive hash from issuer + idNumber
          const issuer = body.issuer || body.jurisdiction || '';
          const combined = `${issuer}:${body.idNumber}`;
          idScanHash = crypto.createHash('sha256').update(combined).digest('hex');
        }

        // Determine customer name from parsed fields
        let customerName = body.fullName || '';
        if (!customerName && body.firstName && body.lastName) {
          customerName = `${body.firstName} ${body.lastName}`.trim();
        }
        if (!customerName && body.idNumber) {
          customerName = `Customer ${body.idNumber}`; // Fallback
        }
        if (!customerName) {
          throw { statusCode: 400, message: 'Unable to determine customer name from ID scan' };
        }

        // Parse DOB if provided
        let dob: Date | null = null;
        if (body.dob) {
          const parsedDob = new Date(body.dob);
          if (!isNaN(parsedDob.getTime())) {
            dob = parsedDob;
          }
        }

        // Upsert customer based on id_scan_hash
        let customerId: string | null = null;

        if (idScanHash) {
          // Look for existing customer by hash
          const existingCustomer = await client.query<{ id: string; name: string; dob: Date | null }>(
            `SELECT id, name, dob FROM customers WHERE id_scan_hash = $1 LIMIT 1`,
            [idScanHash]
          );

          if (existingCustomer.rows.length > 0) {
            customerId = existingCustomer.rows[0]!.id;
            // Update name/dob if missing in existing record
            const existing = existingCustomer.rows[0]!;
            if ((!existing.name || existing.name === 'Customer') && customerName) {
              await client.query(
                `UPDATE customers SET name = $1, updated_at = NOW() WHERE id = $2`,
                [customerName, customerId]
              );
            }
            if (!existing.dob && dob) {
              await client.query(
                `UPDATE customers SET dob = $1, updated_at = NOW() WHERE id = $2`,
                [dob, customerId]
              );
            }
          } else {
            // Create new customer
            const newCustomer = await client.query<{ id: string }>(
              `INSERT INTO customers (name, dob, id_scan_hash, id_scan_value, created_at, updated_at)
               VALUES ($1, $2, $3, $4, NOW(), NOW())
               RETURNING id`,
              [customerName, dob, idScanHash, body.raw || null]
            );
            customerId = newCustomer.rows[0]!.id;
          }
        } else {
          // No hash available - create new customer (manual entry fallback)
          // This should be rare but allowed for manual entry
          const newCustomer = await client.query<{ id: string }>(
            `INSERT INTO customers (name, dob, id_scan_value, created_at, updated_at)
             VALUES ($1, $2, $3, NOW(), NOW())
             RETURNING id`,
            [customerName, dob, body.raw || null]
          );
          customerId = newCustomer.rows[0]!.id;
        }

        // Check if customer is banned
        const customerCheck = await client.query<{ banned_until: unknown }>(
          `SELECT banned_until FROM customers WHERE id = $1`,
          [customerId]
        );
        const bannedUntil = toDate(customerCheck.rows[0]?.banned_until);
        if (bannedUntil && bannedUntil > new Date()) {
          throw { statusCode: 403, message: `Customer is banned until ${bannedUntil.toISOString()}` };
        }

        // Determine allowed rentals (no membership yet, so just basic options)
        const allowedRentals = getAllowedRentals(null);

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
             SET customer_id = $1,
                 customer_display_name = $2,
                 status = 'ACTIVE',
                 staff_id = $3,
                 checkin_mode = COALESCE(checkin_mode, 'INITIAL'),
                 updated_at = NOW()
             WHERE id = $4
             RETURNING *`,
            [customerId, customerName, staffId, existingSession.rows[0]!.id]
          );
          session = updateResult.rows[0]!;
        } else {
          // Create new session
          const newSessionResult = await client.query<LaneSessionRow>(
            `INSERT INTO lane_sessions 
             (lane_id, status, staff_id, customer_id, customer_display_name, checkin_mode)
             VALUES ($1, 'ACTIVE', $2, $3, $4, 'INITIAL')
             RETURNING *`,
            [laneId, staffId, customerId, customerName]
          );
          session = newSessionResult.rows[0]!;
        }

        // Get customer info if customer exists
        let pastDueBalance = 0;
        let pastDueBlocked = false;
        let customerNotes: string | undefined;
        let customerPrimaryLanguage: 'EN' | 'ES' | undefined;
        let customerDobMonthDay: string | undefined;
        // last visit is derived from visits + checkin_blocks (broadcast uses DB-join helper)

        if (session.customer_id) {
          const customerInfo = await client.query<CustomerRow>(
            `SELECT past_due_balance, notes, primary_language, dob FROM customers WHERE id = $1`,
            [session.customer_id]
          );
          if (customerInfo.rows.length > 0) {
            const customer = customerInfo.rows[0]!;
            pastDueBalance = parseFloat(String(customer.past_due_balance || 0));
            pastDueBlocked = pastDueBalance > 0 && !(session.past_due_bypassed || false);
            customerNotes = customer.notes || undefined;
            customerPrimaryLanguage = customer.primary_language as 'EN' | 'ES' | undefined;
            
            if (customer.dob) {
              customerDobMonthDay = `${String(customer.dob.getMonth() + 1).padStart(2, '0')}/${String(customer.dob.getDate()).padStart(2, '0')}`;
            }

          }
        }

        return {
          sessionId: session.id,
          customerId: session.customer_id,
          customerName: session.customer_display_name,
          allowedRentals,
          mode: session.checkin_mode || 'INITIAL',
          pastDueBalance,
          pastDueBlocked,
          customerNotes,
          customerPrimaryLanguage,
          customerDobMonthDay,
        };
      });

      // Broadcast full session update (stable payload)
      const { payload } = await transaction((client) => buildFullSessionUpdatedPayload(client, result.sessionId));
      fastify.broadcaster.broadcastSessionUpdated(payload, laneId);

      return reply.send(result);
    } catch (error: unknown) {
      request.log.error(error, 'Failed to scan ID');
      if (error && typeof error === 'object' && 'statusCode' in error) {
        const statusCode = (error as { statusCode: number }).statusCode;
        const message = (error as { message?: string }).message;
        return reply.status(statusCode).send({ error: message ?? 'Failed to scan ID' });
      }
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /v1/checkin/lane/:laneId/select-rental
   * 
   * Customer selects rental type (with optional waitlist).
   * Input: { rentalType, waitlistDesiredType?, backupRentalType? }
   */
  fastify.post<{
    Params: { laneId: string };
    Body: {
      rentalType: string;
      waitlistDesiredType?: string;
      backupRentalType?: string;
    };
  }>('/v1/checkin/lane/:laneId/select-rental', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
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

        return {
          sessionId: updateResult.rows[0]!.id,
          desiredRentalType: rentalType,
          waitlistDesiredType: waitlistDesiredType || null,
          backupRentalType: backupRentalType || null,
        };
      });

      // Broadcast full session update (stable payload)
      const { payload } = await transaction((client) => buildFullSessionUpdatedPayload(client, result.sessionId));
      fastify.broadcaster.broadcastSessionUpdated(payload, laneId);

      return reply.send(result);
    } catch (error: unknown) {
      request.log.error(error, 'Failed to select rental');
      const httpErr = getHttpError(error);
      if (httpErr) {
        return reply.status(httpErr.statusCode).send({
          error: httpErr.message ?? 'Failed to select rental',
        });
      }
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to select rental',
      });
    }
  });

  /**
   * POST /v1/checkin/lane/:laneId/propose-selection
   * 
   * Propose a rental type selection (customer or employee can propose).
   * Does not lock the selection; requires confirmation.
   * Public endpoint (customer kiosk can call without auth).
   */
  fastify.post<{
    Params: { laneId: string };
    Body: {
      rentalType: string;
      proposedBy: 'CUSTOMER' | 'EMPLOYEE';
      waitlistDesiredType?: string;
      backupRentalType?: string;
    };
  }>('/v1/checkin/lane/:laneId/propose-selection', {
    preHandler: [optionalAuth],
  }, async (request, reply) => {

    const { laneId } = request.params;
    const { rentalType, proposedBy, waitlistDesiredType, backupRentalType } = request.body;

    // Validate proposedBy
    if (proposedBy !== 'CUSTOMER' && proposedBy !== 'EMPLOYEE') {
      return reply.status(400).send({ error: 'proposedBy must be CUSTOMER or EMPLOYEE' });
    }

    // If employee, require auth
    if (proposedBy === 'EMPLOYEE' && !request.staff) {
      return reply.status(401).send({ error: 'Unauthorized - employee proposals require authentication' });
    }

    try {
      const result = await transaction(async (client) => {
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

        // Check past-due blocking
        const { blocked } = await checkPastDueBlocked(client, session.customer_id, session.past_due_bypassed || false);
        if (blocked && proposedBy === 'CUSTOMER') {
          throw { statusCode: 403, message: 'Past due balance must be cleared before selection' };
        }

        // If already locked, cannot propose new selection
        if (session.selection_confirmed) {
          throw { statusCode: 400, message: 'Selection is already locked' };
        }

        const updateResult = await client.query<LaneSessionRow>(
          `UPDATE lane_sessions
           SET proposed_rental_type = $1,
               proposed_by = $2,
               waitlist_desired_type = COALESCE($3, waitlist_desired_type),
               backup_rental_type = COALESCE($4, backup_rental_type),
               updated_at = NOW()
           WHERE id = $5
           RETURNING *`,
          [rentalType, proposedBy, waitlistDesiredType || null, backupRentalType || null, session.id]
        );

        const updated = updateResult.rows[0]!;

        // Broadcast selection proposed
        const proposePayload: SelectionProposedPayload = {
          sessionId: updated.id,
          rentalType,
          proposedBy,
        };
        fastify.broadcaster.broadcastToLane({
          type: 'SELECTION_PROPOSED',
          payload: proposePayload,
          timestamp: new Date().toISOString(),
        }, laneId);

        return {
          sessionId: updated.id,
          proposedRentalType: rentalType,
          proposedBy,
        };
      });

      // Broadcast full session update (stable payload)
      const { payload } = await transaction((client) => buildFullSessionUpdatedPayload(client, result.sessionId));
      fastify.broadcaster.broadcastSessionUpdated(payload, laneId);

      return reply.send(result);
    } catch (error: unknown) {
      request.log.error(error, 'Failed to propose selection');
      const httpErr = getHttpError(error);
      if (httpErr) {
        return reply.status(httpErr.statusCode).send({
          error: httpErr.message ?? 'Failed to propose selection',
        });
      }
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to propose selection',
      });
    }
  });

  /**
   * POST /v1/checkin/lane/:laneId/confirm-selection
   * 
   * Confirm the proposed selection (first confirmation locks it).
   * Public endpoint (customer kiosk can call without auth).
   */
  fastify.post<{
    Params: { laneId: string };
    Body: { confirmedBy: 'CUSTOMER' | 'EMPLOYEE' };
  }>('/v1/checkin/lane/:laneId/confirm-selection', {
    preHandler: [optionalAuth],
  }, async (request, reply) => {

    const { laneId } = request.params;
    const { confirmedBy } = request.body;

    // Validate confirmedBy
    if (confirmedBy !== 'CUSTOMER' && confirmedBy !== 'EMPLOYEE') {
      return reply.status(400).send({ error: 'confirmedBy must be CUSTOMER or EMPLOYEE' });
    }

    // If employee, require auth
    if (confirmedBy === 'EMPLOYEE' && !request.staff) {
      return reply.status(401).send({ error: 'Unauthorized - employee confirmations require authentication' });
    }

    try {
      const result = await transaction(async (client) => {
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

        // Check past-due blocking
        const { blocked } = await checkPastDueBlocked(client, session.customer_id, session.past_due_bypassed || false);
        if (blocked && confirmedBy === 'CUSTOMER') {
          throw { statusCode: 403, message: 'Past due balance must be cleared before confirmation' };
        }

        if (!session.proposed_rental_type) {
          throw { statusCode: 400, message: 'No selection proposed yet' };
        }

        // If already locked, return current state (idempotent)
        if (session.selection_confirmed) {
          return {
            sessionId: session.id,
            rentalType: session.proposed_rental_type,
            confirmedBy: session.selection_confirmed_by,
            alreadyConfirmed: true,
          };
        }

        // Lock the selection
        const updateResult = await client.query<LaneSessionRow>(
          `UPDATE lane_sessions
           SET selection_confirmed = true,
               selection_confirmed_by = $1,
               selection_locked_at = NOW(),
               desired_rental_type = proposed_rental_type,
               updated_at = NOW()
           WHERE id = $2
           RETURNING *`,
          [confirmedBy, session.id]
        );

        const updated = updateResult.rows[0]!;

        // Broadcast selection locked
        const lockedPayload: SelectionLockedPayload = {
          sessionId: updated.id,
          rentalType: updated.proposed_rental_type!,
          confirmedBy: confirmedBy as 'CUSTOMER' | 'EMPLOYEE',
          lockedAt: updated.selection_locked_at!.toISOString(),
        };
        fastify.broadcaster.broadcastToLane({
          type: 'SELECTION_LOCKED',
          payload: lockedPayload,
          timestamp: new Date().toISOString(),
        }, laneId);

        return {
          sessionId: updated.id,
          rentalType: updated.proposed_rental_type,
          confirmedBy,
        };
      });

      // Broadcast full session update (stable payload)
      const { payload } = await transaction((client) => buildFullSessionUpdatedPayload(client, result.sessionId));
      fastify.broadcaster.broadcastSessionUpdated(payload, laneId);

      return reply.send(result);
    } catch (error: unknown) {
      request.log.error(error, 'Failed to confirm selection');
      const httpErr = getHttpError(error);
      if (httpErr) {
        return reply.status(httpErr.statusCode).send({
          error: httpErr.message ?? 'Failed to confirm selection',
        });
      }
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to confirm selection',
      });
    }
  });

  /**
   * POST /v1/checkin/lane/:laneId/acknowledge-selection
   * 
   * Acknowledge a locked selection (required for the other side to proceed).
   * Public endpoint (customer kiosk can call without auth).
   */
  fastify.post<{
    Params: { laneId: string };
    Body: { acknowledgedBy: 'CUSTOMER' | 'EMPLOYEE' };
  }>('/v1/checkin/lane/:laneId/acknowledge-selection', {
    preHandler: [optionalAuth],
  }, async (request, reply) => {

    const { laneId } = request.params;
    const { acknowledgedBy } = request.body;

    // Validate acknowledgedBy
    if (acknowledgedBy !== 'CUSTOMER' && acknowledgedBy !== 'EMPLOYEE') {
      return reply.status(400).send({ error: 'acknowledgedBy must be CUSTOMER or EMPLOYEE' });
    }

    // If employee, require auth
    if (acknowledgedBy === 'EMPLOYEE' && !request.staff) {
      return reply.status(401).send({ error: 'Unauthorized - employee acknowledgements require authentication' });
    }

    try {
      const result = await transaction(async (client) => {
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

        if (!session.selection_confirmed) {
          throw { statusCode: 400, message: 'Selection is not locked yet' };
        }

        // Broadcast acknowledgement
        const ackPayload: SelectionAcknowledgedPayload = {
          sessionId: session.id,
          acknowledgedBy,
        };
        fastify.broadcaster.broadcastToLane({
          type: 'SELECTION_ACKNOWLEDGED',
          payload: ackPayload,
          timestamp: new Date().toISOString(),
        }, laneId);

        return {
          sessionId: session.id,
          acknowledgedBy,
        };
      });

      return reply.send(result);
    } catch (error: unknown) {
      request.log.error(error, 'Failed to acknowledge selection');
      const httpErr = getHttpError(error);
      if (httpErr) {
        return reply.status(httpErr.statusCode).send({
          error: httpErr.message ?? 'Failed to acknowledge selection',
        });
      }
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to acknowledge selection',
      });
    }
  });

  /**
   * GET /v1/checkin/lane/:laneId/waitlist-info
   * 
   * Get waitlist position, ETA, and upgrade fee for a desired tier.
   * Called when customer selects an unavailable rental type.
   * Public endpoint (customer kiosk can call without auth).
   */
  fastify.get<{
    Params: { laneId: string };
    Querystring: { desiredTier: string; currentTier?: string };
  }>('/v1/checkin/lane/:laneId/waitlist-info', {
    preHandler: [optionalAuth],
  }, async (request, reply) => {

    const { laneId } = request.params;
    const { desiredTier, currentTier } = request.query;

    if (!desiredTier) {
      return reply.status(400).send({ error: 'desiredTier query parameter is required' });
    }

    try {
      const result = await transaction(async (client) => {
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

        const { position, estimatedReadyAt } = await computeWaitlistInfo(client, desiredTier);

        // Compute upgrade fee if currentTier is provided
        let upgradeFee: number | null = null;
        if (currentTier) {
          const { getUpgradeFee } = await import('../pricing/engine.js');
          upgradeFee = getUpgradeFee(currentTier as any, desiredTier as any) || null;
        }

        return {
          position,
          estimatedReadyAt: estimatedReadyAt ? estimatedReadyAt.toISOString() : null,
          upgradeFee,
        };
      });

      return reply.send(result);
    } catch (error: unknown) {
      request.log.error(error, 'Failed to get waitlist info');
      const httpErr = getHttpError(error);
      if (httpErr) {
        return reply.status(httpErr.statusCode).send({
          error: httpErr.message ?? 'Failed to get waitlist info',
        });
      }
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to get waitlist info',
      });
    }
  });

  /**
   * POST /v1/checkin/lane/:laneId/assign
   * 
   * Assign a resource (room or locker) to the lane session.
   * Uses transactional locking to prevent double-booking.
   */
  fastify.post<{
    Params: { laneId: string };
    Body: { resourceType: 'room' | 'locker'; resourceId: string };
  }>('/v1/checkin/lane/:laneId/assign', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    if (!request.staff) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    const staffId = request.staff.staffId;

    const { laneId } = request.params;
    const { resourceType, resourceId } = request.body;

    try {
      const result = await serializableTransaction(async (client) => {
        // Get active session
        const sessionResult = await client.query<LaneSessionRow>(
          `SELECT * FROM lane_sessions
           WHERE lane_id = $1 AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE')
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

          // Record selected resource on session (actual inventory assignment happens after agreement signing)
          await client.query(
            `UPDATE lane_sessions
             SET assigned_resource_id = $1,
                 assigned_resource_type = 'room',
                 updated_at = NOW()
             WHERE id = $2`,
            [resourceId, session.id]
          );

          // Log audit
          await client.query(
            `INSERT INTO audit_log 
             (staff_id, action, entity_type, entity_id, old_value, new_value)
             VALUES ($1, 'ASSIGN', 'room', $2, $3, $4)`,
            [
              staffId,
              resourceId,
              JSON.stringify({ assigned_to_customer_id: null }),
              JSON.stringify({ selected_for_session_id: session.id }),
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
            sessionId: session.id,
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

          // Record selected resource on session (actual inventory assignment happens after agreement signing)
          await client.query(
            `UPDATE lane_sessions
             SET assigned_resource_id = $1,
                 assigned_resource_type = 'locker',
                 updated_at = NOW()
             WHERE id = $2`,
            [resourceId, session.id]
          );

          // Log audit
          await client.query(
            `INSERT INTO audit_log 
             (staff_id, action, entity_type, entity_id, old_value, new_value)
             VALUES ($1, 'ASSIGN', 'locker', $2, $3, $4)`,
            [
              staffId,
              resourceId,
              JSON.stringify({ assigned_to_customer_id: null }),
              JSON.stringify({ selected_for_session_id: session.id }),
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
            sessionId: session.id,
            success: true,
            resourceType: 'locker',
            resourceId,
            lockerNumber: locker.number,
          };
        }
      });

      // Broadcast full session state (stable payload)
      const { payload } = await transaction((client) => buildFullSessionUpdatedPayload(client, result.sessionId));
      fastify.broadcaster.broadcastSessionUpdated(payload, laneId);

      return reply.send(result);
    } catch (error: unknown) {
      request.log.error(error, 'Failed to assign resource');
      
      // Broadcast assignment failed if we have session info
      const httpErr = getHttpError(error);
      if (httpErr) {
        const statusCode = httpErr.statusCode;
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
                reason: httpErr.message ?? 'Resource already assigned',
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
          error: httpErr.message ?? 'Failed to assign resource',
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
  fastify.post<{
    Params: { laneId: string };
  }>('/v1/checkin/lane/:laneId/create-payment-intent', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
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
          throw { statusCode: 400, message: 'Selection must be confirmed/locked before creating payment intent' };
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
            membershipCardType = (customer.membership_card_type as 'NONE' | 'SIX_MONTH') || undefined;
            membershipValidUntil = toDate(customer.membership_valid_until) || undefined;
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
      const { payload } = await transaction((client) => buildFullSessionUpdatedPayload(client, result.sessionId));
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
  });

  /**
   * POST /v1/payments/:id/mark-paid
   * 
   * Mark a payment intent as PAID (called after Square payment).
   */
  fastify.post<{
    Params: { id: string };
    Body: { squareTransactionId?: string };
  }>('/v1/payments/:id/mark-paid', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
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
              staffId,
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
              staffId,
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
              staffId,
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
        fastify.broadcaster.broadcastSessionUpdated(payload, result.laneSessionToBroadcast.laneId);
      }

      const { laneSessionToBroadcast: _laneSessionToBroadcast, ...apiResult } = result;
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
  });

  /**
   * POST /v1/checkin/lane/:laneId/sign-agreement
   * 
   * Store agreement signature, generate PDF, auto-assign resource, and create check-in block.
   * Public endpoint (customer kiosk can call without auth).
   */
  fastify.post<{ Params: { laneId: string }; Body: { signaturePayload: string; sessionId?: string } }>('/v1/checkin/lane/:laneId/sign-agreement', {
    preHandler: [optionalAuth],
  }, async (request, reply) => {

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

        // Agreement signing is required only for INITIAL and RENEWAL checkin_blocks
        if (session.checkin_mode !== 'INITIAL' && session.checkin_mode !== 'RENEWAL') {
          throw { statusCode: 400, message: 'Agreement signing is only required for INITIAL and RENEWAL check-ins' };
        }

        // Demo flow: require the rental selection to be confirmed/locked before payment+signature
        if (!session.selection_confirmed || !session.selection_locked_at) {
          throw { statusCode: 400, message: 'Selection must be confirmed/locked before signing agreement' };
        }

        // Check payment is paid
        if (!session.payment_intent_id) {
          throw { statusCode: 400, message: 'Payment intent must be created before signing agreement' };
        }

        const intentResult = await client.query<PaymentIntentRow>(
          `SELECT status FROM payment_intents WHERE id = $1`,
          [session.payment_intent_id]
        );
        if (intentResult.rows.length === 0 || intentResult.rows[0]!.status !== 'PAID') {
          throw { statusCode: 400, message: 'Payment must be marked as paid before signing agreement' };
        }

        // Get customer info for PDF
        const customerResult = session.customer_id
          ? await client.query<CustomerRow>(
              `SELECT name, membership_number FROM customers WHERE id = $1`,
              [session.customer_id]
            )
          : { rows: [] };

        const customerName = customerResult.rows[0]?.name || session.customer_display_name || 'Customer';
        const membershipNumber = customerResult.rows[0]?.membership_number || session.membership_number || undefined;

        // Get active agreement text
        const agreementResult = await client.query<{ id: string; body_text: string; version: string; title: string }>(
          `SELECT id, body_text, version, title FROM agreements WHERE active = true ORDER BY created_at DESC LIMIT 1`
        );

        if (agreementResult.rows.length === 0) {
          throw { statusCode: 404, message: 'No active agreement found' };
        }

        const agreement = agreementResult.rows[0]!;

        // Store signature (extract base64 from data URL if needed)
        const signatureData = signaturePayload.startsWith('data:')
          ? signaturePayload.split(',')[1]
          : signaturePayload;

        if (!signatureData || signatureData.trim().length < 16) {
          throw { statusCode: 400, message: 'Signature payload is required' };
        }

        const signedAt = new Date();

        // Generate PDF (robust pdf-lib)
        let pdfBuffer: Buffer;
        try {
          pdfBuffer = await generateAgreementPdf({
            agreementTitle: agreement.title,
            agreementVersion: agreement.version,
          customerName,
          membershipNumber,
          agreementText: agreement.body_text,
          signatureImageBase64: signatureData,
          signedAt,
          });
        } catch (e) {
          request.log.warn({ err: e }, 'Failed to generate agreement PDF from provided signature');
          throw { statusCode: 400, message: 'Invalid signature image (expected PNG data URL or base64)' };
        }

        // Determine rental type from locked selection snapshot
        const rentalType = (session.desired_rental_type || session.backup_rental_type || 'LOCKER') as
          | 'LOCKER'
          | 'STANDARD'
          | 'DOUBLE'
          | 'SPECIAL'
          | 'GYM_LOCKER';

        // Assignment happens AFTER agreement signing (demo requirement).
        // We either use the pre-selected resource on the lane session, or auto-pick the first available.
        let assignedResourceId = session.assigned_resource_id;
        let assignedResourceType = session.assigned_resource_type as 'room' | 'locker' | null;
        let assignedResourceNumber: string | undefined;

        if (assignedResourceId && assignedResourceType) {
          if (assignedResourceType === 'room') {
            const room = (
              await client.query<RoomRow>(
                `SELECT id, number, type, status, assigned_to_customer_id
                 FROM rooms
                 WHERE id = $1
                 FOR UPDATE`,
                [assignedResourceId]
              )
            ).rows[0];
            if (!room) throw { statusCode: 404, message: 'Selected room not found' };
            if (room.status !== 'CLEAN' || room.assigned_to_customer_id) {
              throw { statusCode: 409, message: `Selected room ${room.number} is no longer available` };
            }
            assignedResourceNumber = room.number;
          } else {
            const locker = (
              await client.query<LockerRow>(
                `SELECT id, number, status, assigned_to_customer_id
                 FROM lockers
                 WHERE id = $1
                 FOR UPDATE`,
                [assignedResourceId]
              )
            ).rows[0];
            if (!locker) throw { statusCode: 404, message: 'Selected locker not found' };
            if (locker.status !== 'CLEAN' || locker.assigned_to_customer_id) {
              throw { statusCode: 409, message: `Selected locker ${locker.number} is no longer available` };
            }
            assignedResourceNumber = locker.number;
          }
        } else {
          if (rentalType === 'LOCKER' || rentalType === 'GYM_LOCKER') {
            const locker = (
              await client.query<LockerRow>(
                `SELECT id, number, status, assigned_to_customer_id
                 FROM lockers
                 WHERE status = 'CLEAN' AND assigned_to_customer_id IS NULL
                 ORDER BY number
                 LIMIT 1
                 FOR UPDATE SKIP LOCKED`
              )
            ).rows[0];
            if (!locker) throw { statusCode: 409, message: 'No available lockers' };
            assignedResourceId = locker.id;
            assignedResourceType = 'locker';
            assignedResourceNumber = locker.number;
          } else {
            const room = (
              await client.query<RoomRow>(
                `SELECT id, number, type, status, assigned_to_customer_id
                 FROM rooms
                 WHERE status = 'CLEAN'
                   AND assigned_to_customer_id IS NULL
                   AND type = $1
                 ORDER BY number
                 LIMIT 1
                 FOR UPDATE SKIP LOCKED`,
                [rentalType]
              )
            ).rows[0];
            if (!room) throw { statusCode: 409, message: 'No available rooms' };
            assignedResourceId = room.id;
            assignedResourceType = 'room';
            assignedResourceNumber = room.number;
          }
        }

        if (!session.customer_id) {
          throw { statusCode: 400, message: 'Session has no customer; cannot complete check-in' };
        }

        // Assign inventory + mark OCCUPIED (server-authoritative, transactional)
        if (assignedResourceType === 'room') {
          await client.query(
            `UPDATE rooms
             SET status = 'OCCUPIED',
                 assigned_to_customer_id = $1,
                 last_status_change = NOW(),
                 updated_at = NOW()
             WHERE id = $2`,
            [session.customer_id, assignedResourceId]
          );
        } else {
          await client.query(
            `UPDATE lockers
             SET status = 'OCCUPIED',
                 assigned_to_customer_id = $1,
                 updated_at = NOW()
             WHERE id = $2`,
            [session.customer_id, assignedResourceId]
          );
        }

        // Ensure lane session snapshot fields are set
        await client.query(
          `UPDATE lane_sessions
           SET assigned_resource_id = $1,
               assigned_resource_type = $2,
               updated_at = NOW()
           WHERE id = $3`,
          [assignedResourceId, assignedResourceType, session.id]
        );

        // Complete check-in: create visit and check-in block with PDF
        const isRenewal = session.checkin_mode === 'RENEWAL';

        let visitId: string;
        let blockType: 'INITIAL' | 'RENEWAL';

        if (isRenewal) {
          const visitResult = await client.query<{ id: string }>(
            `SELECT id FROM visits WHERE customer_id = $1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
            [session.customer_id]
          );
          if (visitResult.rows.length === 0) {
            throw { statusCode: 400, message: 'No active visit found for renewal' };
          }
          visitId = visitResult.rows[0]!.id;
          blockType = 'RENEWAL';
        } else {
          const visitResult = await client.query<{ id: string }>(
            `INSERT INTO visits (customer_id, started_at) VALUES ($1, NOW()) RETURNING id`,
            [session.customer_id]
          );
          visitId = visitResult.rows[0]!.id;
          blockType = 'INITIAL';
        }

        const startsAt = new Date(); // demo: now (UTC)
        const endsAt = new Date(startsAt.getTime() + 6 * 60 * 60 * 1000);

        // Create checkin_block with PDF
        const blockResult = await client.query<{ id: string }>(
          `INSERT INTO checkin_blocks 
           (visit_id, block_type, starts_at, ends_at, rental_type, room_id, locker_id, session_id, agreement_signed, agreement_pdf, agreement_signed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $10)
           RETURNING id`,
          [
            visitId,
            blockType,
            startsAt,
            endsAt,
            rentalType,
            assignedResourceType === 'room' ? assignedResourceId : null,
            assignedResourceType === 'locker' ? assignedResourceId : null,
            session.id,
            pdfBuffer,
            signedAt,
          ]
        );

        const checkinBlockId = blockResult.rows[0]!.id;

        // Store signature as immutable audit artifact
        await client.query(
          `INSERT INTO agreement_signatures
           (agreement_id, checkin_id, checkin_block_id, customer_name, membership_number, signed_at, signature_png_base64, agreement_text_snapshot, agreement_version, user_agent, ip_address)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            agreement.id,
            null,
            checkinBlockId,
            customerName,
            membershipNumber || null,
            signedAt,
            signatureData,
            agreement.body_text,
            agreement.version,
            request.headers['user-agent'] || null,
            request.ip || null,
          ]
        );

        // Update session status
        await client.query(
          `UPDATE lane_sessions SET status = 'COMPLETED', updated_at = NOW() WHERE id = $1`,
          [session.id]
        );

        // Broadcast assignment created (final, after signing)
        const assignmentPayload: AssignmentCreatedPayload = {
          sessionId: session.id,
          roomId: assignedResourceType === 'room' ? assignedResourceId : undefined,
          roomNumber: assignedResourceType === 'room' ? assignedResourceNumber : undefined,
          lockerId: assignedResourceType === 'locker' ? assignedResourceId : undefined,
          lockerNumber: assignedResourceType === 'locker' ? assignedResourceNumber : undefined,
          rentalType,
        };
        fastify.broadcaster.broadcastAssignmentCreated(assignmentPayload, laneId);

        return { success: true, sessionId: session.id };
      });

      const { payload } = await transaction((client) => buildFullSessionUpdatedPayload(client, result.sessionId));
      fastify.broadcaster.broadcastSessionUpdated(payload, laneId);

      return reply.send(result);
    } catch (error: unknown) {
      request.log.error(error, 'Failed to sign agreement');
      const httpErr = getHttpError(error);
      if (httpErr) {
        return reply.status(httpErr.statusCode).send({
          error: httpErr.message ?? 'Failed to sign agreement',
        });
      }
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to sign agreement',
      });
    }
  });

  /**
   * POST /v1/checkin/lane/:laneId/manual-signature-override
   * 
   * Employee override to complete agreement signing without customer signature.
   * Requires authentication. Generates PDF with "Manual Signature Override" text.
   */
  fastify.post<{
    Params: { laneId: string };
    Body: { sessionId?: string };
  }>('/v1/checkin/lane/:laneId/manual-signature-override', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const { laneId } = request.params;
    const { sessionId } = request.body;

    try {
      const result = await transaction(async (client) => {
        // Get active session (by sessionId if provided, otherwise latest for lane)
        let sessionResult;
        if (sessionId) {
          sessionResult = await client.query<LaneSessionRow>(
            `SELECT * FROM lane_sessions
             WHERE id = $1 AND lane_id = $2 AND status IN ('AWAITING_SIGNATURE', 'AWAITING_PAYMENT')
             LIMIT 1`,
            [sessionId, laneId]
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

        // Agreement signing is required only for INITIAL and RENEWAL checkin_blocks
        if (session.checkin_mode !== 'INITIAL' && session.checkin_mode !== 'RENEWAL') {
          throw { statusCode: 400, message: 'Agreement signing is only required for INITIAL and RENEWAL check-ins' };
        }

        // Demo flow: require the rental selection to be confirmed/locked before payment+signature
        if (!session.selection_confirmed || !session.selection_locked_at) {
          throw { statusCode: 400, message: 'Selection must be confirmed/locked before signing agreement' };
        }

        // Check payment is paid
        if (!session.payment_intent_id) {
          throw { statusCode: 400, message: 'Payment intent must be created before signing agreement' };
        }

        const intentResult = await client.query<PaymentIntentRow>(
          `SELECT status FROM payment_intents WHERE id = $1`,
          [session.payment_intent_id]
        );
        if (intentResult.rows.length === 0 || intentResult.rows[0]!.status !== 'PAID') {
          throw { statusCode: 400, message: 'Payment must be marked as paid before signing agreement' };
        }

        // Get customer info for PDF
        const customerResult = session.customer_id
          ? await client.query<CustomerRow>(
              `SELECT name, membership_number FROM customers WHERE id = $1`,
              [session.customer_id]
            )
          : { rows: [] };

        const customerName = customerResult.rows[0]?.name || session.customer_display_name || 'Customer';
        const membershipNumber = customerResult.rows[0]?.membership_number || session.membership_number || undefined;

        // Get active agreement text
        const agreementResult = await client.query<{ id: string; body_text: string; version: string; title: string }>(
          `SELECT id, body_text, version, title FROM agreements WHERE active = true ORDER BY created_at DESC LIMIT 1`
        );

        if (agreementResult.rows.length === 0) {
          throw { statusCode: 404, message: 'No active agreement found' };
        }

        const agreement = agreementResult.rows[0]!;

        const signedAt = new Date();

        // Generate PDF with override text instead of signature image
        let pdfBuffer: Buffer;
        try {
          pdfBuffer = await generateAgreementPdf({
            agreementTitle: agreement.title,
            agreementVersion: agreement.version,
            customerName,
            membershipNumber,
            agreementText: agreement.body_text,
            signatureText: 'Manual Signature Override',
            signedAt,
          });
        } catch (e) {
          request.log.warn({ err: e }, 'Failed to generate agreement PDF for manual override');
          throw { statusCode: 500, message: 'Failed to generate agreement PDF' };
        }

        // Determine rental type from locked selection snapshot
        const rentalType = (session.desired_rental_type || session.backup_rental_type || 'LOCKER') as
          | 'LOCKER'
          | 'STANDARD'
          | 'DOUBLE'
          | 'SPECIAL'
          | 'GYM_LOCKER';

        // Assignment happens AFTER agreement signing (same as normal flow)
        let assignedResourceId = session.assigned_resource_id;
        let assignedResourceType = session.assigned_resource_type as 'room' | 'locker' | null;
        let assignedResourceNumber: string | undefined;

        if (assignedResourceId && assignedResourceType) {
          if (assignedResourceType === 'room') {
            const room = (
              await client.query<RoomRow>(
                `SELECT id, number, type, status, assigned_to_customer_id
                 FROM rooms
                 WHERE id = $1
                 FOR UPDATE`,
                [assignedResourceId]
              )
            ).rows[0];
            if (!room) throw { statusCode: 404, message: 'Selected room not found' };
            if (room.status !== 'CLEAN' || room.assigned_to_customer_id) {
              throw { statusCode: 409, message: `Selected room ${room.number} is no longer available` };
            }
            assignedResourceNumber = room.number;
          } else {
            const locker = (
              await client.query<LockerRow>(
                `SELECT id, number, status, assigned_to_customer_id
                 FROM lockers
                 WHERE id = $1
                 FOR UPDATE`,
                [assignedResourceId]
              )
            ).rows[0];
            if (!locker) throw { statusCode: 404, message: 'Selected locker not found' };
            if (locker.status !== 'CLEAN' || locker.assigned_to_customer_id) {
              throw { statusCode: 409, message: `Selected locker ${locker.number} is no longer available` };
            }
            assignedResourceNumber = locker.number;
          }
        } else {
          if (rentalType === 'LOCKER' || rentalType === 'GYM_LOCKER') {
            const locker = (
              await client.query<LockerRow>(
                `SELECT id, number, status, assigned_to_customer_id
                 FROM lockers
                 WHERE status = 'CLEAN' AND assigned_to_customer_id IS NULL
                 ORDER BY number
                 LIMIT 1
                 FOR UPDATE SKIP LOCKED`
              )
            ).rows[0];
            if (!locker) throw { statusCode: 409, message: 'No available lockers' };
            assignedResourceId = locker.id;
            assignedResourceType = 'locker';
            assignedResourceNumber = locker.number;
          } else {
            const room = (
              await client.query<RoomRow>(
                `SELECT id, number, type, status, assigned_to_customer_id
                 FROM rooms
                 WHERE status = 'CLEAN'
                   AND assigned_to_customer_id IS NULL
                   AND type = $1
                 ORDER BY number
                 LIMIT 1
                 FOR UPDATE SKIP LOCKED`,
                [rentalType]
              )
            ).rows[0];
            if (!room) throw { statusCode: 409, message: 'No available rooms' };
            assignedResourceId = room.id;
            assignedResourceType = 'room';
            assignedResourceNumber = room.number;
          }
        }

        if (!session.customer_id) {
          throw { statusCode: 400, message: 'Session has no customer; cannot complete check-in' };
        }

        // Assign inventory + mark OCCUPIED (server-authoritative, transactional)
        if (assignedResourceType === 'room') {
          await client.query(
            `UPDATE rooms
             SET status = 'OCCUPIED',
                 assigned_to_customer_id = $1,
                 last_status_change = NOW(),
                 updated_at = NOW()
             WHERE id = $2`,
            [session.customer_id, assignedResourceId]
          );
        } else {
          await client.query(
            `UPDATE lockers
             SET status = 'OCCUPIED',
                 assigned_to_customer_id = $1,
                 updated_at = NOW()
             WHERE id = $2`,
            [session.customer_id, assignedResourceId]
          );
        }

        // Ensure lane session snapshot fields are set
        await client.query(
          `UPDATE lane_sessions
           SET assigned_resource_id = $1,
               assigned_resource_type = $2,
               updated_at = NOW()
           WHERE id = $3`,
          [assignedResourceId, assignedResourceType, session.id]
        );

        // Complete check-in: create visit and check-in block with PDF (same as normal flow)
        const isRenewal = session.checkin_mode === 'RENEWAL';

        let visitId: string;
        let blockType: 'INITIAL' | 'RENEWAL';

        if (isRenewal) {
          const visitResult = await client.query<{ id: string }>(
            `SELECT id FROM visits WHERE customer_id = $1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
            [session.customer_id]
          );
          if (visitResult.rows.length === 0) {
            throw { statusCode: 400, message: 'No active visit found for renewal' };
          }
          visitId = visitResult.rows[0]!.id;
          blockType = 'RENEWAL';
        } else {
          const visitResult = await client.query<{ id: string }>(
            `INSERT INTO visits (customer_id, started_at) VALUES ($1, $2) RETURNING id`,
            [session.customer_id, signedAt]
          );
          visitId = visitResult.rows[0]!.id;
          blockType = 'INITIAL';
        }

        const checkoutAt = new Date(signedAt.getTime() + 6 * 60 * 60 * 1000);

        const blockResult = await client.query<{ id: string }>(
          `INSERT INTO checkin_blocks
           (visit_id, block_type, starts_at, ends_at, rental_type, room_id, locker_id, session_id, agreement_signed, agreement_pdf)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9)
           RETURNING id`,
          [
            visitId,
            blockType,
            signedAt,
            checkoutAt,
            rentalType,
            assignedResourceType === 'room' ? assignedResourceId : null,
            assignedResourceType === 'locker' ? assignedResourceId : null,
            session.id,
            pdfBuffer,
          ]
        );

        const blockId = blockResult.rows[0]!.id;

        // Update lane session status to COMPLETED
        await client.query(
          `UPDATE lane_sessions
           SET status = 'COMPLETED',
               updated_at = NOW()
           WHERE id = $1`,
          [session.id]
        );

        // Log audit entry for manual override
        await client.query(
          `INSERT INTO audit_logs (staff_id, action, details, created_at)
           VALUES ($1, 'MANUAL_SIGNATURE_OVERRIDE', $2, NOW())`,
          [
            request.staff?.staffId ?? null,
            JSON.stringify({
              sessionId: session.id,
              laneId,
              customerId: session.customer_id,
              customerName,
              blockId,
              rentalType,
              assignedResourceType,
              assignedResourceNumber,
            }),
          ]
        );

        return {
          success: true,
          sessionId: session.id,
          blockId,
          assignedResourceType,
          assignedResourceNumber,
          checkoutAt: checkoutAt.toISOString(),
        };
      });

      // Broadcast session update
      const { payload } = await transaction((client) =>
        buildFullSessionUpdatedPayload(client, result.sessionId)
      );
      fastify.broadcaster.broadcastSessionUpdated(payload, laneId);

      return reply.send(result);
    } catch (error: unknown) {
      request.log.error(error, 'Failed to process manual signature override');
      const httpErr = getHttpError(error);
      if (httpErr) {
        return reply.status(httpErr.statusCode).send({
          error: httpErr.message ?? 'Failed to process manual signature override',
        });
      }
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to process manual signature override',
      });
    }
  });

  /**
   * POST /v1/checkin/lane/:laneId/customer-confirm
   * 
   * Customer confirms or declines cross-type assignment.
   */
  fastify.post<{
    Params: { laneId: string };
    Body: { sessionId: string; confirmed: boolean };
  }>('/v1/checkin/lane/:laneId/customer-confirm', async (
    request,
    reply
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
                `UPDATE rooms SET assigned_to = NULL, updated_at = NOW() WHERE id = $1`,
                [session.assigned_resource_id]
              );
            } else if (session.assigned_resource_type === 'locker') {
              await client.query(
                `UPDATE lockers SET assigned_to = NULL, updated_at = NOW() WHERE id = $1`,
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
      const httpErr = getHttpError(error);
      if (httpErr) {
        return reply.status(httpErr.statusCode).send({
          error: httpErr.message ?? 'Failed to process confirmation',
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
  void completeCheckIn;
  async function completeCheckIn(
    client: Parameters<Parameters<typeof transaction>[0]>[0],
    session: LaneSessionRow,
    staffId: string
  ): Promise<void> {
    if (!session.customer_id || !session.assigned_resource_id || !session.assigned_resource_type) {
      throw new Error('Cannot complete check-in without customer and resource assignment');
    }

    const isRenewal = session.checkin_mode === 'RENEWAL';
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
      // For INITIAL: create new visit
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
      blockType = 'INITIAL';
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
         VALUES ($1, 'CHECK_IN', 'visit', $2, $3, $4)`,
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
  }, async (request, reply) => {
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

  /**
   * Helper function to check past-due balance and bypass status.
   * Returns true if customer is blocked by past-due balance.
   */
  async function checkPastDueBlocked(
    client: Parameters<Parameters<typeof transaction>[0]>[0],
    customerId: string | null,
    sessionBypassed: boolean
  ): Promise<{ blocked: boolean; balance: number }> {
    if (!customerId) {
      return { blocked: false, balance: 0 };
    }

    const customerResult = await client.query<CustomerRow>(
      `SELECT past_due_balance FROM customers WHERE id = $1`,
      [customerId]
    );

    if (customerResult.rows.length === 0) {
      return { blocked: false, balance: 0 };
    }

    const balance = parseFloat(String(customerResult.rows[0]!.past_due_balance || 0));
    const blocked = balance > 0 && !sessionBypassed;

    return { blocked, balance };
  }

  /**
   * POST /v1/checkin/lane/:laneId/past-due/demo-payment
   * 
   * Demo endpoint for past-due payment (cash or credit).
   */
  fastify.post<{
    Params: { laneId: string };
    Body: { outcome: 'CASH_SUCCESS' | 'CREDIT_SUCCESS' | 'CREDIT_DECLINE'; declineReason?: string };
  }>('/v1/checkin/lane/:laneId/past-due/demo-payment', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    if (!request.staff) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { laneId } = request.params;
    const { outcome, declineReason } = request.body;

    try {
      const result = await transaction(async (client) => {
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

        if (outcome === 'CASH_SUCCESS' || outcome === 'CREDIT_SUCCESS') {
          // Clear past-due balance
          if (session.customer_id) {
            await client.query(
              `UPDATE customers SET past_due_balance = 0, updated_at = NOW() WHERE id = $1`,
              [session.customer_id]
            );
          }

          // Update session
          await client.query(
            `UPDATE lane_sessions
             SET last_past_due_decline_reason = NULL,
                 last_past_due_decline_at = NULL,
                 updated_at = NOW()
             WHERE id = $1`,
            [session.id]
          );
        } else {
          // CREDIT_DECLINE
          await client.query(
            `UPDATE lane_sessions
             SET last_past_due_decline_reason = $1,
                 last_past_due_decline_at = NOW(),
                 updated_at = NOW()
             WHERE id = $2`,
            [declineReason || 'Payment declined', session.id]
          );
        }

        return { sessionId: session.id, success: outcome !== 'CREDIT_DECLINE', outcome };
      });

      const { payload } = await transaction((client) => buildFullSessionUpdatedPayload(client, result.sessionId));
      fastify.broadcaster.broadcastSessionUpdated(payload, laneId);

      return reply.send(result);
    } catch (error: unknown) {
      request.log.error(error, 'Failed to process past-due payment');
      const httpErr = getHttpError(error);
      if (httpErr) {
        return reply.status(httpErr.statusCode).send({
          error: httpErr.message ?? 'Failed to process payment',
        });
      }
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to process past-due payment',
      });
    }
  });

  /**
   * POST /v1/checkin/lane/:laneId/past-due/bypass
   * 
   * Bypass past-due balance check (requires admin PIN).
   */
  fastify.post<{
    Params: { laneId: string };
    Body: { managerId: string; managerPin: string };
  }>('/v1/checkin/lane/:laneId/past-due/bypass', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    if (!request.staff) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { laneId } = request.params;
    const BypassSchema = z.object({
      managerId: z.string().uuid(),
      managerPin: z.string().regex(/^\d{6}$/, 'PIN must be exactly 6 digits'),
    });

    let body: { managerId: string; managerPin: string };
    try {
      body = BypassSchema.parse(request.body);
    } catch (error) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: error instanceof z.ZodError ? error.errors : 'Invalid input',
      });
    }

    const { managerId, managerPin } = body;

    try {
      const result = await transaction(async (client) => {
        // Verify manager is ADMIN with correct PIN
        const managerResult = await client.query<{ id: string; role: string; pin_hash: string | null }>(
          `SELECT id, role, pin_hash FROM staff WHERE id = $1 AND active = true`,
          [managerId]
        );

        if (managerResult.rows.length === 0) {
          throw { statusCode: 404, message: 'Manager not found' };
        }

        const manager = managerResult.rows[0]!;

        if (manager.role !== 'ADMIN') {
          throw { statusCode: 403, message: 'Only admins can bypass past-due balance' };
        }

        if (!manager.pin_hash || !(await verifyPin(managerPin, manager.pin_hash))) {
          throw { statusCode: 401, message: 'Invalid PIN' };
        }

        // Get session
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

        // Mark as bypassed
        await client.query(
          `UPDATE lane_sessions
           SET past_due_bypassed = true,
               past_due_bypassed_by_staff_id = $1,
               past_due_bypassed_at = NOW(),
               updated_at = NOW()
           WHERE id = $2`,
          [managerId, session.id]
        );

        return { sessionId: session.id, success: true };
      });

      const { payload } = await transaction((client) => buildFullSessionUpdatedPayload(client, result.sessionId));
      fastify.broadcaster.broadcastSessionUpdated(payload, laneId);

      return reply.send(result);
    } catch (error: unknown) {
      request.log.error(error, 'Failed to bypass past-due balance');
      const httpErr = getHttpError(error);
      if (httpErr) {
        return reply.status(httpErr.statusCode).send({
          error: httpErr.message ?? 'Failed to bypass',
        });
      }
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to bypass past-due balance',
      });
    }
  });

  /**
   * POST /v1/checkin/lane/:laneId/set-language
   * 
   * Set customer's primary language preference (EN or ES).
   * Persists on customer record.
   */
  fastify.post<{
    Params: { laneId: string };
    Body: { language: 'EN' | 'ES' };
  }>('/v1/checkin/lane/:laneId/set-language', async (
    request,
    reply
  ) => {
    const { laneId } = request.params;
    const { language } = request.body;

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

        if (!session.customer_id) {
          throw { statusCode: 400, message: 'Session has no customer' };
        }

        // Update customer's primary language
        await client.query(
          `UPDATE customers SET primary_language = $1, updated_at = NOW() WHERE id = $2`,
          [language, session.customer_id]
        );

        return { sessionId: session.id, success: true, language };
      });

      const { payload } = await transaction((client) => buildFullSessionUpdatedPayload(client, result.sessionId));
      fastify.broadcaster.broadcastSessionUpdated(payload, laneId);

      return reply.send(result);
    } catch (error: unknown) {
      request.log.error(error, 'Failed to set language');
      if (error && typeof error === 'object' && 'statusCode' in error) {
        const err = error as { statusCode: number; message?: string };
        return reply.status(err.statusCode).send({
          error: err.message || 'Failed to set language',
        });
      }
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to set language',
      });
    }
  });

  /**
   * POST /v1/checkin/lane/:laneId/add-note
   * 
   * Add a note to the customer record (staff only, admin removal in office-dashboard).
   */
  fastify.post<{ Params: { laneId: string }; Body: { note: string } }>('/v1/checkin/lane/:laneId/add-note', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const staff = request.staff;
    if (!staff) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { laneId } = request.params;
    const { note } = request.body;

    if (!note || !note.trim()) {
      return reply.status(400).send({ error: 'Note is required' });
    }

    try {
      const result = await transaction(async (client) => {
        const sessionResult = await client.query<LaneSessionRow>(
          `SELECT * FROM lane_sessions
           WHERE lane_id = $1 AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE')
           ORDER BY created_at DESC
           LIMIT 1`,
          [laneId]
        );

        if (sessionResult.rows.length === 0) {
          throw { statusCode: 404, message: 'No active session found' };
        }

        const session = sessionResult.rows[0]!;

        if (!session.customer_id) {
          throw { statusCode: 400, message: 'Session has no customer' };
        }

        // Get existing notes
        const customerResult = await client.query<CustomerRow>(
          `SELECT notes FROM customers WHERE id = $1`,
          [session.customer_id]
        );

        if (customerResult.rows.length === 0) {
          throw { statusCode: 404, message: 'Customer not found' };
        }

        const existingNotes = customerResult.rows[0]!.notes || '';
        const timestamp = new Date().toISOString();
        const staffName = staff.name || 'Staff';
        const newNoteEntry = `[${timestamp}] ${staffName}: ${note.trim()}`;
        const updatedNotes = existingNotes ? `${existingNotes}\n${newNoteEntry}` : newNoteEntry;

        // Update customer notes
        await client.query(
          `UPDATE customers SET notes = $1, updated_at = NOW() WHERE id = $2`,
          [updatedNotes, session.customer_id]
        );

        return { sessionId: session.id, success: true, note: newNoteEntry };
      });

      const { payload } = await transaction((client) => buildFullSessionUpdatedPayload(client, result.sessionId));
      fastify.broadcaster.broadcastSessionUpdated(payload, laneId);

      return reply.send(result);
    } catch (error: unknown) {
      request.log.error(error, 'Failed to add note');
      if (error && typeof error === 'object' && 'statusCode' in error) {
        const err = error as { statusCode: number; message?: string };
        return reply.status(err.statusCode).send({
          error: err.message || 'Failed to add note',
        });
      }
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to add note',
      });
    }
  });

  /**
   * POST /v1/checkin/lane/:laneId/demo-take-payment
   * 
   * Demo endpoint to take payment (must be called after selection is confirmed).
   */
  fastify.post<{ Params: { laneId: string }; Body: { outcome: 'CASH_SUCCESS' | 'CREDIT_SUCCESS' | 'CREDIT_DECLINE'; declineReason?: string; registerNumber?: number } }>('/v1/checkin/lane/:laneId/demo-take-payment', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    if (!request.staff) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { laneId } = request.params;
    const { outcome, declineReason, registerNumber } = request.body;

    try {
      const result = await transaction(async (client) => {
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

        if (!session.selection_confirmed) {
          throw { statusCode: 400, message: 'Selection must be confirmed before payment' };
        }

        if (!session.payment_intent_id) {
          throw { statusCode: 400, message: 'Payment intent must be created first' };
        }

        const intentResult = await client.query<PaymentIntentRow>(
          `SELECT * FROM payment_intents WHERE id = $1`,
          [session.payment_intent_id]
        );

        if (intentResult.rows.length === 0) {
          throw { statusCode: 404, message: 'Payment intent not found' };
        }

        const intent = intentResult.rows[0]!;

        if (outcome === 'CASH_SUCCESS' || outcome === 'CREDIT_SUCCESS') {
          // Mark as paid
          await client.query(
            `UPDATE payment_intents
             SET status = 'PAID',
                 paid_at = NOW(),
                 payment_method = $1,
                 register_number = $2,
                 failure_reason = NULL,
                 failure_at = NULL,
                 updated_at = NOW()
             WHERE id = $3`,
            [
              outcome === 'CASH_SUCCESS' ? 'CASH' : 'CREDIT',
              registerNumber || null,
              intent.id,
            ]
          );

          // Update session status
          await client.query(
            `UPDATE lane_sessions SET status = 'AWAITING_SIGNATURE', updated_at = NOW() WHERE id = $1`,
            [session.id]
          );
        } else {
          // CREDIT_DECLINE
          await client.query(
            `UPDATE payment_intents
             SET failure_reason = $1,
                 failure_at = NOW(),
                 updated_at = NOW()
             WHERE id = $2`,
            [declineReason || 'Payment declined', intent.id]
          );

          await client.query(
            `UPDATE lane_sessions
             SET last_payment_decline_reason = $1,
                 last_payment_decline_at = NOW(),
                 updated_at = NOW()
             WHERE id = $2`,
            [declineReason || 'Payment declined', session.id]
          );
        }

        return {
          sessionId: session.id,
          success: outcome !== 'CREDIT_DECLINE',
          paymentIntentId: intent.id,
          status: outcome !== 'CREDIT_DECLINE' ? 'PAID' : intent.status,
        };
      });

      const { payload } = await transaction((client) => buildFullSessionUpdatedPayload(client, result.sessionId));
      fastify.broadcaster.broadcastSessionUpdated(payload, laneId);

      return reply.send({
        success: result.success,
        paymentIntentId: result.paymentIntentId,
        status: result.status,
      });
    } catch (error: unknown) {
      request.log.error(error, 'Failed to take payment');
      const httpErr = getHttpError(error);
      if (httpErr) {
        return reply.status(httpErr.statusCode).send({
          error: httpErr.message ?? 'Failed to take payment',
        });
      }
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to take payment',
      });
    }
  });

  /**
   * POST /v1/checkin/lane/:laneId/reset
   * 
   * Reset/complete transaction - marks session as completed and clears customer state.
   */
  fastify.post<{
    Params: { laneId: string };
  }>('/v1/checkin/lane/:laneId/reset', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    if (!request.staff) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { laneId } = request.params;

    try {
      const result = await transaction(async (client) => {
        const sessionResult = await client.query<LaneSessionRow>(
          `SELECT * FROM lane_sessions
           WHERE lane_id = $1 AND status != 'COMPLETED'
           ORDER BY created_at DESC
           LIMIT 1`,
          [laneId]
        );

        if (sessionResult.rows.length === 0) {
          throw { statusCode: 404, message: 'No active session found' };
        }

        const session = sessionResult.rows[0]!;

        // Mark session as completed and clear coordination fields so UI resets deterministically
        await client.query(
          `UPDATE lane_sessions
           SET status = 'COMPLETED',
               staff_id = NULL,
               customer_id = NULL,
               customer_display_name = NULL,
               membership_number = NULL,
               desired_rental_type = NULL,
               waitlist_desired_type = NULL,
               backup_rental_type = NULL,
               assigned_resource_id = NULL,
               assigned_resource_type = NULL,
               price_quote_json = NULL,
               payment_intent_id = NULL,
               proposed_rental_type = NULL,
               proposed_by = NULL,
               selection_confirmed = false,
               selection_confirmed_by = NULL,
               selection_locked_at = NULL,
               disclaimers_ack_json = NULL,
               updated_at = NOW()
           WHERE id = $1`,
          [session.id]
        );

        return { success: true, sessionId: session.id };
      });

      const { payload } = await transaction((client) => buildFullSessionUpdatedPayload(client, result.sessionId));
      fastify.broadcaster.broadcastSessionUpdated(payload, laneId);

      return reply.send({ success: true });
    } catch (error: unknown) {
      request.log.error(error, 'Failed to reset session');
      const httpErr = getHttpError(error);
      if (httpErr) {
        return reply.status(httpErr.statusCode).send({
          error: httpErr.message ?? 'Failed to reset',
        });
      }
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to reset session',
      });
    }
  });
}

