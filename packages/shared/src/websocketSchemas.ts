import { z } from 'zod';
import { RoomStatus } from './enums.js';
import type {
  AssignmentCreatedPayload,
  AssignmentFailedPayload,
  CheckinOptionHighlightedPayload,
  CheckoutClaimedPayload,
  CheckoutCompletedPayload,
  CheckoutRequestedPayload,
  CheckoutRequestSummary,
  CheckoutUpdatedPayload,
  CustomerConfirmationRequiredPayload,
  CustomerConfirmedPayload,
  CustomerDeclinedPayload,
  DetailedInventory,
  InventoryUpdatedPayload,
  RoomStatusChangedPayload,
  SelectionAcknowledgedPayload,
  SelectionForcedPayload,
  SelectionLockedPayload,
  SelectionProposedPayload,
  SessionUpdatedPayload,
  UpgradeHoldAvailablePayload,
  UpgradeOfferExpiredPayload,
  WaitlistCreatedPayload,
  WebSocketEvent,
} from './types.js';

const WebSocketEventBaseSchema = z.object({
  type: z.string(),
  payload: z.unknown(),
  timestamp: z.string(),
});

// ---------------------------------------------------------------------------
// Payload schemas (runtime validation)
// ---------------------------------------------------------------------------

export const SessionUpdatedPayloadSchema: z.ZodType<SessionUpdatedPayload, z.ZodTypeDef, unknown> = z
  .object({
    sessionId: z.string(),
    customerName: z.string(),
    // Some producers may send null for "missing" optional fields; normalize null -> undefined.
    membershipNumber: z.preprocess((v) => (v === null ? undefined : v), z.string().optional()),
    customerMembershipValidUntil: z.preprocess((v) => (v === null ? undefined : v), z.string().optional()),
    membershipChoice: z.enum(['ONE_TIME', 'SIX_MONTH']).nullable().optional(),
    membershipPurchaseIntent: z.preprocess(
      (v) => (v === null ? undefined : v),
      z.enum(['PURCHASE', 'RENEW']).optional()
    ),
    kioskAcknowledgedAt: z.preprocess((v) => (v === null ? undefined : v), z.string().optional()),
    // Server normally includes this, but keep tolerant so older servers/tests don't drop WS events.
    allowedRentals: z.array(z.string()).default([]),
    mode: z.enum(['CHECKIN', 'RENEWAL']).optional(),
    blockEndsAt: z.preprocess((v) => (v === null ? undefined : v), z.string().optional()),
    visitId: z.preprocess((v) => (v === null ? undefined : v), z.string().optional()),
    waitlistDesiredType: z.preprocess((v) => (v === null ? undefined : v), z.string().optional()),
    backupRentalType: z.preprocess((v) => (v === null ? undefined : v), z.string().optional()),
    status: z.preprocess((v) => (v === null ? undefined : v), z.string().optional()),
    proposedRentalType: z.preprocess((v) => (v === null ? undefined : v), z.string().optional()),
    proposedBy: z.enum(['CUSTOMER', 'EMPLOYEE']).optional(),
    selectionConfirmed: z.boolean().optional(),
    selectionConfirmedBy: z.enum(['CUSTOMER', 'EMPLOYEE']).optional(),
    customerPrimaryLanguage: z.preprocess((v) => (v === null ? undefined : v), z.enum(['EN', 'ES']).optional()),
    customerDobMonthDay: z.preprocess((v) => (v === null ? undefined : v), z.string().optional()),
    customerLastVisitAt: z.preprocess((v) => (v === null ? undefined : v), z.string().optional()),
    customerNotes: z.preprocess((v) => (v === null ? undefined : v), z.string().optional()),
    customerHasEncryptedLookupMarker: z.boolean().optional(),
    pastDueBalance: z.number().optional(),
    pastDueBlocked: z.boolean().optional(),
    pastDueBypassed: z.boolean().optional(),
    paymentIntentId: z.preprocess((v) => (v === null ? undefined : v), z.string().optional()),
    paymentStatus: z.enum(['DUE', 'PAID']).optional(),
    paymentMethod: z.enum(['CASH', 'CREDIT']).optional(),
    paymentTotal: z.number().optional(),
    paymentLineItems: z
      .array(
        z.object({
          description: z.string(),
          amount: z.number(),
        })
      )
      .optional(),
    paymentFailureReason: z.preprocess((v) => (v === null ? undefined : v), z.string().optional()),
    agreementSigned: z.boolean().optional(),
    agreementBypassPending: z.boolean().optional(),
    agreementSignedMethod: z.enum(['DIGITAL', 'MANUAL']).optional(),
    assignedResourceType: z.enum(['room', 'locker']).optional(),
    assignedResourceNumber: z.preprocess((v) => (v === null ? undefined : v), z.string().optional()),
    checkoutAt: z.preprocess((v) => (v === null ? undefined : v), z.string().optional()),
  })
  .passthrough();

export const CheckinOptionHighlightedPayloadSchema: z.ZodType<CheckinOptionHighlightedPayload> = z
  .object({
    sessionId: z.string(),
    step: z.enum(['LANGUAGE', 'MEMBERSHIP', 'WAITLIST_BACKUP']),
    option: z.string().nullable(),
    by: z.literal('EMPLOYEE'),
  })
  .passthrough();

export const SelectionProposedPayloadSchema: z.ZodType<SelectionProposedPayload> = z
  .object({
    sessionId: z.string(),
    rentalType: z.string(),
    proposedBy: z.enum(['CUSTOMER', 'EMPLOYEE']),
  })
  .passthrough();

export const SelectionLockedPayloadSchema: z.ZodType<SelectionLockedPayload> = z
  .object({
    sessionId: z.string(),
    rentalType: z.string(),
    confirmedBy: z.enum(['CUSTOMER', 'EMPLOYEE']),
    lockedAt: z.string(),
  })
  .passthrough();

export const SelectionForcedPayloadSchema: z.ZodType<SelectionForcedPayload> = z
  .object({
    sessionId: z.string(),
    rentalType: z.string(),
    forcedBy: z.literal('EMPLOYEE'),
  })
  .passthrough();

export const SelectionAcknowledgedPayloadSchema: z.ZodType<SelectionAcknowledgedPayload> = z
  .object({
    sessionId: z.string(),
    acknowledgedBy: z.enum(['CUSTOMER', 'EMPLOYEE']),
  })
  .passthrough();

export const CustomerConfirmationRequiredPayloadSchema: z.ZodType<CustomerConfirmationRequiredPayload> = z
  .object({
    sessionId: z.string(),
    requestedType: z.string(),
    selectedType: z.string(),
    selectedNumber: z.string(),
  })
  .passthrough();

export const CustomerConfirmedPayloadSchema: z.ZodType<CustomerConfirmedPayload> = z
  .object({
    sessionId: z.string(),
    confirmedType: z.string(),
    confirmedNumber: z.string(),
  })
  .passthrough();

export const CustomerDeclinedPayloadSchema: z.ZodType<CustomerDeclinedPayload> = z
  .object({
    sessionId: z.string(),
    requestedType: z.string(),
  })
  .passthrough();

export const AssignmentCreatedPayloadSchema: z.ZodType<AssignmentCreatedPayload> = z
  .object({
    sessionId: z.string(),
    rentalType: z.string(),
    roomId: z.string().optional(),
    roomNumber: z.string().optional(),
    lockerId: z.string().optional(),
    lockerNumber: z.string().optional(),
  })
  .passthrough();

export const AssignmentFailedPayloadSchema: z.ZodType<AssignmentFailedPayload> = z
  .object({
    sessionId: z.string(),
    reason: z.string(),
    requestedRoomId: z.string().optional(),
    requestedLockerId: z.string().optional(),
  })
  .passthrough();

const InventorySummarySchema = z.object({
  clean: z.number(),
  cleaning: z.number(),
  dirty: z.number(),
  total: z.number(),
});
const DetailedInventorySchema: z.ZodType<DetailedInventory> = z
  .object({
    byType: z.object({
      STANDARD: InventorySummarySchema,
      DOUBLE: InventorySummarySchema,
      SPECIAL: InventorySummarySchema,
      LOCKER: InventorySummarySchema,
    }),
    overall: InventorySummarySchema,
    lockers: InventorySummarySchema,
  })
  .passthrough();
export const InventoryUpdatedPayloadSchema: z.ZodType<InventoryUpdatedPayload> = z
  .object({
    inventory: DetailedInventorySchema,
    available: z
      .object({
        rooms: z.object({
          SPECIAL: z.number(),
          DOUBLE: z.number(),
          STANDARD: z.number(),
        }),
        rawRooms: z.object({
          SPECIAL: z.number(),
          DOUBLE: z.number(),
          STANDARD: z.number(),
        }),
        waitlistDemand: z.object({
          SPECIAL: z.number(),
          DOUBLE: z.number(),
          STANDARD: z.number(),
        }),
        lockers: z.number(),
        total: z.number(),
      })
      .optional(),
  })
  .passthrough();

export const WaitlistCreatedPayloadSchema: z.ZodType<WaitlistCreatedPayload> = z
  .object({
    sessionId: z.string(),
    waitlistId: z.string(),
    desiredType: z.string(),
    backupType: z.string(),
    position: z.number(),
    estimatedReadyAt: z.string().optional(),
    upgradeFee: z.number().optional(),
  })
  .passthrough();

export const UpgradeHoldAvailablePayloadSchema: z.ZodType<UpgradeHoldAvailablePayload> = z
  .object({
    waitlistId: z.string(),
    customerName: z.string(),
    desiredTier: z.string(),
    roomId: z.string(),
    roomNumber: z.string(),
    expiresAt: z.string(),
  })
  .passthrough();

export const UpgradeOfferExpiredPayloadSchema: z.ZodType<UpgradeOfferExpiredPayload> = z
  .object({
    waitlistId: z.string(),
    customerName: z.string(),
    desiredTier: z.string(),
    roomId: z.string(),
    roomNumber: z.string(),
  })
  .passthrough();

export const RoomStatusChangedPayloadSchema: z.ZodType<RoomStatusChangedPayload> = z
  .object({
    roomId: z.string(),
    previousStatus: z.nativeEnum(RoomStatus),
    newStatus: z.nativeEnum(RoomStatus),
    changedBy: z.string(),
    override: z.boolean(),
    reason: z.string().optional(),
  })
  .passthrough();

export const CheckoutRequestSummarySchema: z.ZodType<CheckoutRequestSummary> = z
  .object({
    requestId: z.string(),
    customerName: z.string(),
    membershipNumber: z.string().optional(),
    rentalType: z.string(),
    roomNumber: z.string().optional(),
    lockerNumber: z.string().optional(),
    // WebSocket payloads are JSON; timestamps arrive as ISO strings.
    scheduledCheckoutAt: z.coerce.date(),
    currentTime: z.coerce.date(),
    lateMinutes: z.number(),
    lateFeeAmount: z.number(),
    banApplied: z.boolean(),
  })
  .passthrough();

export const CheckoutRequestedPayloadSchema: z.ZodType<CheckoutRequestedPayload> = z
  .object({
    request: CheckoutRequestSummarySchema,
  })
  .passthrough();

export const CheckoutClaimedPayloadSchema: z.ZodType<CheckoutClaimedPayload> = z
  .object({
    requestId: z.string(),
    claimedBy: z.string(),
  })
  .passthrough();

export const CheckoutUpdatedPayloadSchema: z.ZodType<CheckoutUpdatedPayload> = z
  .object({
    requestId: z.string(),
    itemsConfirmed: z.boolean(),
    feePaid: z.boolean(),
  })
  .passthrough();

export const CheckoutCompletedPayloadSchema: z.ZodType<CheckoutCompletedPayload> = z
  .object({
    requestId: z.string(),
    kioskDeviceId: z.string(),
    success: z.boolean(),
  })
  .passthrough();

export const WaitlistUpdatedPayloadSchema = z
  .object({
    waitlistId: z.string(),
    status: z.string(),
    visitId: z.string().optional(),
    desiredTier: z.string().optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Event parsing
// ---------------------------------------------------------------------------

export type ParsedWebSocketEvent =
  | ({ type: 'SESSION_UPDATED'; payload: SessionUpdatedPayload } & Pick<WebSocketEvent, 'timestamp'>)
  | ({ type: 'CHECKIN_OPTION_HIGHLIGHTED'; payload: CheckinOptionHighlightedPayload } & Pick<
      WebSocketEvent,
      'timestamp'
    >)
  | ({ type: 'SELECTION_PROPOSED'; payload: SelectionProposedPayload } & Pick<WebSocketEvent, 'timestamp'>)
  | ({ type: 'SELECTION_LOCKED'; payload: SelectionLockedPayload } & Pick<WebSocketEvent, 'timestamp'>)
  | ({ type: 'SELECTION_FORCED'; payload: SelectionForcedPayload } & Pick<WebSocketEvent, 'timestamp'>)
  | ({ type: 'SELECTION_ACKNOWLEDGED'; payload: SelectionAcknowledgedPayload } & Pick<
      WebSocketEvent,
      'timestamp'
    >)
  | ({ type: 'CUSTOMER_CONFIRMATION_REQUIRED'; payload: CustomerConfirmationRequiredPayload } & Pick<
      WebSocketEvent,
      'timestamp'
    >)
  | ({ type: 'CUSTOMER_CONFIRMED'; payload: CustomerConfirmedPayload } & Pick<WebSocketEvent, 'timestamp'>)
  | ({ type: 'CUSTOMER_DECLINED'; payload: CustomerDeclinedPayload } & Pick<WebSocketEvent, 'timestamp'>)
  | ({ type: 'ASSIGNMENT_CREATED'; payload: AssignmentCreatedPayload } & Pick<WebSocketEvent, 'timestamp'>)
  | ({ type: 'ASSIGNMENT_FAILED'; payload: AssignmentFailedPayload } & Pick<WebSocketEvent, 'timestamp'>)
  | ({ type: 'INVENTORY_UPDATED'; payload: InventoryUpdatedPayload } & Pick<WebSocketEvent, 'timestamp'>)
  | ({ type: 'WAITLIST_CREATED'; payload: WaitlistCreatedPayload } & Pick<WebSocketEvent, 'timestamp'>)
  | ({ type: 'WAITLIST_UPDATED'; payload: z.infer<typeof WaitlistUpdatedPayloadSchema> } & Pick<
      WebSocketEvent,
      'timestamp'
    >)
  | ({ type: 'UPGRADE_HOLD_AVAILABLE'; payload: UpgradeHoldAvailablePayload } & Pick<WebSocketEvent, 'timestamp'>)
  | ({ type: 'UPGRADE_OFFER_EXPIRED'; payload: UpgradeOfferExpiredPayload } & Pick<WebSocketEvent, 'timestamp'>)
  | ({ type: 'ROOM_STATUS_CHANGED'; payload: RoomStatusChangedPayload } & Pick<WebSocketEvent, 'timestamp'>)
  | ({ type: 'CHECKOUT_REQUESTED'; payload: CheckoutRequestedPayload } & Pick<WebSocketEvent, 'timestamp'>)
  | ({ type: 'CHECKOUT_CLAIMED'; payload: CheckoutClaimedPayload } & Pick<WebSocketEvent, 'timestamp'>)
  | ({ type: 'CHECKOUT_UPDATED'; payload: CheckoutUpdatedPayload } & Pick<WebSocketEvent, 'timestamp'>)
  | ({ type: 'CHECKOUT_COMPLETED'; payload: CheckoutCompletedPayload } & Pick<WebSocketEvent, 'timestamp'>)
  ;

export function safeParseWebSocketEvent(input: unknown): ParsedWebSocketEvent | null {
  const base = WebSocketEventBaseSchema.safeParse(input);
  if (!base.success) return null;

  const { type, payload, timestamp } = base.data;

  const wrap = <T>(schema: z.ZodType<T>) => {
    const parsed = schema.safeParse(payload);
    if (!parsed.success) return null;
    return { type, payload: parsed.data, timestamp } as ParsedWebSocketEvent;
  };

  switch (type) {
    case 'SESSION_UPDATED':
      return wrap(SessionUpdatedPayloadSchema);
    case 'CHECKIN_OPTION_HIGHLIGHTED':
      return wrap(CheckinOptionHighlightedPayloadSchema);
    case 'SELECTION_PROPOSED':
      return wrap(SelectionProposedPayloadSchema);
    case 'SELECTION_LOCKED':
      return wrap(SelectionLockedPayloadSchema);
    case 'SELECTION_FORCED':
      return wrap(SelectionForcedPayloadSchema);
    case 'SELECTION_ACKNOWLEDGED':
      return wrap(SelectionAcknowledgedPayloadSchema);
    case 'CUSTOMER_CONFIRMATION_REQUIRED':
      return wrap(CustomerConfirmationRequiredPayloadSchema);
    case 'CUSTOMER_CONFIRMED':
      return wrap(CustomerConfirmedPayloadSchema);
    case 'CUSTOMER_DECLINED':
      return wrap(CustomerDeclinedPayloadSchema);
    case 'ASSIGNMENT_CREATED':
      return wrap(AssignmentCreatedPayloadSchema);
    case 'ASSIGNMENT_FAILED':
      return wrap(AssignmentFailedPayloadSchema);
    case 'INVENTORY_UPDATED':
      return wrap(InventoryUpdatedPayloadSchema);
    case 'WAITLIST_CREATED':
      return wrap(WaitlistCreatedPayloadSchema);
    case 'WAITLIST_UPDATED':
      return wrap(WaitlistUpdatedPayloadSchema);
    case 'UPGRADE_HOLD_AVAILABLE':
      return wrap(UpgradeHoldAvailablePayloadSchema);
    case 'UPGRADE_OFFER_EXPIRED':
      return wrap(UpgradeOfferExpiredPayloadSchema);
    case 'ROOM_STATUS_CHANGED':
      return wrap(RoomStatusChangedPayloadSchema);
    case 'CHECKOUT_REQUESTED':
      return wrap(CheckoutRequestedPayloadSchema);
    case 'CHECKOUT_CLAIMED':
      return wrap(CheckoutClaimedPayloadSchema);
    case 'CHECKOUT_UPDATED':
      return wrap(CheckoutUpdatedPayloadSchema);
    case 'CHECKOUT_COMPLETED':
      return wrap(CheckoutCompletedPayloadSchema);
    default:
      // Unknown / forward-compatible event types are ignored by default.
      return null;
  }
}
