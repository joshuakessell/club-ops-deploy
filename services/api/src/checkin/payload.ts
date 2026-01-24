import type { SessionUpdatedPayload } from '@club-ops/shared';
import type { transaction } from '../db';

type PoolClient = Parameters<Parameters<typeof transaction>[0]>[0];

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
  agreement_bypass_pending?: boolean;
  agreement_signed_method?: string | null;
  membership_purchase_intent?: 'PURCHASE' | 'RENEW' | null;
  membership_purchase_requested_at?: Date | null;
  membership_choice?: 'ONE_TIME' | 'SIX_MONTH' | null;
  kiosk_acknowledged_at?: Date | null;
  checkin_mode: string | null; // 'CHECKIN' or 'RENEWAL'
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
  id_scan_hash?: string | null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractPaymentLineItems(
  raw: unknown
): Array<{ description: string; amount: number }> | undefined {
  if (raw === null || raw === undefined) return undefined;
  let parsed: unknown = raw;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return undefined;
    }
  }
  if (!isRecord(parsed)) return undefined;
  const items = parsed['lineItems'];
  if (!Array.isArray(items)) return undefined;

  const normalized: Array<{ description: string; amount: number }> = [];
  for (const it of items) {
    if (!isRecord(it)) continue;
    const description = it['description'];
    const amount = toNumber(it['amount']);
    if (typeof description !== 'string' || amount === undefined) continue;
    normalized.push({ description, amount });
  }
  return normalized.length > 0 ? normalized : undefined;
}

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

export function getAllowedRentals(membershipNumber: string | null | undefined): string[] {
  const allowed: string[] = ['LOCKER', 'STANDARD', 'DOUBLE', 'SPECIAL'];

  if (isGymLockerEligible(membershipNumber)) {
    allowed.push('GYM_LOCKER');
  }

  return allowed;
}

export async function buildFullSessionUpdatedPayload(
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

  const customer = session.customer_id
    ? (
        await client.query<CustomerRow>(
          `SELECT id, name, dob, membership_number, membership_card_type, membership_valid_until, past_due_balance, primary_language, notes, id_scan_hash
             FROM customers
             WHERE id = $1
             LIMIT 1`,
          [session.customer_id]
        )
      ).rows[0]
    : undefined;

  const membershipNumber = customer?.membership_number || session.membership_number || undefined;

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

  const customerHasEncryptedLookupMarker = Boolean(customer?.id_scan_hash);

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
  const paymentLineItems =
    extractPaymentLineItems(session.price_quote_json) ??
    extractPaymentLineItems(paymentIntent?.quote_json);

  const membershipValidUntilRaw = (customer as any)?.membership_valid_until as unknown;
  const customerMembershipValidUntil =
    membershipValidUntilRaw instanceof Date
      ? membershipValidUntilRaw.toISOString().slice(0, 10)
      : typeof membershipValidUntilRaw === 'string'
        ? membershipValidUntilRaw
        : undefined;

  const payload: SessionUpdatedPayload = {
    sessionId: session.id,
    customerName: customer?.name || session.customer_display_name || '',
    membershipNumber,
    customerMembershipValidUntil,
    membershipChoice: (session.membership_choice as 'ONE_TIME' | 'SIX_MONTH' | null) ?? null,
    membershipPurchaseIntent:
      (session.membership_purchase_intent as 'PURCHASE' | 'RENEW' | null) || undefined,
    kioskAcknowledgedAt: session.kiosk_acknowledged_at
      ? session.kiosk_acknowledged_at.toISOString()
      : undefined,
    allowedRentals,
    mode: session.checkin_mode === 'RENEWAL' ? 'RENEWAL' : 'CHECKIN',
    status: session.status,
    proposedRentalType: session.proposed_rental_type || undefined,
    proposedBy: (session.proposed_by as 'CUSTOMER' | 'EMPLOYEE' | null) || undefined,
    selectionConfirmed: !!session.selection_confirmed,
    selectionConfirmedBy:
      (session.selection_confirmed_by as 'CUSTOMER' | 'EMPLOYEE' | null) || undefined,
    customerPrimaryLanguage: (customer?.primary_language as 'EN' | 'ES' | undefined) || undefined,
    customerDobMonthDay,
    customerLastVisitAt,
    customerNotes: customer?.notes || undefined,
    customerHasEncryptedLookupMarker,
    pastDueBalance: pastDueBalance > 0 ? pastDueBalance : undefined,
    pastDueBlocked,
    pastDueBypassed,
    paymentIntentId: paymentIntent?.id,
    paymentStatus: (paymentIntent?.status as 'DUE' | 'PAID' | undefined) || undefined,
    paymentMethod: (paymentIntent?.payment_method as 'CASH' | 'CREDIT' | undefined) || undefined,
    paymentTotal,
    paymentLineItems,
    paymentFailureReason: paymentIntent?.failure_reason || undefined,
    agreementSigned: blockForSession ? !!blockForSession.agreement_signed : false,
    agreementBypassPending: !!session.agreement_bypass_pending,
    agreementSignedMethod:
      session.agreement_signed_method === 'MANUAL' || session.agreement_signed_method === 'DIGITAL'
        ? (session.agreement_signed_method as 'DIGITAL' | 'MANUAL')
        : undefined,
    assignedResourceType: assignedResourceType || undefined,
    assignedResourceNumber,
    visitId: blockForSession?.visit_id || activeVisitId,
    waitlistDesiredType: session.waitlist_desired_type || undefined,
    backupRentalType: session.backup_rental_type || undefined,
    blockEndsAt: blockForSession?.ends_at
      ? blockForSession.ends_at.toISOString()
      : activeBlockEndsAt,
    checkoutAt: blockForSession?.ends_at ? blockForSession.ends_at.toISOString() : undefined,
  };

  return { laneId, payload };
}
