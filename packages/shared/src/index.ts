// Enums
export { RoomStatus, RoomType, BlockType, CheckinMode, RentalType } from './enums';

// Transition validation
export { isAdjacentTransition, validateTransition, type TransitionResult } from './transitions';

// Types
export type {
  Room,
  Locker,
  InventorySummary,
  DetailedInventory,
  WebSocketEventType,
  WebSocketEvent,
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
  RegisterSessionUpdatedPayload,
} from './types';

// Membership helpers (shared business logic)
export type { CustomerMembershipStatus, MembershipStatusInput } from './membership';
export { getCustomerMembershipStatus } from './membership';

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
} from './schemas';

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
} from './inventory';
