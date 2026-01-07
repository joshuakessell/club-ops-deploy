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
