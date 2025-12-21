import { RoomStatus, RoomType, BlockType, CheckinMode, RentalType } from './enums';

/**
 * Represents a room in the club.
 */
export interface Room {
  id: string;
  number: string;
  type: RoomType;
  status: RoomStatus;
  floor: number;
  lastStatusChange: Date;
  assignedToCustomerId?: string;
  overrideFlag: boolean;
}

/**
 * Represents a locker in the club.
 */
export interface Locker {
  id: string;
  number: string;
  status: RoomStatus;
  assignedToCustomerId?: string;
}

/**
 * Summary of room inventory by status.
 */
export interface InventorySummary {
  clean: number;
  cleaning: number;
  dirty: number;
  total: number;
}

/**
 * Detailed inventory breakdown by room type.
 */
export interface DetailedInventory {
  byType: Record<RoomType, InventorySummary>;
  overall: InventorySummary;
  lockers: InventorySummary;
}

/**
 * WebSocket event types for real-time updates.
 */
export type WebSocketEventType =
  | 'ROOM_STATUS_CHANGED'
  | 'INVENTORY_UPDATED'
  | 'ROOM_ASSIGNED'
  | 'ROOM_RELEASED'
  | 'SESSION_UPDATED'
  | 'CHECKOUT_REQUESTED'
  | 'CHECKOUT_CLAIMED'
  | 'CHECKOUT_UPDATED'
  | 'CHECKOUT_COMPLETED'
  | 'ASSIGNMENT_CREATED'
  | 'ASSIGNMENT_FAILED'
  | 'CUSTOMER_CONFIRMATION_REQUIRED'
  | 'CUSTOMER_CONFIRMED'
  | 'CUSTOMER_DECLINED'
  | 'WAITLIST_UPDATED';

/**
 * Base WebSocket event structure.
 */
export interface WebSocketEvent<T = unknown> {
  type: WebSocketEventType;
  payload: T;
  timestamp: string;
}

/**
 * Room status change event payload.
 */
export interface RoomStatusChangedPayload {
  roomId: string;
  previousStatus: RoomStatus;
  newStatus: RoomStatus;
  changedBy: string;
  override: boolean;
  reason?: string;
}

/**
 * Inventory update event payload.
 */
export interface InventoryUpdatedPayload {
  inventory: DetailedInventory;
}

/**
 * Session updated event payload.
 * Emitted whenever a lane session is created or updated.
 */
export interface SessionUpdatedPayload {
  sessionId: string;
  customerName: string;
  membershipNumber?: string;
  allowedRentals: string[];
  mode?: CheckinMode; // INITIAL or RENEWAL
  blockEndsAt?: string; // ISO timestamp of when current block ends
  visitId?: string; // Visit ID if this is part of a visit
  status?: string; // Lane session status (IDLE, ACTIVE, AWAITING_ASSIGNMENT, AWAITING_PAYMENT, AWAITING_SIGNATURE, COMPLETED, CANCELLED)
}

/**
 * Represents a visit (overall stay) that can contain multiple time blocks.
 */
export interface Visit {
  id: string;
  customerId: string;
  startedAt: Date;
  endedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Represents a check-in block within a visit.
 */
export interface CheckinBlock {
  id: string;
  visitId: string;
  blockType: BlockType;
  startsAt: Date;
  endsAt: Date;
  rentalType: RentalType;
  roomId?: string;
  lockerId?: string;
  sessionId?: string;
  agreementSigned: boolean;
  hasTvRemote?: boolean; // Whether TV remote was provided for this stay
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Active visit search result with computed fields.
 */
export interface ActiveVisit {
  id: string;
  customerId: string;
  customerName: string;
  membershipNumber?: string;
  startedAt: Date;
  currentCheckoutAt: Date; // When the current block ends
  totalHoursIfRenewed: number; // Total hours if renewal is added
  canFinalExtend: boolean; // Whether final 2-hour extension is possible
  blocks: CheckinBlock[];
}

/**
 * Checkout request status.
 * Matches SCHEMA_OVERVIEW.md canonical definition.
 */
export type CheckoutRequestStatus = 'SUBMITTED' | 'CLAIMED' | 'VERIFIED' | 'CANCELLED';

/**
 * Customer checklist items for checkout.
 */
export interface CheckoutChecklist {
  lockerKey?: boolean;
  towel?: boolean;
  roomKey?: boolean;
  bedSheets?: boolean;
  tvRemote?: boolean;
}

/**
 * Resolved key information for checkout.
 */
export interface ResolvedCheckoutKey {
  keyTagId: string;
  occupancyId: string; // checkin_block.id
  customerId: string;
  customerName: string;
  membershipNumber?: string;
  rentalType: RentalType;
  roomId?: string;
  roomNumber?: string;
  lockerId?: string;
  lockerNumber?: string;
  scheduledCheckoutAt: Date;
  hasTvRemote: boolean;
  lateMinutes: number;
  lateFeeAmount: number;
  banApplied: boolean;
}

/**
 * Checkout request summary for notifications.
 */
export interface CheckoutRequestSummary {
  requestId: string;
  customerId: string;
  customerName: string;
  membershipNumber?: string;
  rentalType: RentalType;
  roomNumber?: string;
  lockerNumber?: string;
  scheduledCheckoutAt: Date;
  currentTime: Date;
  lateMinutes: number;
  lateFeeAmount: number;
  banApplied: boolean;
}

/**
 * Checkout requested WebSocket event payload.
 */
export interface CheckoutRequestedPayload {
  request: CheckoutRequestSummary;
}

/**
 * Checkout claimed WebSocket event payload.
 */
export interface CheckoutClaimedPayload {
  requestId: string;
  staffId: string;
  staffName: string;
}

/**
 * Checkout updated WebSocket event payload.
 */
export interface CheckoutUpdatedPayload {
  requestId: string;
  itemsConfirmed: boolean;
  feePaid: boolean;
}

/**
 * Checkout completed WebSocket event payload.
 */
export interface CheckoutCompletedPayload {
  requestId: string;
  kioskDeviceId: string;
  success: boolean;
  message?: string;
}

/**
 * Assignment created WebSocket event payload.
 */
export interface AssignmentCreatedPayload {
  sessionId: string;
  roomId?: string;
  lockerId?: string;
  roomNumber?: string;
  lockerNumber?: string;
  rentalType: RentalType;
}

/**
 * Assignment failed WebSocket event payload.
 */
export interface AssignmentFailedPayload {
  sessionId: string;
  reason: string;
  requestedRoomId?: string;
  requestedLockerId?: string;
}

/**
 * Customer confirmation required WebSocket event payload.
 * Sent to customer kiosk when employee selects different type than customer requested.
 */
export interface CustomerConfirmationRequiredPayload {
  sessionId: string;
  requestedType: string;
  selectedType: string;
  selectedNumber: string;
}

/**
 * Customer confirmed WebSocket event payload.
 * Sent when customer accepts the different selection.
 */
export interface CustomerConfirmedPayload {
  sessionId: string;
  confirmedType: string;
  confirmedNumber: string;
}

/**
 * Customer declined WebSocket event payload.
 * Sent when customer rejects the different selection.
 */
export interface CustomerDeclinedPayload {
  sessionId: string;
  requestedType: string;
}

/**
 * Waitlist updated WebSocket event payload.
 * Sent when waitlist entry is created, updated, or completed.
 */
export interface WaitlistUpdatedPayload {
  waitlistId: string;
  status: 'ACTIVE' | 'OFFERED' | 'COMPLETED' | 'CANCELLED';
  visitId?: string;
  desiredTier?: string;
  roomId?: string;
  roomNumber?: string;
}

