import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, transaction, serializableTransaction } from '../db/index.js';
import { requireAuth, optionalAuth } from '../auth/middleware.js';
import { requireKioskTokenOrStaff } from '../auth/kioskToken.js';
import { verifyPin } from '../auth/utils.js';
import { HttpError } from '../errors/HttpError.js';
import { generateAgreementPdf } from '../utils/pdf-generator.js';
import { stripSystemLateFeeNotes } from '../utils/lateFeeNotes.js';
import { roundUpToQuarterHour } from '../time/rounding.js';
import type { Broadcaster } from '../websocket/broadcaster.js';
import { broadcastInventoryUpdate } from './sessions.js';
import { insertAuditLog } from '../audit/auditLog.js';
import type {
  CustomerConfirmationRequiredPayload,
  CustomerConfirmedPayload,
  CustomerDeclinedPayload,
  AssignmentCreatedPayload,
  AssignmentFailedPayload,
  SelectionProposedPayload,
  SelectionLockedPayload,
  SelectionAcknowledgedPayload,
  CheckinOptionHighlightedPayload,
} from '@club-ops/shared';
import { calculatePriceQuote, type PricingInput } from '../pricing/engine.js';
import { AGREEMENT_LEGAL_BODY_HTML_BY_LANG, IdScanPayloadSchema, type IdScanPayload } from '@club-ops/shared';
import {
  calculateAge,
  computeSha256Hex,
  extractAamvaIdentity,
  isLikelyAamvaPdf417Text,
  normalizeScanText,
  parseMembershipNumber,
  passesFuzzyThresholds,
  scoreNameMatch,
  splitNamePartsForMatch,
} from '../checkin/identity.js';
import { computeWaitlistInfo, getRoomTier } from '../checkin/waitlist.js';
import { buildFullSessionUpdatedPayload, getAllowedRentals } from '../checkin/payload.js';

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
  membership_purchase_intent?: 'PURCHASE' | 'RENEW' | null;
  membership_purchase_requested_at?: Date | null;
  membership_choice?: 'ONE_TIME' | 'SIX_MONTH' | null;
  kiosk_acknowledged_at?: Date | null;
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

type RoomRentalType = 'STANDARD' | 'DOUBLE' | 'SPECIAL';

async function assertAssignedResourcePersistedAndUnavailable(params: {
  client: PoolClient;
  sessionId: string;
  customerId: string;
  resourceType: 'room' | 'locker';
  resourceId: string;
  resourceNumber?: string;
}): Promise<void> {
  const { client, sessionId, customerId, resourceType, resourceId, resourceNumber } = params;

  if (resourceType === 'room') {
    const row = (
      await client.query<{
        id: string;
        number: string;
        status: string;
        assigned_to_customer_id: string | null;
      }>(
        `SELECT id, number, status, assigned_to_customer_id
         FROM rooms
         WHERE id = $1`,
        [resourceId]
      )
    ).rows[0];

    const number = resourceNumber ?? row?.number ?? '(unknown)';
    const assignedOk = row?.assigned_to_customer_id === customerId;
    const qualifiesForAvailable = row?.status === 'CLEAN' && row?.assigned_to_customer_id === null;
    if (!assignedOk || qualifiesForAvailable) {
      const detail = `Check-in persistence assertion failed (room): sessionId=${sessionId} customerId=${customerId} resourceId=${resourceId} resourceNumber=${number} status=${row?.status ?? '(missing)'} assigned_to_customer_id=${row?.assigned_to_customer_id ?? '(null)'}`;
      throw new HttpError(500, 'Check-in persistence assertion failed', { cause: new Error(detail) });
    }
    return;
  }

  const row = (
    await client.query<{
      id: string;
      number: string;
      status: string;
      assigned_to_customer_id: string | null;
    }>(
      `SELECT id, number, status, assigned_to_customer_id
       FROM lockers
       WHERE id = $1`,
      [resourceId]
    )
  ).rows[0];

  const number = resourceNumber ?? row?.number ?? '(unknown)';
  const assignedOk = row?.assigned_to_customer_id === customerId;
  const qualifiesForAvailable = row?.status === 'CLEAN' && row?.assigned_to_customer_id === null;
  if (!assignedOk || qualifiesForAvailable) {
    const detail = `Check-in persistence assertion failed (locker): sessionId=${sessionId} customerId=${customerId} resourceId=${resourceId} resourceNumber=${number} status=${row?.status ?? '(missing)'} assigned_to_customer_id=${row?.assigned_to_customer_id ?? '(null)'}`;
    throw new HttpError(500, 'Check-in persistence assertion failed', { cause: new Error(detail) });
  }
}

async function selectRoomForNewCheckin(
  client: PoolClient,
  rentalType: RoomRentalType
): Promise<{ id: string; number: string } | null> {
  // 1) ACTIVE waitlist demand count for this tier (still within scheduled stay)
  const demandRes = await client.query<{ count: string }>(
    `SELECT COUNT(*) as count
     FROM waitlist w
     JOIN checkin_blocks cb ON cb.id = w.checkin_block_id
     JOIN visits v ON v.id = w.visit_id
     WHERE w.status = 'ACTIVE'
       AND w.desired_tier::text = $1
       AND v.ended_at IS NULL
       AND cb.ends_at > NOW()`,
    [rentalType]
  );
  const activeDemandCount = parseInt(demandRes.rows[0]?.count ?? '0', 10) || 0;

  // 2) OFFERED waitlist rooms are explicitly reserved (do not assign them)
  const offeredRes = await client.query<{ room_id: string }>(
    `SELECT w.room_id
     FROM waitlist w
     JOIN checkin_blocks cb ON cb.id = w.checkin_block_id
     JOIN visits v ON v.id = w.visit_id
     WHERE w.status = 'OFFERED'
       AND w.desired_tier::text = $1
       AND w.room_id IS NOT NULL
       AND v.ended_at IS NULL
       AND cb.ends_at > NOW()`,
    [rentalType]
  );
  const offeredRoomIds = offeredRes.rows.map((r) => r.room_id).filter(Boolean);

  // 3) Select the (activeDemandCount+1)th clean, unassigned room by number, excluding offered rooms.
  // Concurrency-safe: FOR UPDATE SKIP LOCKED
  const room = (
    await client.query<{ id: string; number: string }>(
      `SELECT id, number
       FROM rooms
       WHERE status = 'CLEAN'
         AND assigned_to_customer_id IS NULL
         AND type = $1
         AND id <> ALL($2::uuid[])
         -- Exclude rooms "selected" by an active lane session (reservation semantics).
         AND NOT EXISTS (
           SELECT 1
           FROM lane_sessions ls
           WHERE ls.assigned_resource_type = 'room'
             AND ls.assigned_resource_id = rooms.id
             AND ls.status = ANY (
               ARRAY[
                 'ACTIVE'::public.lane_session_status,
                 'AWAITING_CUSTOMER'::public.lane_session_status,
                 'AWAITING_ASSIGNMENT'::public.lane_session_status,
                 'AWAITING_PAYMENT'::public.lane_session_status,
                 'AWAITING_SIGNATURE'::public.lane_session_status
               ]
             )
         )
       ORDER BY number ASC
       OFFSET $3
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      [rentalType, offeredRoomIds, activeDemandCount]
    )
  ).rows[0];

  return room ?? null;
}

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


async function maybeAttachScanIdentifiers(params: {
  client: PoolClient;
  customerId: string;
  existingIdScanHash: string | null;
  existingIdScanValue: string | null;
  idScanHash: string;
  idScanValue: string;
}): Promise<void> {
  if (params.existingIdScanHash && params.existingIdScanValue) return;
  await params.client.query(
    `UPDATE customers
     SET id_scan_hash = COALESCE(id_scan_hash, $1),
         id_scan_value = COALESCE(id_scan_value, $2),
         updated_at = NOW()
     WHERE id = $3
       AND (id_scan_hash IS NULL OR id_scan_value IS NULL)`,
    [params.idScanHash, params.idScanValue, params.customerId]
  );
}

function getHttpError(error: unknown): { statusCode: number; message?: string } | null {
  if (!error || typeof error !== 'object') return null;
  if (!('statusCode' in error)) return null;
  const statusCode = (error as { statusCode: unknown }).statusCode;
  if (typeof statusCode !== 'number') return null;
  const message = (error as { message?: unknown }).message;
  return { statusCode, message: typeof message === 'string' ? message : undefined };
}



/**
 * Check-in flow routes.
 */
export async function checkinRoutes(fastify: FastifyInstance): Promise<void> {
  const StartLaneSessionBodySchema = z
    .object({
      customerId: z.string().uuid().optional(),
      idScanValue: z.string().min(1).optional(),
      membershipScanValue: z.string().optional(),
      visitId: z.string().uuid().optional(),
    })
    .refine((val) => !!val.customerId || !!val.idScanValue, {
      message: 'customerId or idScanValue is required',
    });

  /**
   * POST /v1/checkin/lane/:laneId/start
   *
   * Start a lane session with customer identification.
   * Input: { idScanValue, membershipScanValue? }
   * Output: laneSession + customer display fields
   */
  fastify.post<{
    Params: { laneId: string };
    Body: {
      customerId?: string;
      idScanValue?: string;
      membershipScanValue?: string;
      visitId?: string;
    };
  }>(
    '/v1/checkin/lane/:laneId/start',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
      const staffId = request.staff.staffId;

      const { laneId } = request.params;
      let body: z.infer<typeof StartLaneSessionBodySchema>;
      try {
        body = StartLaneSessionBodySchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      const { customerId: requestedCustomerId, idScanValue, membershipScanValue, visitId } = body;

      try {
        const result = await transaction(async (client) => {
          // Parse membership number if provided
          let membershipNumber = membershipScanValue
            ? parseMembershipNumber(membershipScanValue)
            : null;

          // Look up or create customer (customers is canonical identity; members is deprecated)
          let customerId: string | null = null;
          let customerName = 'Customer';

          if (requestedCustomerId) {
            const customerResult = await client.query<CustomerRow>(
              `SELECT id, name, dob, membership_number, membership_card_type, membership_valid_until, banned_until
             FROM customers
             WHERE id = $1
             LIMIT 1`,
              [requestedCustomerId]
            );
            if (customerResult.rows.length === 0) {
              throw { statusCode: 404, message: 'Customer not found' };
            }
            const customer = customerResult.rows[0]!;
            customerId = customer.id;
            customerName = customer.name;
            membershipNumber = customer.membership_number || null;

            const bannedUntil = toDate(customer.banned_until);
            if (bannedUntil && new Date() < bannedUntil) {
              throw {
                statusCode: 403,
                message: 'Customer is banned until ' + bannedUntil.toISOString(),
              };
            }
          } else {
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
                  throw {
                    statusCode: 403,
                    message: 'Customer is banned until ' + bannedUntil.toISOString(),
                  };
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
          }

          // Determine mode (explicit renewal only). If an active visit exists and no explicit visitId
          // is provided, treat as "already checked in" (lookup-only) and block a new check-in flow.
          let computedMode: 'INITIAL' | 'RENEWAL' = 'INITIAL';
          let visitIdForSession: string | null = null;
          let blockEndsAtDate: Date | null = null;
          let currentTotalHours = 0;
          let activeAssignedResourceType: 'room' | 'locker' | null = null;
          let activeAssignedResourceNumber: string | null = null;
          let activeRentalType: string | null = null;

          const resolveVisitBlocks = async (activeVisitId: string) => {
            const blocksResult = await client.query<{
              ends_at: Date;
              starts_at: Date;
            }>(
              `SELECT starts_at, ends_at FROM checkin_blocks 
             WHERE visit_id = $1 ORDER BY ends_at DESC`,
              [activeVisitId]
            );
            if (blocksResult.rows.length > 0) {
              blockEndsAtDate = blocksResult.rows[0]!.ends_at;
              for (const block of blocksResult.rows) {
                const hours =
                  (block.ends_at.getTime() - block.starts_at.getTime()) / (1000 * 60 * 60);
                currentTotalHours += hours;
              }
            }
          };

          const resolveActiveAssignment = async (activeVisitId: string) => {
            const activeBlock = await client.query<{
              rental_type: string;
              room_number: string | null;
              locker_number: string | null;
            }>(
              `SELECT cb.rental_type, r.number as room_number, l.number as locker_number
               FROM checkin_blocks cb
               LEFT JOIN rooms r ON cb.room_id = r.id
               LEFT JOIN lockers l ON cb.locker_id = l.id
               WHERE cb.visit_id = $1
               ORDER BY cb.ends_at DESC
               LIMIT 1`,
              [activeVisitId]
            );
            const row = activeBlock.rows[0];
            if (!row) return;
            activeRentalType = row.rental_type;
            if (row.room_number) {
              activeAssignedResourceType = 'room';
              activeAssignedResourceNumber = row.room_number;
            } else if (row.locker_number) {
              activeAssignedResourceType = 'locker';
              activeAssignedResourceNumber = row.locker_number;
            }
          };

          if (visitId) {
            // Explicit visit selection forces renewal
            const visitResult = await client.query<{
              id: string;
              customer_id: string;
              started_at: Date;
              ended_at: Date | null;
            }>(`SELECT id, customer_id, started_at, ended_at FROM visits WHERE id = $1`, [visitId]);
            if (visitResult.rows.length === 0) {
              throw { statusCode: 404, message: 'Visit not found' };
            }
            const visit = visitResult.rows[0]!;
            if (customerId && visit.customer_id !== customerId) {
              throw { statusCode: 403, message: 'Visit does not belong to this customer' };
            }
            visitIdForSession = visit.id;
            computedMode = 'RENEWAL';
            await resolveVisitBlocks(visit.id);
            await resolveActiveAssignment(visit.id);
          } else if (customerId) {
            const activeVisit = await client.query<{ id: string }>(
              `SELECT id FROM visits WHERE customer_id = $1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
              [customerId]
            );
            if (activeVisit.rows.length > 0) {
              const activeVisitId = activeVisit.rows[0]!.id;

              const activeBlock = await client.query<{
                starts_at: Date;
                ends_at: Date;
                rental_type: string;
                room_number: string | null;
                locker_number: string | null;
              }>(
                `SELECT cb.starts_at, cb.ends_at, cb.rental_type, r.number as room_number, l.number as locker_number
                 FROM checkin_blocks cb
                 LEFT JOIN rooms r ON cb.room_id = r.id
                 LEFT JOIN lockers l ON cb.locker_id = l.id
                 WHERE cb.visit_id = $1
                 ORDER BY cb.ends_at DESC
                 LIMIT 1`,
                [activeVisitId]
              );

              const block = activeBlock.rows[0];
              const assignedResourceType: 'room' | 'locker' | null = block?.room_number
                ? 'room'
                : block?.locker_number
                  ? 'locker'
                  : null;
              const assignedResourceNumber: string | null =
                block?.room_number ?? block?.locker_number ?? null;

              const waitlistResult = await client.query<{
                id: string;
                desired_tier: string;
                backup_tier: string;
                status: string;
              }>(
                `SELECT id, desired_tier, backup_tier, status
                 FROM waitlist
                 WHERE visit_id = $1 AND status IN ('ACTIVE', 'OFFERED')
                 ORDER BY created_at DESC
                 LIMIT 1`,
                [activeVisitId]
              );
              const wl = waitlistResult.rows[0];

              throw {
                statusCode: 409,
                code: 'ALREADY_CHECKED_IN',
                message: 'Customer is currently checked in',
                activeCheckin: {
                  visitId: activeVisitId,
                  rentalType: block?.rental_type ?? null,
                  assignedResourceType,
                  assignedResourceNumber,
                  checkinAt: block?.starts_at ? block.starts_at.toISOString() : null,
                  checkoutAt: block?.ends_at ? block.ends_at.toISOString() : null,
                  overdue: block?.ends_at ? block.ends_at.getTime() < Date.now() : null,
                  waitlist: wl
                    ? {
                        id: wl.id,
                        desiredTier: wl.desired_tier,
                        backupTier: wl.backup_tier,
                        status: wl.status,
                      }
                    : null,
                },
              };
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
              [
                customerName,
                membershipNumber,
                customerId,
                staffId,
                computedMode,
                existingSession.rows[0]!.id,
              ]
            );
            session = updateResult.rows[0]!;
          } else {
            // Create new session
            const newSessionResult = await client.query<LaneSessionRow>(
              `INSERT INTO lane_sessions 
             (lane_id, status, staff_id, customer_id, customer_display_name, membership_number, checkin_mode)
             VALUES ($1, 'ACTIVE', $2, $3, $4, $5, $6)
             RETURNING *`,
              [laneId, staffId, customerId, customerName, membershipNumber, computedMode]
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
            mode: computedMode,
            blockEndsAt: toDate(blockEndsAtDate)?.toISOString(),
            visitId: visitIdForSession || undefined,
            currentTotalHours: computedMode === 'RENEWAL' ? currentTotalHours : undefined,
            pastDueBalance,
            pastDueBlocked,
            activeAssignedResourceType: activeAssignedResourceType || undefined,
            activeAssignedResourceNumber: activeAssignedResourceNumber || undefined,
            activeRentalType: activeRentalType || undefined,
          };
        });

        // Broadcast full session update (stable payload)
        const { payload } = await transaction((client) =>
          buildFullSessionUpdatedPayload(client, result.sessionId)
        );
        fastify.broadcaster.broadcastSessionUpdated(payload, laneId);

        return reply.send(result);
      } catch (error: unknown) {
        request.log.error(error, 'Failed to start lane session');
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const statusCode = (error as { statusCode: number }).statusCode;
          const message = (error as { message?: string }).message;
          const code = (error as { code?: unknown }).code;
          const activeCheckin = (error as { activeCheckin?: unknown }).activeCheckin;
          return reply.status(statusCode).send({
            error: message ?? 'Failed to start session',
            code: typeof code === 'string' ? code : undefined,
            activeCheckin: activeCheckin && typeof activeCheckin === 'object' ? activeCheckin : undefined,
          });
        }
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to start lane session',
        });
      }
    }
  );

  /**
   * POST /v1/checkin/scan
   *
   * Server-side scan normalization, classification, parsing, and customer matching.
   * Input: { laneId, rawScanText }
   *
   * Returns one of:
   * - MATCHED: customer record (and enrichment applied if match was via name+DOB)
   * - NO_MATCH: extracted identity payload for prefill (ID scans) or membership candidate (non-ID)
   * - ERROR: banned / invalid scan / auth error
   */
  const CheckinScanBodySchema = z.object({
    laneId: z.string().min(1),
    rawScanText: z.string().min(1),
    selectedCustomerId: z.string().uuid().optional(),
  });

  fastify.post('/v1/checkin/scan', { preHandler: [requireAuth] }, async (request, reply) => {
    if (!request.staff) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    let body: z.infer<typeof CheckinScanBodySchema>;
    try {
      body = CheckinScanBodySchema.parse(request.body);
    } catch (error) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: error instanceof z.ZodError ? error.errors : 'Invalid input',
      });
    }

    const normalized = normalizeScanText(body.rawScanText);
    if (!normalized) {
      return reply.status(400).send({
        result: 'ERROR',
        error: { code: 'INVALID_SCAN', message: 'Empty scan input' },
      });
    }

    const isAamva = isLikelyAamvaPdf417Text(normalized);
    if (body.selectedCustomerId && !isAamva) {
      return reply.status(400).send({
        result: 'ERROR',
        error: { code: 'INVALID_SELECTION', message: 'Selected customer does not match this scan' },
      });
    }

    try {
      const result = await transaction(async (client) => {
        type CustomerIdentityRow = {
          id: string;
          name: string;
          dob: Date | null;
          membership_number: string | null;
          banned_until: Date | null;
          id_scan_hash: string | null;
          id_scan_value: string | null;
        };

        const checkBanned = (row: CustomerIdentityRow) => {
          const bannedUntil = toDate(row.banned_until);
          if (bannedUntil && bannedUntil > new Date()) {
            throw {
              statusCode: 403,
              code: 'BANNED',
              message: `Customer is banned until ${bannedUntil.toISOString()}`,
            };
          }
        };

        if (isAamva) {
          const extracted = extractAamvaIdentity(normalized);
          const idScanValue = normalized;
          const idScanHash = computeSha256Hex(idScanValue);

          // Employee-choice resolution (step after MULTIPLE_MATCHES)
          if (body.selectedCustomerId) {
            const selected = await client.query<CustomerIdentityRow>(
              `SELECT id, name, dob, membership_number, banned_until, id_scan_hash, id_scan_value
               FROM customers
               WHERE id = $1
               LIMIT 1`,
              [body.selectedCustomerId]
            );
            if (selected.rows.length === 0) {
              throw {
                statusCode: 400,
                code: 'INVALID_SELECTION',
                message: 'Selected customer does not match this scan',
              };
            }
            const chosen = selected.rows[0]!;

            // Only allow selection resolution when scan has the identity fields needed.
            if (!extracted.dob || !extracted.firstName || !extracted.lastName) {
              throw {
                statusCode: 400,
                code: 'INVALID_SELECTION',
                message: 'Selected customer does not match this scan',
              };
            }

            const chosenDob = chosen.dob ? chosen.dob.toISOString().slice(0, 10) : null;
            if (chosenDob !== extracted.dob) {
              throw {
                statusCode: 400,
                code: 'INVALID_SELECTION',
                message: 'Selected customer does not match this scan',
              };
            }

            const scannedParts = splitNamePartsForMatch(
              `${extracted.firstName} ${extracted.lastName}`.trim()
            );
            const storedParts = splitNamePartsForMatch(chosen.name);
            if (!scannedParts || !storedParts) {
              throw {
                statusCode: 400,
                code: 'INVALID_SELECTION',
                message: 'Selected customer does not match this scan',
              };
            }

            const fuzzy = scoreNameMatch({
              scannedFirst: scannedParts.firstToken,
              scannedLast: scannedParts.lastToken,
              storedFirst: storedParts.firstToken,
              storedLast: storedParts.lastToken,
            });
            if (!passesFuzzyThresholds(fuzzy)) {
              throw {
                statusCode: 400,
                code: 'INVALID_SELECTION',
                message: 'Selected customer does not match this scan',
              };
            }

            checkBanned(chosen);
            await maybeAttachScanIdentifiers({
              client,
              customerId: chosen.id,
              existingIdScanHash: chosen.id_scan_hash,
              existingIdScanValue: chosen.id_scan_value,
              idScanHash,
              idScanValue,
            });

            return {
              result: 'MATCHED' as const,
              scanType: 'STATE_ID' as const,
              normalizedRawScanText: idScanValue,
              idScanHash,
              customer: {
                id: chosen.id,
                name: chosen.name,
                dob: chosen.dob ? chosen.dob.toISOString().slice(0, 10) : null,
                membershipNumber: chosen.membership_number,
              },
              extracted,
              enriched: Boolean(!chosen.id_scan_hash || !chosen.id_scan_value),
            };
          }

          // Matching order:
          // 1) customers.id_scan_hash OR customers.id_scan_value
          const byHashOrValue = await client.query<CustomerIdentityRow>(
            `SELECT id, name, dob, membership_number, banned_until, id_scan_hash, id_scan_value
             FROM customers
             WHERE id_scan_hash = $1 OR id_scan_value = $2
             LIMIT 2`,
            [idScanHash, idScanValue]
          );

          if (byHashOrValue.rows.length > 0) {
            const matched =
              byHashOrValue.rows.find((r) => r.id_scan_hash === idScanHash) ??
              byHashOrValue.rows[0]!;

            checkBanned(matched);

            // Ensure both identifiers are persisted for future instant matches.
            await maybeAttachScanIdentifiers({
              client,
              customerId: matched.id,
              existingIdScanHash: matched.id_scan_hash,
              existingIdScanValue: matched.id_scan_value,
              idScanHash,
              idScanValue,
            });

            return {
              result: 'MATCHED' as const,
              scanType: 'STATE_ID' as const,
              normalizedRawScanText: idScanValue,
              idScanHash,
              customer: {
                id: matched.id,
                name: matched.name,
                dob: matched.dob ? matched.dob.toISOString().slice(0, 10) : null,
                membershipNumber: matched.membership_number,
              },
              extracted,
              enriched: false,
            };
          }

          // 2) fallback match by (first_name,last_name,birthdate) normalized
          if (extracted.firstName && extracted.lastName && extracted.dob) {
            // Compare against customers.dob (DATE) using an explicit date cast to avoid timezone issues.
            const dobStr = extracted.dob;
            if (/^\d{4}-\d{2}-\d{2}$/.test(dobStr)) {
              const byNameDob = await client.query<CustomerIdentityRow>(
                `SELECT id, name, dob, membership_number, banned_until, id_scan_hash, id_scan_value
                 FROM customers
                 WHERE dob = $1::date
                   AND lower(split_part(name, ' ', 1)) = lower($2)
                   AND lower(regexp_replace(name, '^.*\\s', '')) = lower($3)
                 LIMIT 2`,
                [dobStr, extracted.firstName, extracted.lastName]
              );

              if (byNameDob.rows.length > 0) {
                const matched = byNameDob.rows[0]!;
                checkBanned(matched);

                // Enrich customer for future instant matches
                await maybeAttachScanIdentifiers({
                  client,
                  customerId: matched.id,
                  existingIdScanHash: matched.id_scan_hash,
                  existingIdScanValue: matched.id_scan_value,
                  idScanHash,
                  idScanValue,
                });

                return {
                  result: 'MATCHED' as const,
                  scanType: 'STATE_ID' as const,
                  normalizedRawScanText: idScanValue,
                  idScanHash,
                  customer: {
                    id: matched.id,
                    name: matched.name,
                    dob: matched.dob ? matched.dob.toISOString().slice(0, 10) : null,
                    membershipNumber: matched.membership_number,
                  },
                  extracted,
                  enriched: Boolean(!matched.id_scan_hash || !matched.id_scan_value),
                };
              }

              // 2b) fuzzy match: exact DOB filter in SQL, then deterministic similarity in app code
              const scannedParts = splitNamePartsForMatch(
                `${extracted.firstName} ${extracted.lastName}`.trim()
              );
              if (scannedParts) {
                const candidatesByDob = await client.query<CustomerIdentityRow>(
                  `SELECT id, name, dob, membership_number, banned_until, id_scan_hash, id_scan_value
                   FROM customers
                   WHERE dob = $1::date
                   LIMIT 200`,
                  [dobStr]
                );

                const scored = candidatesByDob.rows
                  .map((row) => {
                    const storedParts = splitNamePartsForMatch(row.name);
                    if (!storedParts) return null;
                    const s = scoreNameMatch({
                      scannedFirst: scannedParts.firstToken,
                      scannedLast: scannedParts.lastToken,
                      storedFirst: storedParts.firstToken,
                      storedLast: storedParts.lastToken,
                    });
                    return { row, score: s };
                  })
                  .filter((x): x is { row: CustomerIdentityRow; score: { score: number; firstMax: number; lastMax: number } } =>
                    Boolean(x && passesFuzzyThresholds(x.score))
                  )
                  .sort((a, b) => b.score.score - a.score.score);

                if (scored.length === 1) {
                  const matched = scored[0]!.row;
                  checkBanned(matched);
                  await maybeAttachScanIdentifiers({
                    client,
                    customerId: matched.id,
                    existingIdScanHash: matched.id_scan_hash,
                    existingIdScanValue: matched.id_scan_value,
                    idScanHash,
                    idScanValue,
                  });
                  return {
                    result: 'MATCHED' as const,
                    scanType: 'STATE_ID' as const,
                    normalizedRawScanText: idScanValue,
                    idScanHash,
                    customer: {
                      id: matched.id,
                      name: matched.name,
                      dob: matched.dob ? matched.dob.toISOString().slice(0, 10) : null,
                      membershipNumber: matched.membership_number,
                    },
                    extracted,
                    enriched: Boolean(!matched.id_scan_hash || !matched.id_scan_value),
                  };
                }

                if (scored.length > 1) {
                  return {
                    result: 'MULTIPLE_MATCHES' as const,
                    scanType: 'STATE_ID' as const,
                    normalizedRawScanText: idScanValue,
                    idScanHash,
                    extracted,
                    candidates: scored.slice(0, 10).map(({ row, score }) => ({
                      id: row.id,
                      name: row.name,
                      dob: row.dob ? row.dob.toISOString().slice(0, 10) : null,
                      membershipNumber: row.membership_number,
                      matchScore: score.score,
                    })),
                  };
                }
              }
            }
          }

          // 3) no match: return extracted identity for prefill
          return {
            result: 'NO_MATCH' as const,
            scanType: 'STATE_ID' as const,
            normalizedRawScanText: idScanValue,
            idScanHash,
            extracted,
          };
        }

        // Non-state-ID: treat as membership/general barcode
        const membershipCandidate = parseMembershipNumber(normalized) || normalized;

        const byMembership = await client.query<CustomerIdentityRow>(
          `SELECT id, name, dob, membership_number, banned_until, id_scan_hash, id_scan_value
           FROM customers
           WHERE membership_number = $1
           LIMIT 1`,
          [membershipCandidate]
        );

        if (byMembership.rows.length > 0) {
          const matched = byMembership.rows[0]!;
          checkBanned(matched);
          return {
            result: 'MATCHED' as const,
            scanType: 'MEMBERSHIP' as const,
            normalizedRawScanText: normalized,
            membershipNumber: matched.membership_number,
            customer: {
              id: matched.id,
              name: matched.name,
              dob: matched.dob ? matched.dob.toISOString().slice(0, 10) : null,
              membershipNumber: matched.membership_number,
            },
          };
        }

        return {
          result: 'NO_MATCH' as const,
          scanType: 'MEMBERSHIP' as const,
          normalizedRawScanText: normalized,
          membershipCandidate,
        };
      });

      return reply.send(result);
    } catch (error) {
      request.log.error(error, 'Failed to process checkin scan');
      if (error && typeof error === 'object' && 'statusCode' in error) {
        const statusCode = (error as { statusCode: number }).statusCode;
        const code = (error as { code?: string }).code;
        const message = (error as { message?: string }).message;
        return reply.status(statusCode).send({
          result: 'ERROR',
          error: { code: code || 'ERROR', message: message || 'Failed to process scan' },
        });
      }
      return reply.status(500).send({
        result: 'ERROR',
        error: { code: 'INTERNAL', message: 'Failed to process scan' },
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
  }>(
    '/v1/checkin/lane/:laneId/scan-id',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
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
          let idScanValue: string | null = null;
          if (body.raw) {
            idScanValue = normalizeScanText(body.raw);
            idScanHash = computeSha256Hex(idScanValue);
          } else if (body.idNumber && (body.issuer || body.jurisdiction)) {
            // Fallback: derive hash from issuer + idNumber
            const issuer = body.issuer || body.jurisdiction || '';
            const combined = `${issuer}:${body.idNumber}`;
            idScanHash = computeSha256Hex(combined);
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
            const existingCustomer = await client.query<{
              id: string;
              name: string;
              dob: Date | null;
            }>(
              `SELECT id, name, dob FROM customers WHERE id_scan_hash = $1 OR id_scan_value = $2 LIMIT 1`,
              [idScanHash, idScanValue]
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

              // Ensure scan identifiers are persisted for future matches.
              if (idScanValue) {
                await client.query(
                  `UPDATE customers
                 SET id_scan_hash = COALESCE(id_scan_hash, $1),
                     id_scan_value = COALESCE(id_scan_value, $2),
                     updated_at = NOW()
                 WHERE id = $3`,
                  [idScanHash, idScanValue, customerId]
                );
              }
            } else {
              // Create new customer
              const newCustomer = await client.query<{ id: string }>(
                `INSERT INTO customers (name, dob, id_scan_hash, id_scan_value, created_at, updated_at)
               VALUES ($1, $2, $3, $4, NOW(), NOW())
               RETURNING id`,
                [customerName, dob, idScanHash, idScanValue]
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
              [customerName, dob, idScanValue]
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
            throw {
              statusCode: 403,
              message: `Customer is banned until ${bannedUntil.toISOString()}`,
            };
          }

          // If customer already has an active (not-ended) visit, block a new lane check-in session.
          // Renewal/extension must be started explicitly via /start with visitId.
          if (customerId) {
            const activeVisit = await client.query<{ id: string }>(
              `SELECT id FROM visits WHERE customer_id = $1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
              [customerId]
            );
            if (activeVisit.rows.length > 0) {
              const activeVisitId = activeVisit.rows[0]!.id;

              const activeBlock = await client.query<{
                starts_at: Date;
                ends_at: Date;
                rental_type: string;
                room_number: string | null;
                locker_number: string | null;
              }>(
                `SELECT cb.starts_at, cb.ends_at, cb.rental_type, r.number as room_number, l.number as locker_number
                 FROM checkin_blocks cb
                 LEFT JOIN rooms r ON cb.room_id = r.id
                 LEFT JOIN lockers l ON cb.locker_id = l.id
                 WHERE cb.visit_id = $1
                 ORDER BY cb.ends_at DESC
                 LIMIT 1`,
                [activeVisitId]
              );

              const block = activeBlock.rows[0];
              const assignedResourceType: 'room' | 'locker' | null = block?.room_number
                ? 'room'
                : block?.locker_number
                  ? 'locker'
                  : null;
              const assignedResourceNumber: string | null =
                block?.room_number ?? block?.locker_number ?? null;

              const waitlistResult = await client.query<{
                id: string;
                desired_tier: string;
                backup_tier: string;
                status: string;
              }>(
                `SELECT id, desired_tier, backup_tier, status
                 FROM waitlist
                 WHERE visit_id = $1 AND status IN ('ACTIVE', 'OFFERED')
                 ORDER BY created_at DESC
                 LIMIT 1`,
                [activeVisitId]
              );
              const wl = waitlistResult.rows[0];

              throw {
                statusCode: 409,
                code: 'ALREADY_CHECKED_IN',
                message: 'Customer is currently checked in',
                activeCheckin: {
                  visitId: activeVisitId,
                  rentalType: block?.rental_type ?? null,
                  assignedResourceType,
                  assignedResourceNumber,
                  checkinAt: block?.starts_at ? block.starts_at.toISOString() : null,
                  checkoutAt: block?.ends_at ? block.ends_at.toISOString() : null,
                  overdue: block?.ends_at ? block.ends_at.getTime() < Date.now() : null,
                  waitlist: wl
                    ? {
                        id: wl.id,
                        desiredTier: wl.desired_tier,
                        backupTier: wl.backup_tier,
                        status: wl.status,
                      }
                    : null,
                },
              };
            }
          }

          const computedMode: 'INITIAL' | 'RENEWAL' = 'INITIAL';

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
                 checkin_mode = $4,
                 updated_at = NOW()
             WHERE id = $5
             RETURNING *`,
              [customerId, customerName, staffId, computedMode, existingSession.rows[0]!.id]
            );
            session = updateResult.rows[0]!;
          } else {
            // Create new session
            const newSessionResult = await client.query<LaneSessionRow>(
              `INSERT INTO lane_sessions 
             (lane_id, status, staff_id, customer_id, customer_display_name, checkin_mode)
             VALUES ($1, 'ACTIVE', $2, $3, $4, $5)
             RETURNING *`,
              [laneId, staffId, customerId, customerName, computedMode]
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
            mode: computedMode,
            pastDueBalance,
            pastDueBlocked,
            customerNotes,
            customerPrimaryLanguage,
            customerDobMonthDay,
          };
        });

        // Broadcast full session update (stable payload)
        const { payload } = await transaction((client) =>
          buildFullSessionUpdatedPayload(client, result.sessionId)
        );
        fastify.broadcaster.broadcastSessionUpdated(payload, laneId);

        return reply.send(result);
      } catch (error: unknown) {
        request.log.error(error, 'Failed to scan ID');
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const statusCode = (error as { statusCode: number }).statusCode;
          const message = (error as { message?: string }).message;
          const code = (error as { code?: unknown }).code;
          const activeCheckin = (error as { activeCheckin?: unknown }).activeCheckin;
          return reply.status(statusCode).send({
            error: message ?? 'Failed to scan ID',
            code: typeof code === 'string' ? code : undefined,
            activeCheckin: activeCheckin && typeof activeCheckin === 'object' ? activeCheckin : undefined,
          });
        }
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

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
  }>(
    '/v1/checkin/lane/:laneId/select-rental',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
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
        const { payload } = await transaction((client) =>
          buildFullSessionUpdatedPayload(client, result.sessionId)
        );
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
    }
  );

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
  }>(
    '/v1/checkin/lane/:laneId/propose-selection',
    {
      preHandler: [optionalAuth, requireKioskTokenOrStaff],
    },
    async (request, reply) => {
      const { laneId } = request.params;
      const { rentalType, proposedBy, waitlistDesiredType, backupRentalType } = request.body;

      // Validate proposedBy
      if (proposedBy !== 'CUSTOMER' && proposedBy !== 'EMPLOYEE') {
        return reply.status(400).send({ error: 'proposedBy must be CUSTOMER or EMPLOYEE' });
      }

      // If employee, require auth
      if (proposedBy === 'EMPLOYEE' && !request.staff) {
        return reply
          .status(401)
          .send({ error: 'Unauthorized - employee proposals require authentication' });
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
          const { blocked } = await checkPastDueBlocked(
            client,
            session.customer_id,
            session.past_due_bypassed || false
          );
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
            [
              rentalType,
              proposedBy,
              waitlistDesiredType || null,
              backupRentalType || null,
              session.id,
            ]
          );

          const updated = updateResult.rows[0]!;

          // Broadcast selection proposed
          const proposePayload: SelectionProposedPayload = {
            sessionId: updated.id,
            rentalType,
            proposedBy,
          };
          fastify.broadcaster.broadcastToLane(
            {
              type: 'SELECTION_PROPOSED',
              payload: proposePayload,
              timestamp: new Date().toISOString(),
            },
            laneId
          );

          return {
            sessionId: updated.id,
            proposedRentalType: rentalType,
            proposedBy,
          };
        });

        // Broadcast full session update (stable payload)
        const { payload } = await transaction((client) =>
          buildFullSessionUpdatedPayload(client, result.sessionId)
        );
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
    }
  );

  /**
   * POST /v1/checkin/lane/:laneId/confirm-selection
   *
   * Confirm the proposed selection (first confirmation locks it).
   * Public endpoint (customer kiosk can call without auth).
   */
  fastify.post<{
    Params: { laneId: string };
    Body: { confirmedBy: 'CUSTOMER' | 'EMPLOYEE' };
  }>(
    '/v1/checkin/lane/:laneId/confirm-selection',
    {
      preHandler: [optionalAuth],
    },
    async (request, reply) => {
      const { laneId } = request.params;
      const { confirmedBy } = request.body;

      // Validate confirmedBy
      if (confirmedBy !== 'CUSTOMER' && confirmedBy !== 'EMPLOYEE') {
        return reply.status(400).send({ error: 'confirmedBy must be CUSTOMER or EMPLOYEE' });
      }

      // If employee, require auth
      if (confirmedBy === 'EMPLOYEE' && !request.staff) {
        return reply
          .status(401)
          .send({ error: 'Unauthorized - employee confirmations require authentication' });
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
          const { blocked } = await checkPastDueBlocked(
            client,
            session.customer_id,
            session.past_due_bypassed || false
          );
          if (blocked && confirmedBy === 'CUSTOMER') {
            throw {
              statusCode: 403,
              message: 'Past due balance must be cleared before confirmation',
            };
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
          fastify.broadcaster.broadcastToLane(
            {
              type: 'SELECTION_LOCKED',
              payload: lockedPayload,
              timestamp: new Date().toISOString(),
            },
            laneId
          );

          if (confirmedBy === 'EMPLOYEE') {
            fastify.broadcaster.broadcastSelectionForced(
              {
                sessionId: updated.id,
                rentalType: updated.proposed_rental_type!,
                forcedBy: 'EMPLOYEE',
              },
              laneId
            );
          }

          return {
            sessionId: updated.id,
            rentalType: updated.proposed_rental_type,
            confirmedBy,
          };
        });

        // Broadcast full session update (stable payload)
        const { payload } = await transaction((client) =>
          buildFullSessionUpdatedPayload(client, result.sessionId)
        );
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
    }
  );

  /**
   * POST /v1/checkin/lane/:laneId/acknowledge-selection
   *
   * Acknowledge a locked selection (required for the other side to proceed).
   * Public endpoint (customer kiosk can call without auth).
   */
  fastify.post<{
    Params: { laneId: string };
    Body: { acknowledgedBy: 'CUSTOMER' | 'EMPLOYEE' };
  }>(
    '/v1/checkin/lane/:laneId/acknowledge-selection',
    {
      preHandler: [optionalAuth],
    },
    async (request, reply) => {
      const { laneId } = request.params;
      const { acknowledgedBy } = request.body;

      // Validate acknowledgedBy
      if (acknowledgedBy !== 'CUSTOMER' && acknowledgedBy !== 'EMPLOYEE') {
        return reply.status(400).send({ error: 'acknowledgedBy must be CUSTOMER or EMPLOYEE' });
      }

      // If employee, require auth
      if (acknowledgedBy === 'EMPLOYEE' && !request.staff) {
        return reply
          .status(401)
          .send({ error: 'Unauthorized - employee acknowledgements require authentication' });
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
          fastify.broadcaster.broadcastToLane(
            {
              type: 'SELECTION_ACKNOWLEDGED',
              payload: ackPayload,
              timestamp: new Date().toISOString(),
            },
            laneId
          );

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
    }
  );

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
  }>(
    '/v1/checkin/lane/:laneId/waitlist-info',
    {
      preHandler: [optionalAuth],
    },
    async (request, reply) => {
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
    }
  );

  /**
   * POST /v1/checkin/lane/:laneId/assign
   *
   * Assign a resource (room or locker) to the lane session.
   * Uses transactional locking to prevent double-booking.
   */
  fastify.post<{
    Params: { laneId: string };
    Body: { resourceType: 'room' | 'locker'; resourceId: string };
  }>(
    '/v1/checkin/lane/:laneId/assign',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
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
              throw {
                statusCode: 400,
                message: `Room ${room.number} is not available (status: ${room.status})`,
              };
            }

            if (room.assigned_to_customer_id) {
              throw {
                statusCode: 409,
                message: `Room ${room.number} is already assigned (race condition)`,
              };
            }

            // Also prevent "double selection" across lane sessions (we only persist the selection on lane_sessions
            // until agreement signing completes; treat that selection as a reservation).
            const selectedByOther = await client.query<{ id: string; lane_id: string }>(
              `SELECT id, lane_id
               FROM lane_sessions
               WHERE id <> $1
                 AND assigned_resource_type = 'room'
                 AND assigned_resource_id = $2
                 AND status = ANY (
                   ARRAY[
                     'ACTIVE'::public.lane_session_status,
                     'AWAITING_CUSTOMER'::public.lane_session_status,
                     'AWAITING_ASSIGNMENT'::public.lane_session_status,
                     'AWAITING_PAYMENT'::public.lane_session_status,
                     'AWAITING_SIGNATURE'::public.lane_session_status
                   ]
                 )
               LIMIT 1`,
              [session.id, resourceId]
            );
            if (selectedByOther.rows.length > 0) {
              throw {
                statusCode: 409,
                message: `Room ${room.number} is already selected by another lane session (race condition)`,
              };
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
            await insertAuditLog(client, {
              staffId,
              action: 'ASSIGN',
              entityType: 'room',
              entityId: resourceId,
              oldValue: { assigned_to_customer_id: null },
              newValue: { selected_for_session_id: session.id },
            });

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
              fastify.broadcaster.broadcastCustomerConfirmationRequired(
                confirmationPayload,
                laneId
              );
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
              throw {
                statusCode: 409,
                message: `Locker ${locker.number} is already assigned (race condition)`,
              };
            }

            // Prevent "double selection" across lane sessions (treat lane_sessions selection as reservation).
            const selectedByOther = await client.query<{ id: string; lane_id: string }>(
              `SELECT id, lane_id
               FROM lane_sessions
               WHERE id <> $1
                 AND assigned_resource_type = 'locker'
                 AND assigned_resource_id = $2
                 AND status = ANY (
                   ARRAY[
                     'ACTIVE'::public.lane_session_status,
                     'AWAITING_CUSTOMER'::public.lane_session_status,
                     'AWAITING_ASSIGNMENT'::public.lane_session_status,
                     'AWAITING_PAYMENT'::public.lane_session_status,
                     'AWAITING_SIGNATURE'::public.lane_session_status
                   ]
                 )
               LIMIT 1`,
              [session.id, resourceId]
            );
            if (selectedByOther.rows.length > 0) {
              throw {
                statusCode: 409,
                message: `Locker ${locker.number} is already selected by another lane session (race condition)`,
              };
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
            await insertAuditLog(client, {
              staffId,
              action: 'ASSIGN',
              entityType: 'locker',
              entityId: resourceId,
              oldValue: { assigned_to_customer_id: null },
              newValue: { selected_for_session_id: session.id },
            });

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
        const { payload } = await transaction((client) =>
          buildFullSessionUpdatedPayload(client, result.sessionId)
        );
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
                  requestedRoomId:
                    request.body.resourceType === 'room' ? request.body.resourceId : undefined,
                  requestedLockerId:
                    request.body.resourceType === 'locker' ? request.body.resourceId : undefined,
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
    }
  );

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

          // Calculate price quote
          const pricingInput: PricingInput = {
            rentalType,
            customerAge,
            checkInTime: new Date(),
            membershipCardType,
            membershipValidUntil,
            includeSixMonthMembershipPurchase: !!session.membership_purchase_intent,
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
    }
  );

  /**
   * POST /v1/checkin/lane/:laneId/sign-agreement
   *
   * Store agreement signature, generate PDF, auto-assign resource, and create check-in block.
   * Public endpoint (customer kiosk can call without auth).
   */
  fastify.post<{
    Params: { laneId: string };
    Body: { signaturePayload: string; sessionId?: string };
  }>(
    '/v1/checkin/lane/:laneId/sign-agreement',
    {
      preHandler: [optionalAuth, requireKioskTokenOrStaff],
    },
    async (request, reply) => {
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
            throw {
              statusCode: 400,
              message: 'Agreement signing is only required for INITIAL and RENEWAL check-ins',
            };
          }

          // Demo flow: require the rental selection to be confirmed/locked before payment+signature
          if (!session.selection_confirmed || !session.selection_locked_at) {
            throw {
              statusCode: 400,
              message: 'Selection must be confirmed/locked before signing agreement',
            };
          }

          // Check payment is paid
          if (!session.payment_intent_id) {
            throw {
              statusCode: 400,
              message: 'Payment intent must be created before signing agreement',
            };
          }

          const intentResult = await client.query<PaymentIntentRow>(
            `SELECT status FROM payment_intents WHERE id = $1`,
            [session.payment_intent_id]
          );
          if (intentResult.rows.length === 0 || intentResult.rows[0]!.status !== 'PAID') {
            throw {
              statusCode: 400,
              message: 'Payment must be marked as paid before signing agreement',
            };
          }

          // Get customer identity info for PDF + signature snapshot
          const customerResult = session.customer_id
            ? await client.query<{
                name: string;
                dob: Date | string | null;
                membership_number: string | null;
                primary_language: string | null;
              }>(`SELECT name, dob, membership_number, primary_language FROM customers WHERE id = $1`, [
                session.customer_id,
              ])
            : { rows: [] as Array<{ name: string; dob: Date | string | null; membership_number: string | null; primary_language: string | null }> };

          const customerName = customerResult.rows[0]?.name || session.customer_display_name || 'Customer';
          const customerDob = customerResult.rows[0]?.dob ?? null;
          const membershipNumber = customerResult.rows[0]?.membership_number || session.membership_number || undefined;
          const customerLang = customerResult.rows[0]?.primary_language === 'ES' ? 'ES' : 'EN';

          // Get active agreement text
          const agreementResult = await client.query<{
            id: string;
            body_text: string;
            version: string;
            title: string;
          }>(
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
          const checkinAt = signedAt; // demo flow uses "now" for check-in start; keep PDF consistent with stored block.starts_at

          const agreementTextSnapshot =
            customerLang === 'ES' ? AGREEMENT_LEGAL_BODY_HTML_BY_LANG.ES : agreement.body_text;
          const agreementTitleForPdf = customerLang === 'ES' ? 'Acuerdo del Club' : agreement.title;

          // Generate PDF (robust pdf-lib)
          let pdfBuffer: Buffer;
          try {
            pdfBuffer = await generateAgreementPdf({
              agreementTitle: agreementTitleForPdf,
              agreementVersion: agreement.version,
              agreementText: agreementTextSnapshot,
              customerName,
              customerDob,
              membershipNumber,
              checkinAt,
              signedAt,
              signatureImageBase64: signatureData,
            });
          } catch (e) {
            request.log.warn(
              { err: e },
              'Failed to generate agreement PDF from provided signature'
            );
            throw {
              statusCode: 400,
              message: 'Invalid signature image (expected PNG data URL or base64)',
            };
          }

          // Determine rental type from locked selection snapshot
          const rentalType = (session.desired_rental_type ||
            session.backup_rental_type ||
            'LOCKER') as 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL' | 'GYM_LOCKER';

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
                throw {
                  statusCode: 409,
                  message: `Selected room ${room.number} is no longer available`,
                };
              }
              // Ensure another active lane session did not also "select" this room.
              const selectedByOther = await client.query<{ id: string; lane_id: string }>(
                `SELECT id, lane_id
                 FROM lane_sessions
                 WHERE id <> $1
                   AND assigned_resource_type = 'room'
                   AND assigned_resource_id = $2
                   AND status = ANY (
                     ARRAY[
                       'ACTIVE'::public.lane_session_status,
                       'AWAITING_CUSTOMER'::public.lane_session_status,
                       'AWAITING_ASSIGNMENT'::public.lane_session_status,
                       'AWAITING_PAYMENT'::public.lane_session_status,
                       'AWAITING_SIGNATURE'::public.lane_session_status
                     ]
                   )
                 LIMIT 1`,
                [session.id, assignedResourceId]
              );
              if (selectedByOther.rows.length > 0) {
                throw {
                  statusCode: 409,
                  message: `Selected room ${room.number} is reserved by another lane session`,
                };
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
                throw {
                  statusCode: 409,
                  message: `Selected locker ${locker.number} is no longer available`,
                };
              }
              // Ensure another active lane session did not also "select" this locker.
              const selectedByOther = await client.query<{ id: string; lane_id: string }>(
                `SELECT id, lane_id
                 FROM lane_sessions
                 WHERE id <> $1
                   AND assigned_resource_type = 'locker'
                   AND assigned_resource_id = $2
                   AND status = ANY (
                     ARRAY[
                       'ACTIVE'::public.lane_session_status,
                       'AWAITING_CUSTOMER'::public.lane_session_status,
                       'AWAITING_ASSIGNMENT'::public.lane_session_status,
                       'AWAITING_PAYMENT'::public.lane_session_status,
                       'AWAITING_SIGNATURE'::public.lane_session_status
                     ]
                   )
                 LIMIT 1`,
                [session.id, assignedResourceId]
              );
              if (selectedByOther.rows.length > 0) {
                throw {
                  statusCode: 409,
                  message: `Selected locker ${locker.number} is reserved by another lane session`,
                };
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
                 -- Exclude lockers "selected" by an active lane session (reservation semantics).
                 AND NOT EXISTS (
                   SELECT 1
                   FROM lane_sessions ls
                   WHERE ls.assigned_resource_type = 'locker'
                     AND ls.assigned_resource_id = lockers.id
                     AND ls.status = ANY (
                       ARRAY[
                         'ACTIVE'::public.lane_session_status,
                         'AWAITING_CUSTOMER'::public.lane_session_status,
                         'AWAITING_ASSIGNMENT'::public.lane_session_status,
                         'AWAITING_PAYMENT'::public.lane_session_status,
                         'AWAITING_SIGNATURE'::public.lane_session_status
                       ]
                     )
                 )
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
              const room = await selectRoomForNewCheckin(client, rentalType as RoomRentalType);
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

          const startsAt = checkinAt; // demo: now (consistent with PDF)
          const endsAt = roundUpToQuarterHour(new Date(startsAt.getTime() + 6 * 60 * 60 * 1000));

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

          // If customer elected a waitlist/upgrade path (desired tier + backup tier), persist waitlist entry now.
          if (session.waitlist_desired_type && session.backup_rental_type) {
            const waitlistResult = await client.query<{ id: string }>(
              `INSERT INTO waitlist
               (visit_id, checkin_block_id, desired_tier, backup_tier, locker_or_room_assigned_initially, status)
               VALUES ($1, $2, $3, $4, $5, 'ACTIVE')
               RETURNING id`,
              [
                visitId,
                checkinBlockId,
                session.waitlist_desired_type,
                session.backup_rental_type,
                assignedResourceId,
              ]
            );
            const waitlistId = waitlistResult.rows[0]!.id;

            await client.query(`UPDATE checkin_blocks SET waitlist_id = $1 WHERE id = $2`, [
              waitlistId,
              checkinBlockId,
            ]);

            // Broadcast waitlist update (employee register will refetch list)
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

          // Part A: server-side assertion (same TX) that assignment persisted and the resource
          // cannot qualify as "available" immediately after successful check-in creation.
          await assertAssignedResourcePersistedAndUnavailable({
            client,
            sessionId: session.id,
            customerId: session.customer_id,
            resourceType: assignedResourceType === 'room' ? 'room' : 'locker',
            resourceId: assignedResourceId,
            resourceNumber: assignedResourceNumber,
          });

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
              agreementTextSnapshot,
              agreement.version,
              request.headers['user-agent'] || null,
              request.ip || null,
            ]
          );

          // Auto-archive system late-fee notes after they have been shown on the next visit.
          // Manual notes (staff-entered) must persist and are never auto-archived.
          if (session.customer_id) {
            const notesRes = await client.query<{ notes: string | null }>(
              `SELECT notes FROM customers WHERE id = $1 LIMIT 1`,
              [session.customer_id]
            );
            const existing = notesRes.rows[0]?.notes ?? null;
            const cleaned = stripSystemLateFeeNotes(existing);
            if (cleaned !== existing) {
              await client.query(`UPDATE customers SET notes = $1, updated_at = NOW() WHERE id = $2`, [
                cleaned,
                session.customer_id,
              ]);
            }
          }

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

        const { payload } = await transaction((client) =>
          buildFullSessionUpdatedPayload(client, result.sessionId)
        );
        fastify.broadcaster.broadcastSessionUpdated(payload, laneId);
        await broadcastInventoryUpdate(fastify.broadcaster);

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
    }
  );

  /**
   * POST /v1/checkin/lane/:laneId/manual-signature-override
   *
   * Employee override to complete agreement signing without customer signature.
   * Requires authentication. Generates PDF with "Manual Signature Override" text.
   */
  fastify.post<{
    Params: { laneId: string };
    Body: { sessionId?: string };
  }>(
    '/v1/checkin/lane/:laneId/manual-signature-override',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
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
            throw {
              statusCode: 400,
              message: 'Agreement signing is only required for INITIAL and RENEWAL check-ins',
            };
          }

          // Demo flow: require the rental selection to be confirmed/locked before payment+signature
          if (!session.selection_confirmed || !session.selection_locked_at) {
            throw {
              statusCode: 400,
              message: 'Selection must be confirmed/locked before signing agreement',
            };
          }

          // Check payment is paid
          if (!session.payment_intent_id) {
            throw {
              statusCode: 400,
              message: 'Payment intent must be created before signing agreement',
            };
          }

          const intentResult = await client.query<PaymentIntentRow>(
            `SELECT status FROM payment_intents WHERE id = $1`,
            [session.payment_intent_id]
          );
          if (intentResult.rows.length === 0 || intentResult.rows[0]!.status !== 'PAID') {
            throw {
              statusCode: 400,
              message: 'Payment must be marked as paid before signing agreement',
            };
          }

          // Get customer identity info for PDF + signature snapshot
          const customerResult = session.customer_id
            ? await client.query<{
                name: string;
                dob: Date | string | null;
                membership_number: string | null;
                primary_language: string | null;
              }>(`SELECT name, dob, membership_number, primary_language FROM customers WHERE id = $1`, [
                session.customer_id,
              ])
            : { rows: [] as Array<{ name: string; dob: Date | string | null; membership_number: string | null; primary_language: string | null }> };

          const customerName = customerResult.rows[0]?.name || session.customer_display_name || 'Customer';
          const customerDob = customerResult.rows[0]?.dob ?? null;
          const membershipNumber = customerResult.rows[0]?.membership_number || session.membership_number || undefined;
          const customerLang = customerResult.rows[0]?.primary_language === 'ES' ? 'ES' : 'EN';

          // Get active agreement text
          const agreementResult = await client.query<{
            id: string;
            body_text: string;
            version: string;
            title: string;
          }>(
            `SELECT id, body_text, version, title FROM agreements WHERE active = true ORDER BY created_at DESC LIMIT 1`
          );

          if (agreementResult.rows.length === 0) {
            throw { statusCode: 404, message: 'No active agreement found' };
          }

          const agreement = agreementResult.rows[0]!;

          const signedAt = new Date();
          const checkinAt = signedAt;

          const agreementTextSnapshot =
            customerLang === 'ES' ? AGREEMENT_LEGAL_BODY_HTML_BY_LANG.ES : agreement.body_text;
          const agreementTitleForPdf = customerLang === 'ES' ? 'Acuerdo del Club' : agreement.title;

          // Generate PDF with override text instead of signature image
          let pdfBuffer: Buffer;
          try {
            pdfBuffer = await generateAgreementPdf({
              agreementTitle: agreementTitleForPdf,
              agreementVersion: agreement.version,
              agreementText: agreementTextSnapshot,
              customerName,
              customerDob,
              membershipNumber,
              checkinAt,
              signatureText: 'Manual Signature Override',
              signedAt,
            });
          } catch (e) {
            request.log.warn({ err: e }, 'Failed to generate agreement PDF for manual override');
            throw { statusCode: 500, message: 'Failed to generate agreement PDF' };
          }

          // Determine rental type from locked selection snapshot
          const rentalType = (session.desired_rental_type ||
            session.backup_rental_type ||
            'LOCKER') as 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL' | 'GYM_LOCKER';

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
                throw {
                  statusCode: 409,
                  message: `Selected room ${room.number} is no longer available`,
                };
              }
              // Ensure another active lane session did not also "select" this room.
              const selectedByOther = await client.query<{ id: string; lane_id: string }>(
                `SELECT id, lane_id
                 FROM lane_sessions
                 WHERE id <> $1
                   AND assigned_resource_type = 'room'
                   AND assigned_resource_id = $2
                   AND status = ANY (
                     ARRAY[
                       'ACTIVE'::public.lane_session_status,
                       'AWAITING_CUSTOMER'::public.lane_session_status,
                       'AWAITING_ASSIGNMENT'::public.lane_session_status,
                       'AWAITING_PAYMENT'::public.lane_session_status,
                       'AWAITING_SIGNATURE'::public.lane_session_status
                     ]
                   )
                 LIMIT 1`,
                [session.id, assignedResourceId]
              );
              if (selectedByOther.rows.length > 0) {
                throw {
                  statusCode: 409,
                  message: `Selected room ${room.number} is reserved by another lane session`,
                };
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
                throw {
                  statusCode: 409,
                  message: `Selected locker ${locker.number} is no longer available`,
                };
              }
              // Ensure another active lane session did not also "select" this locker.
              const selectedByOther = await client.query<{ id: string; lane_id: string }>(
                `SELECT id, lane_id
                 FROM lane_sessions
                 WHERE id <> $1
                   AND assigned_resource_type = 'locker'
                   AND assigned_resource_id = $2
                   AND status = ANY (
                     ARRAY[
                       'ACTIVE'::public.lane_session_status,
                       'AWAITING_CUSTOMER'::public.lane_session_status,
                       'AWAITING_ASSIGNMENT'::public.lane_session_status,
                       'AWAITING_PAYMENT'::public.lane_session_status,
                       'AWAITING_SIGNATURE'::public.lane_session_status
                     ]
                   )
                 LIMIT 1`,
                [session.id, assignedResourceId]
              );
              if (selectedByOther.rows.length > 0) {
                throw {
                  statusCode: 409,
                  message: `Selected locker ${locker.number} is reserved by another lane session`,
                };
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
                 -- Exclude lockers "selected" by an active lane session (reservation semantics).
                 AND NOT EXISTS (
                   SELECT 1
                   FROM lane_sessions ls
                   WHERE ls.assigned_resource_type = 'locker'
                     AND ls.assigned_resource_id = lockers.id
                     AND ls.status = ANY (
                       ARRAY[
                         'ACTIVE'::public.lane_session_status,
                         'AWAITING_CUSTOMER'::public.lane_session_status,
                         'AWAITING_ASSIGNMENT'::public.lane_session_status,
                         'AWAITING_PAYMENT'::public.lane_session_status,
                         'AWAITING_SIGNATURE'::public.lane_session_status
                       ]
                     )
                 )
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
              const room = await selectRoomForNewCheckin(client, rentalType as RoomRentalType);
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

          const checkoutAt = roundUpToQuarterHour(new Date(signedAt.getTime() + 6 * 60 * 60 * 1000));

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

          // If customer elected a waitlist/upgrade path (desired tier + backup tier), persist waitlist entry now.
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
                assignedResourceId,
              ]
            );
            const waitlistId = waitlistResult.rows[0]!.id;

            await client.query(`UPDATE checkin_blocks SET waitlist_id = $1 WHERE id = $2`, [
              waitlistId,
              blockId,
            ]);

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

          // Part A: server-side assertion (same TX) that assignment persisted and the resource
          // cannot qualify as "available" immediately after successful check-in creation.
          await assertAssignedResourcePersistedAndUnavailable({
            client,
            sessionId: session.id,
            customerId: session.customer_id,
            resourceType: assignedResourceType === 'room' ? 'room' : 'locker',
            resourceId: assignedResourceId,
            resourceNumber: assignedResourceNumber,
          });

          // Update lane session status to COMPLETED
          await client.query(
            `UPDATE lane_sessions
           SET status = 'COMPLETED',
               updated_at = NOW()
           WHERE id = $1`,
            [session.id]
          );

          // Log audit entry for manual override
          await insertAuditLog(client, {
            staffId: request.staff?.staffId ?? null,
            action: 'OVERRIDE',
            entityType: 'checkin_block',
            entityId: blockId,
            metadata: {
              overrideType: 'MANUAL_SIGNATURE_OVERRIDE',
              sessionId: session.id,
              laneId,
              customerId: session.customer_id,
              customerName,
              rentalType,
              assignedResourceType,
              assignedResourceNumber,
            },
          });

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
        await broadcastInventoryUpdate(fastify.broadcaster);

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
    }
  );

  /**
   * POST /v1/checkin/lane/:laneId/customer-confirm
   *
   * Customer confirms or declines cross-type assignment.
   */
  fastify.post<{
    Params: { laneId: string };
    Body: { sessionId: string; confirmed: boolean };
  }>(
    '/v1/checkin/lane/:laneId/customer-confirm',
    { preHandler: [optionalAuth, requireKioskTokenOrStaff] },
    async (request, reply) => {
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
          // Customer confirmed - broadcast confirmation.
          //
          // IMPORTANT: assigned_resource_id is a UUID. The customer-confirm event payload expects
          // a human-facing type+number (room tier + room number, or locker number). Do NOT derive
          // tier/number from the UUID.
          if (!session.assigned_resource_type || !session.assigned_resource_id) {
            throw { statusCode: 400, message: 'No assigned resource to confirm' };
          }

          let confirmedType: string;
          let confirmedNumber: string;

          if (session.assigned_resource_type === 'room') {
            const roomRes = await client.query<{ number: string }>(
              `SELECT number FROM rooms WHERE id = $1 LIMIT 1`,
              [session.assigned_resource_id]
            );
            if (roomRes.rows.length === 0) {
              throw { statusCode: 404, message: 'Assigned room not found' };
            }
            confirmedNumber = roomRes.rows[0]!.number;
            confirmedType = getRoomTier(confirmedNumber);
          } else if (session.assigned_resource_type === 'locker') {
            const lockerRes = await client.query<{ number: string }>(
              `SELECT number FROM lockers WHERE id = $1 LIMIT 1`,
              [session.assigned_resource_id]
            );
            if (lockerRes.rows.length === 0) {
              throw { statusCode: 404, message: 'Assigned locker not found' };
            }
            confirmedNumber = lockerRes.rows[0]!.number;
            confirmedType = 'LOCKER';
          } else {
            throw { statusCode: 400, message: 'Invalid assigned resource type' };
          }

          const confirmedPayload: CustomerConfirmedPayload = {
            sessionId: session.id,
            confirmedType,
            confirmedNumber,
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
    }
  );

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
    const rentalType = (session.desired_rental_type ||
      session.backup_rental_type ||
      'LOCKER') as string;

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
        throw new Error(
          `Renewal would exceed 14-hour maximum. Current total: ${currentTotalHours} hours, renewal would add 6 hours.`
        );
      }

      // Renewal extends from previous checkout time, not from now
      const latestBlockEnd = blocksResult.rows[0]!.ends_at;
      startsAt = latestBlockEnd;
      endsAt = roundUpToQuarterHour(new Date(startsAt.getTime() + 6 * 60 * 60 * 1000)); // 6 hours from previous checkout, rounded up
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
      endsAt = roundUpToQuarterHour(new Date(startsAt.getTime() + 6 * 60 * 60 * 1000));
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

    // Transition room/locker to OCCUPIED status + persist assignment (server-authoritative)
    if (session.assigned_resource_type === 'room') {
      await client.query(
        `UPDATE rooms 
         SET status = 'OCCUPIED',
             assigned_to_customer_id = $1,
             last_status_change = NOW(),
             updated_at = NOW()
         WHERE id = $2`,
        [session.customer_id, session.assigned_resource_id]
      );
    } else if (session.assigned_resource_type === 'locker') {
      await client.query(
        `UPDATE lockers 
         SET status = 'OCCUPIED',
             assigned_to_customer_id = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [session.customer_id, session.assigned_resource_id]
      );
    }

    // Update session status
    await client.query(
      `UPDATE lane_sessions SET status = 'COMPLETED', updated_at = NOW() WHERE id = $1`,
      [session.id]
    );

    // Log audit (only if staffId is a valid UUID)
    if (
      staffId &&
      staffId !== 'system' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(staffId)
    ) {
      await insertAuditLog(client, {
        staffId,
        action: 'CHECK_IN',
        entityType: 'visit',
        entityId: visitId,
        oldValue: {},
        newValue: {
          visit_id: visitId,
          block_id: blockId,
          resource_type: session.assigned_resource_type,
        },
      });
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
      await client.query(`UPDATE checkin_blocks SET waitlist_id = $1 WHERE id = $2`, [
        waitlistId,
        blockId,
      ]);

      // Log waitlist created (include desired+backup and the assigned resource number for debugging)
      if (
        staffId &&
        staffId !== 'system' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(staffId)
      ) {
        let assignedResourceNumber: string | null = null;
        if (session.assigned_resource_type === 'room') {
          const r = await client.query<{ number: string }>(`SELECT number FROM rooms WHERE id = $1`, [
            session.assigned_resource_id,
          ]);
          assignedResourceNumber = r.rows[0]?.number ?? null;
        } else if (session.assigned_resource_type === 'locker') {
          const l = await client.query<{ number: string }>(`SELECT number FROM lockers WHERE id = $1`, [
            session.assigned_resource_id,
          ]);
          assignedResourceNumber = l.rows[0]?.number ?? null;
        }

        await insertAuditLog(client, {
          staffId,
          action: 'WAITLIST_CREATED',
          entityType: 'waitlist',
          entityId: waitlistId,
          oldValue: {},
          newValue: {
            visit_id: visitId,
            checkin_block_id: blockId,
            desired_tier: session.waitlist_desired_type,
            backup_tier: session.backup_rental_type,
            initial_resource_id: session.assigned_resource_id,
            initial_resource_number: assignedResourceNumber,
          },
        });
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
  fastify.get(
    '/v1/checkin/lane-sessions',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
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

        const sessions = result.rows.map((session) => ({
          id: session.id,
          laneId: session.lane_id,
          status: session.status,
          staffName: (session as any).staff_name,
          customerName: session.customer_display_name || (session as any).customer_name,
          membershipNumber: session.membership_number,
          desiredRentalType: session.desired_rental_type,
          waitlistDesiredType: session.waitlist_desired_type,
          backupRentalType: session.backup_rental_type,
          assignedResource: session.assigned_resource_id
            ? {
                id: session.assigned_resource_id,
                number: (session as any).room_number || (session as any).locker_number,
                type: session.desired_rental_type,
              }
            : null,
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
    }
  );

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
  }>(
    '/v1/checkin/lane/:laneId/past-due/demo-payment',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
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

        const { payload } = await transaction((client) =>
          buildFullSessionUpdatedPayload(client, result.sessionId)
        );
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
    }
  );

  /**
   * POST /v1/checkin/lane/:laneId/past-due/bypass
   *
   * Bypass past-due balance check (requires admin PIN).
   */
  fastify.post<{
    Params: { laneId: string };
    Body: { managerId: string; managerPin: string };
  }>(
    '/v1/checkin/lane/:laneId/past-due/bypass',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
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
          const managerResult = await client.query<{
            id: string;
            role: string;
            pin_hash: string | null;
          }>(`SELECT id, role, pin_hash FROM staff WHERE id = $1 AND active = true`, [managerId]);

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

        const { payload } = await transaction((client) =>
          buildFullSessionUpdatedPayload(client, result.sessionId)
        );
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
    }
  );

  /**
   * POST /v1/checkin/lane/:laneId/set-language
   *
   * Set customer's primary language preference (EN or ES).
   * Persists on customer record.
   */
  async function setLanguageForLaneSession(params: {
    laneId: string;
    language: 'EN' | 'ES';
    sessionId?: string;
    customerName?: string;
  }): Promise<{ sessionId: string; success: true; language: 'EN' | 'ES'; laneId: string }> {
    const { laneId, language, sessionId, customerName } = params;
    const result = await transaction(async (client) => {
      // Prefer explicit sessionId, but fall back if it doesn't resolve (clients can get out of sync).
      let sessionResult: { rows: LaneSessionRow[] };
      if (sessionId) {
        sessionResult = await client.query<LaneSessionRow>(
          `SELECT * FROM lane_sessions WHERE id = $1 LIMIT 1`,
          [sessionId]
        );
        if (sessionResult.rows.length === 0 && customerName) {
          sessionResult = await client.query<LaneSessionRow>(
            `SELECT * FROM lane_sessions
             WHERE lane_id = $1
               AND customer_display_name = $2
               AND status != 'COMPLETED'
               AND status != 'CANCELLED'
             ORDER BY created_at DESC
             LIMIT 1`,
            [laneId, customerName]
          );
        }
      } else {
        sessionResult = await client.query<LaneSessionRow>(
          `SELECT * FROM lane_sessions
           WHERE lane_id = $1 AND status IN ('ACTIVE', 'AWAITING_CUSTOMER', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE')
           ORDER BY created_at DESC
           LIMIT 1`,
          [laneId]
        );
      }

      if (sessionResult.rows.length === 0) {
        throw { statusCode: 404, message: 'No active session found' };
      }

      const session = sessionResult.rows[0]!;
      const resolvedLaneId = session.lane_id || laneId;

      if (session.status === 'COMPLETED' || session.status === 'CANCELLED') {
        throw { statusCode: 404, message: 'No active session found' };
      }

      if (!session.customer_id) {
        throw { statusCode: 400, message: 'Session has no customer' };
      }

      await client.query(
        `UPDATE customers SET primary_language = $1, updated_at = NOW() WHERE id = $2`,
        [language, session.customer_id]
      );

      return { sessionId: session.id, success: true as const, language, laneId: resolvedLaneId };
    });

    const { payload } = await transaction((client) =>
      buildFullSessionUpdatedPayload(client, result.sessionId)
    );
    fastify.broadcaster.broadcastSessionUpdated(payload, result.laneId || laneId);

    return result;
  }

  fastify.post<{
    Params: { laneId: string };
    Body: { language: 'EN' | 'ES'; sessionId?: string; customerName?: string };
  }>(
    '/v1/checkin/lane/:laneId/set-language',
    { preHandler: [optionalAuth, requireKioskTokenOrStaff] },
    async (request, reply) => {
    const { laneId } = request.params;
    const { language, sessionId, customerName } = request.body;

    try {
      const result = await setLanguageForLaneSession({ laneId, language, sessionId, customerName });

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
    }
  );

  /**
   * POST /v1/checkin/lane/:laneId/membership-purchase-intent
   *
   * Customer kiosk requests a 6-month membership purchase/renewal to be included in the payment quote.
   * This is server-authoritative state (stored on lane_sessions) so it survives refresh/reconnect.
   *
   * If a DUE payment intent already exists for the session (and selection is confirmed), the quote is
   * recomputed immediately and the payment intent updated.
   *
   * Security: optionalAuth (kiosk does not have staff token).
   */
  fastify.post<{
    Params: { laneId: string };
    Body: { intent: 'PURCHASE' | 'RENEW' | 'NONE'; sessionId?: string };
  }>(
    '/v1/checkin/lane/:laneId/membership-purchase-intent',
    {
      preHandler: [optionalAuth, requireKioskTokenOrStaff],
    },
    async (request, reply) => {
      const { laneId } = request.params;
      const bodySchema = z.object({
        intent: z.enum(['PURCHASE', 'RENEW', 'NONE']),
        sessionId: z.string().uuid().optional(),
      });
      const parsed = bodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid request body' });
      }
      const { intent, sessionId } = parsed.data;

      try {
        const result = await transaction(async (client) => {
          // Prefer explicit sessionId, else latest active session for lane.
          const sessionResult = sessionId
            ? await client.query<LaneSessionRow>(`SELECT * FROM lane_sessions WHERE id = $1 LIMIT 1`, [
                sessionId,
              ])
            : await client.query<LaneSessionRow>(
                `SELECT * FROM lane_sessions
                 WHERE lane_id = $1
                   AND status IN ('ACTIVE', 'AWAITING_CUSTOMER', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE')
                 ORDER BY created_at DESC
                 LIMIT 1`,
                [laneId]
              );

          if (sessionResult.rows.length === 0) {
            throw { statusCode: 404, message: 'No active session found' };
          }

          const session = sessionResult.rows[0]!;
          const resolvedLaneId = session.lane_id || laneId;

          if (!session.customer_id) {
            throw { statusCode: 400, message: 'Session has no customer' };
          }

          // Persist membership purchase intent on lane session.
          const intentValue: 'PURCHASE' | 'RENEW' | null = intent === 'NONE' ? null : intent;
          const requestedAt = intent === 'NONE' ? null : new Date();
          const updatedSession = (
            await client.query<LaneSessionRow>(
              `UPDATE lane_sessions
               SET membership_purchase_intent = $1,
                   membership_purchase_requested_at = $2,
                   updated_at = NOW()
               WHERE id = $3
               RETURNING *`,
              [intentValue, requestedAt, session.id]
            )
          ).rows[0]!;

          // If we already have a DUE payment intent and selection is confirmed, update quote immediately.
          if (updatedSession.payment_intent_id && updatedSession.selection_confirmed) {
            const intentResult = await client.query<PaymentIntentRow>(
              `SELECT * FROM payment_intents WHERE id = $1 LIMIT 1`,
              [updatedSession.payment_intent_id]
            );
            const pi = intentResult.rows[0];
            if (pi && pi.status === 'DUE') {
              // Get customer info for pricing
              const customerResult = await client.query<CustomerRow>(
                `SELECT dob, membership_card_type, membership_valid_until FROM customers WHERE id = $1`,
                [updatedSession.customer_id]
              );
              const customer = customerResult.rows[0];
              const customerAge = customer ? calculateAge(customer.dob) : undefined;
              const membershipCardType =
                customer?.membership_card_type
                  ? ((customer.membership_card_type as 'NONE' | 'SIX_MONTH') || undefined)
                  : undefined;
              const membershipValidUntil = toDate(customer?.membership_valid_until) || undefined;

              const rentalType = (updatedSession.desired_rental_type ||
                updatedSession.backup_rental_type ||
                'LOCKER') as 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL' | 'GYM_LOCKER';

              const pricingInput: PricingInput = {
                rentalType,
                customerAge,
                checkInTime: new Date(),
                membershipCardType,
                membershipValidUntil,
                includeSixMonthMembershipPurchase: intent !== 'NONE',
              };

              const quote = calculatePriceQuote(pricingInput);

              await client.query(
                `UPDATE payment_intents
                 SET amount = $1,
                     quote_json = $2,
                     updated_at = NOW()
                 WHERE id = $3`,
                [quote.total, JSON.stringify(quote), pi.id]
              );

              await client.query(
                `UPDATE lane_sessions
                 SET price_quote_json = $1,
                     updated_at = NOW()
                 WHERE id = $2`,
                [JSON.stringify(quote), updatedSession.id]
              );
            }
          }

          return { sessionId: updatedSession.id, laneId: resolvedLaneId };
        });

        const { payload } = await transaction((client) =>
          buildFullSessionUpdatedPayload(client, result.sessionId)
        );
        fastify.broadcaster.broadcastSessionUpdated(payload, result.laneId || laneId);

        return reply.send({ success: true });
      } catch (error: unknown) {
        request.log.error(error, 'Failed to set membership purchase intent');
        const httpErr = getHttpError(error);
        if (httpErr) {
          return reply.status(httpErr.statusCode).send({
            error: httpErr.message ?? 'Failed to set membership purchase intent',
          });
        }
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to set membership purchase intent',
        });
      }
    }
  );

  /**
   * POST /v1/checkin/lane/:laneId/highlight-option
   *
   * Ephemeral (non-persisted) kiosk UI highlight for employee "pending" selections
   * during the LANGUAGE and MEMBERSHIP steps.
   *
   * Security: requireAuth (staff only).
   */
  fastify.post<{
    Params: { laneId: string };
    Body: { step: 'LANGUAGE' | 'MEMBERSHIP'; option: string | null; sessionId?: string };
  }>(
    '/v1/checkin/lane/:laneId/highlight-option',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
      const { laneId } = request.params;

      const bodySchema = z.object({
        step: z.enum(['LANGUAGE', 'MEMBERSHIP']),
        option: z.string().min(1).nullable(),
        sessionId: z.string().uuid().optional(),
      });
      const parsed = bodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid request body' });
      }
      const { step, option, sessionId } = parsed.data;

      try {
        const resolved = await transaction(async (client) => {
          const sessionResult = sessionId
            ? await client.query<LaneSessionRow>(`SELECT * FROM lane_sessions WHERE id = $1 LIMIT 1`, [
                sessionId,
              ])
            : await client.query<LaneSessionRow>(
                `SELECT * FROM lane_sessions
                 WHERE lane_id = $1
                   AND status IN ('ACTIVE', 'AWAITING_CUSTOMER', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE')
                 ORDER BY created_at DESC
                 LIMIT 1`,
                [laneId]
              );

          if (sessionResult.rows.length === 0) {
            throw { statusCode: 404, message: 'No active session found' };
          }

          const session = sessionResult.rows[0]!;
          return { laneId: session.lane_id || laneId, sessionId: session.id };
        });

        const payload: CheckinOptionHighlightedPayload = {
          sessionId: resolved.sessionId,
          step,
          option,
          by: 'EMPLOYEE',
        };

        fastify.broadcaster.broadcastToLane(
          { type: 'CHECKIN_OPTION_HIGHLIGHTED', payload, timestamp: new Date().toISOString() },
          resolved.laneId
        );

        return reply.send({ success: true });
      } catch (error: unknown) {
        request.log.error(error, 'Failed to highlight option');
        const httpErr = getHttpError(error);
        if (httpErr) {
          return reply.status(httpErr.statusCode).send({
            error: httpErr.message ?? 'Failed to highlight option',
          });
        }
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to highlight option',
        });
      }
    }
  );

  /**
   * POST /v1/checkin/lane/:laneId/membership-choice
   *
   * Persist the kiosk "membership step" choice (ONE_TIME vs SIX_MONTH) on the lane session
   * so employee-register can mirror the kiosk step-by-step reliably.
   *
   * Security: optionalAuth (kiosk does not have staff token).
   *
   * Notes:
   * - This does NOT change pricing logic directly.
   * - SIX_MONTH is usually set automatically via /membership-purchase-intent.
   */
  fastify.post<{
    Params: { laneId: string };
    Body: { choice: 'ONE_TIME' | 'NONE' | 'SIX_MONTH'; sessionId?: string };
  }>(
    '/v1/checkin/lane/:laneId/membership-choice',
    { preHandler: [optionalAuth, requireKioskTokenOrStaff] },
    async (request, reply) => {
      const { laneId } = request.params;
      const bodySchema = z.object({
        choice: z.enum(['ONE_TIME', 'SIX_MONTH', 'NONE']),
        sessionId: z.string().uuid().optional(),
      });
      const parsed = bodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid request body' });
      }
      const { choice, sessionId } = parsed.data;

      try {
        const result = await transaction(async (client) => {
          const sessionResult = sessionId
            ? await client.query<LaneSessionRow>(`SELECT * FROM lane_sessions WHERE id = $1 LIMIT 1`, [
                sessionId,
              ])
            : await client.query<LaneSessionRow>(
                `SELECT * FROM lane_sessions
                 WHERE lane_id = $1
                   AND status IN ('ACTIVE', 'AWAITING_CUSTOMER', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE')
                 ORDER BY created_at DESC
                 LIMIT 1`,
                [laneId]
              );

          if (sessionResult.rows.length === 0) {
            throw { statusCode: 404, message: 'No active session found' };
          }

          const session = sessionResult.rows[0]!;
          const resolvedLaneId = session.lane_id || laneId;

          const value: 'ONE_TIME' | 'SIX_MONTH' | null =
            choice === 'NONE' ? null : (choice as 'ONE_TIME' | 'SIX_MONTH');

          await client.query(
            `UPDATE lane_sessions
             SET membership_choice = $1,
                 updated_at = NOW()
             WHERE id = $2`,
            [value, session.id]
          );

          return { sessionId: session.id, laneId: resolvedLaneId };
        });

        const { payload } = await transaction((client) =>
          buildFullSessionUpdatedPayload(client, result.sessionId)
        );
        fastify.broadcaster.broadcastSessionUpdated(payload, result.laneId || laneId);

        return reply.send({ success: true });
      } catch (error: unknown) {
        request.log.error(error, 'Failed to set membership choice');
        const httpErr = getHttpError(error);
        if (httpErr) {
          return reply.status(httpErr.statusCode).send({
            error: httpErr.message ?? 'Failed to set membership choice',
          });
        }
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to set membership choice',
        });
      }
    }
  );

  /**
   * POST /v1/checkin/lane/:laneId/complete-membership-purchase
   *
   * After payment is accepted (Square marked paid) for a quote that includes a 6-month membership,
   * staff must enter the physical membership number. This endpoint persists the membership number
   * and sets membership expiration to purchase date + 6 months, then clears the lane session's
   * pending membership purchase intent.
   *
   * Security: requireAuth (staff only).
   */
  fastify.post<{
    Params: { laneId: string };
    Body: { sessionId?: string; membershipNumber: string };
  }>(
    '/v1/checkin/lane/:laneId/complete-membership-purchase',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
      const { laneId } = request.params;

      const bodySchema = z.object({
        sessionId: z.string().uuid().optional(),
        membershipNumber: z.string().min(1),
      });
      const parsed = bodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid request body' });
      }

      const { sessionId, membershipNumber } = parsed.data;

      try {
        const result = await transaction(async (client) => {
          // Prefer explicit sessionId, else latest active session for lane.
          const sessionResult = sessionId
            ? await client.query<LaneSessionRow>(`SELECT * FROM lane_sessions WHERE id = $1 LIMIT 1`, [
                sessionId,
              ])
            : await client.query<LaneSessionRow>(
                `SELECT * FROM lane_sessions
                 WHERE lane_id = $1
                   AND status IN ('ACTIVE', 'AWAITING_CUSTOMER', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE')
                 ORDER BY created_at DESC
                 LIMIT 1`,
                [laneId]
              );

          if (sessionResult.rows.length === 0) {
            throw { statusCode: 404, message: 'No active session found' };
          }

          const session = sessionResult.rows[0]!;
          const resolvedLaneId = session.lane_id || laneId;

          if (!session.customer_id) {
            throw { statusCode: 400, message: 'Session has no customer' };
          }
          if (!session.membership_purchase_intent) {
            throw { statusCode: 400, message: 'No membership purchase intent set for this session' };
          }
          if (!session.payment_intent_id) {
            throw { statusCode: 400, message: 'No payment intent found for this session' };
          }

          const intentResult = await client.query<PaymentIntentRow>(
            `SELECT * FROM payment_intents WHERE id = $1 LIMIT 1`,
            [session.payment_intent_id]
          );
          if (intentResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Payment intent not found' };
          }
          const pi = intentResult.rows[0]!;
          if (pi.status !== 'PAID') {
            throw { statusCode: 400, message: 'Payment intent must be PAID before completing membership' };
          }

          // Persist membership to customer record.
          await client.query(
            `UPDATE customers
             SET membership_number = $1,
                 membership_card_type = 'SIX_MONTH',
                 membership_valid_until = (CURRENT_DATE + INTERVAL '6 months')::date,
                 updated_at = NOW()
             WHERE id = $2`,
            [membershipNumber.trim(), session.customer_id]
          );

          // Mirror membership number on lane session (non-authoritative, but useful for downstream eligibility).
          await client.query(
            `UPDATE lane_sessions
             SET membership_number = $1,
                 membership_purchase_intent = NULL,
                 membership_purchase_requested_at = NULL,
                 updated_at = NOW()
             WHERE id = $2`,
            [membershipNumber.trim(), session.id]
          );

          return { sessionId: session.id, laneId: resolvedLaneId };
        });

        const { payload } = await transaction((client) =>
          buildFullSessionUpdatedPayload(client, result.sessionId)
        );
        fastify.broadcaster.broadcastSessionUpdated(payload, result.laneId || laneId);

        return reply.send({ success: true });
      } catch (error: unknown) {
        request.log.error(error, 'Failed to complete membership purchase');
        const httpErr = getHttpError(error);
        if (httpErr) {
          return reply.status(httpErr.statusCode).send({
            error: httpErr.message ?? 'Failed to complete membership purchase',
          });
        }
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to complete membership purchase',
        });
      }
    }
  );

  /**
   * GET /v1/checkin/lane/:laneId/set-language
   *
   * Compatibility helper: some clients/devtools may hit this URL via GET.
   * Prefer POST from apps; GET accepts query params and performs the same update.
   */
  fastify.get<{
    Params: { laneId: string };
    Querystring: { language: 'EN' | 'ES'; sessionId?: string; customerName?: string };
  }>('/v1/checkin/lane/:laneId/set-language', async (request, reply) => {
    const { laneId } = request.params;
    const { language, sessionId, customerName } = request.query;
    if (language !== 'EN' && language !== 'ES') {
      return reply.status(400).send({ error: 'language must be EN or ES' });
    }
    try {
      const result = await setLanguageForLaneSession({ laneId, language, sessionId, customerName });
      return reply.send(result);
    } catch (error: unknown) {
      request.log.error(error, 'Failed to set language (GET)');
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
  fastify.post<{ Params: { laneId: string }; Body: { note: string } }>(
    '/v1/checkin/lane/:laneId/add-note',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
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
          await client.query(`UPDATE customers SET notes = $1, updated_at = NOW() WHERE id = $2`, [
            updatedNotes,
            session.customer_id,
          ]);

          return { sessionId: session.id, success: true, note: newNoteEntry };
        });

        const { payload } = await transaction((client) =>
          buildFullSessionUpdatedPayload(client, result.sessionId)
        );
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
    }
  );

  /**
   * POST /v1/checkin/lane/:laneId/demo-take-payment
   *
   * Demo endpoint to take payment (must be called after selection is confirmed).
   */
  fastify.post<{
    Params: { laneId: string };
    Body: {
      outcome: 'CASH_SUCCESS' | 'CREDIT_SUCCESS' | 'CREDIT_DECLINE';
      declineReason?: string;
      registerNumber?: number;
    };
  }>(
    '/v1/checkin/lane/:laneId/demo-take-payment',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
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
              [outcome === 'CASH_SUCCESS' ? 'CASH' : 'CREDIT', registerNumber || null, intent.id]
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

        const { payload } = await transaction((client) =>
          buildFullSessionUpdatedPayload(client, result.sessionId)
        );
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
    }
  );

  /**
   * POST /v1/checkin/lane/:laneId/reset
   *
   * Reset/complete transaction - marks session as completed and clears customer state.
   */
  fastify.post<{
    Params: { laneId: string };
  }>(
    '/v1/checkin/lane/:laneId/reset',
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
          // Grab the most recent non-cancelled session (active or already completed).
          const sessionResult = await client.query<LaneSessionRow>(
            `SELECT * FROM lane_sessions
           WHERE lane_id = $1 AND status != 'CANCELLED'
           ORDER BY created_at DESC
           LIMIT 1`,
            [laneId]
          );

          if (sessionResult.rows.length === 0) {
            throw { statusCode: 404, message: 'No active session found' };
          }

          const session = sessionResult.rows[0]!;
          request.log.info(
            { laneId, sessionId: session.id, actor: 'employee-register', action: 'reset_complete' },
            'Completing lane session (reset)'
          );

          // Always clear state and mark completed to keep reset idempotent.
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
               membership_purchase_intent = NULL,
               membership_purchase_requested_at = NULL,
               kiosk_acknowledged_at = NULL,
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

        const { payload } = await transaction((client) =>
          buildFullSessionUpdatedPayload(client, result.sessionId)
        );
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
    }
  );

  /**
   * POST /v1/checkin/lane/:laneId/kiosk-ack
   *
   * Public kiosk acknowledgement that the customer has tapped OK on the completion screen.
   * This must NOT clear/end the lane session. It only marks kiosk_acknowledged_at so the kiosk UI can
   * safely return to idle while the employee-register still completes the transaction.
   *
   * Security: optionalAuth (kiosk does not have staff token).
   */
  fastify.post<{
    Params: { laneId: string };
  }>(
    '/v1/checkin/lane/:laneId/kiosk-ack',
    {
      preHandler: [optionalAuth, requireKioskTokenOrStaff],
    },
    async (request, reply) => {
      const { laneId } = request.params;
      try {
        const result = await transaction(async (client) => {
          const sessionResult = await client.query<LaneSessionRow>(
            `SELECT * FROM lane_sessions
           WHERE lane_id = $1 AND status != 'CANCELLED'
           ORDER BY created_at DESC
           LIMIT 1`,
            [laneId]
          );

          if (sessionResult.rows.length === 0) {
            throw { statusCode: 404, message: 'No session found' };
          }

          const session = sessionResult.rows[0]!;
          request.log.info(
            { laneId, sessionId: session.id, actor: 'kiosk', action: 'kiosk_ack' },
            'Kiosk acknowledged; marking kiosk_acknowledged_at (no session clear)'
          );

          await client.query(
            `UPDATE lane_sessions
             SET kiosk_acknowledged_at = NOW(),
                 updated_at = NOW()
             WHERE id = $1`,
            [session.id]
          );

          return { sessionId: session.id };
        });

        const { payload } = await transaction((client) =>
          buildFullSessionUpdatedPayload(client, result.sessionId)
        );
        fastify.broadcaster.broadcastSessionUpdated(payload, laneId);

        return reply.send({ success: true });
      } catch (error: unknown) {
        request.log.error(error, 'Failed to kiosk-ack session');
        const httpErr = getHttpError(error);
        if (httpErr) {
          return reply.status(httpErr.statusCode).send({
            error: httpErr.message ?? 'Failed to kiosk-ack',
          });
        }
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to kiosk-ack session',
        });
      }
    }
  );
}
