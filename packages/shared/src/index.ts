// Enums
export { RoomStatus, RoomType, BlockType, CheckinMode, RentalType } from './enums.js';

// Transition validation
export { isAdjacentTransition, validateTransition, type TransitionResult } from './transitions.js';

// Checkout display helpers
export {
  computeCheckoutDelta,
  formatCheckoutDelta,
  type CheckoutDelta,
  type CheckoutDeltaStatus,
} from './checkoutDelta.js';

// Types
export type {
  Room,
  Locker,
  InventorySummary,
  DetailedInventory,
  WebSocketEventType,
  WebSocketEvent,
  CheckinOptionHighlightedPayload,
  RoomStatusChangedPayload,
  InventoryUpdatedPayload,
  SessionUpdatedPayload,
  Visit,
  CheckinBlock,
  ActiveVisit,
  CheckoutRequestStatus,
  CheckoutChecklist,
  ResolvedCheckoutKey,
  CheckoutRequestSummary,
  CheckoutRequestedPayload,
  CheckoutClaimedPayload,
  CheckoutUpdatedPayload,
  CheckoutCompletedPayload,
  AssignmentCreatedPayload,
  AssignmentFailedPayload,
  CustomerConfirmationRequiredPayload,
  CustomerConfirmedPayload,
  CustomerDeclinedPayload,
  SelectionProposedPayload,
  SelectionForcedPayload,
  SelectionLockedPayload,
  SelectionAcknowledgedPayload,
  WaitlistCreatedPayload,
  UpgradeHoldAvailablePayload,
  UpgradeOfferExpiredPayload,
  RegisterSessionUpdatedPayload,
} from './types.js';

// Membership helpers (shared business logic)
export type { CustomerMembershipStatus, MembershipStatusInput } from './membership.js';
export { getCustomerMembershipStatus } from './membership.js';

// Zod schemas
export {
  RoomStatusSchema,
  RoomTypeSchema,
  RoomSchema,
  RoomStatusUpdateSchema,
  InventorySummarySchema,
  BatchStatusUpdateSchema,
  IdScanPayloadSchema,
  type RoomInput,
  type RoomStatusUpdateInput,
  type InventorySummaryInput,
  type BatchStatusUpdateInput,
  type IdScanPayload,
} from './schemas.js';

// WebSocket runtime validation
export {
  safeParseWebSocketEvent,
  type ParsedWebSocketEvent,
  SessionUpdatedPayloadSchema,
  InventoryUpdatedPayloadSchema,
  UpgradeHoldAvailablePayloadSchema,
  UpgradeOfferExpiredPayloadSchema,
} from './websocketSchemas.js';

// Facility inventory contract (rooms + lockers)
export {
  LOCKER_NUMBERS,
  EXPECTED_LOCKER_COUNT,
  NONEXISTENT_ROOM_NUMBERS,
  ROOM_NUMBERS,
  ROOM_NUMBER_SET,
  EXPECTED_ROOM_COUNT,
  ROOMS,
  DELUXE_ROOM_NUMBERS,
  SPECIAL_ROOM_NUMBERS,
  isDeluxeRoom,
  isSpecialRoom,
  isExistingRoomNumber,
  getRoomKind,
  type RoomKind,
} from './inventory.js';

// Agreement content (built-in HTML used by kiosk + PDF generation)
export { AGREEMENT_LEGAL_BODY_HTML_BY_LANG, type AgreementLanguage } from './agreementContent.js';
