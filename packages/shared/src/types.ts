import { RoomStatus, RoomType } from './enums';

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
  assignedTo?: string;
  overrideFlag: boolean;
}

/**
 * Represents a locker in the club.
 */
export interface Locker {
  id: string;
  number: string;
  status: RoomStatus;
  assignedTo?: string;
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
  | 'SELECTION_PROPOSED'
  | 'SELECTION_LOCKED'
  | 'SELECTION_ACKNOWLEDGED'
  | 'WAITLIST_CREATED'
  | 'ASSIGNMENT_CREATED'
  | 'ASSIGNMENT_FAILED'
  | 'CUSTOMER_CONFIRMATION_REQUIRED'
  | 'CUSTOMER_CONFIRMED'
  | 'CUSTOMER_DECLINED'
  | 'CHECKOUT_REQUESTED'
  | 'CHECKOUT_CLAIMED'
  | 'CHECKOUT_UPDATED'
  | 'CHECKOUT_COMPLETED'
  | 'WAITLIST_UPDATED'
  | 'REGISTER_SESSION_UPDATED';

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
  mode?: 'INITIAL' | 'RENEWAL';
  blockEndsAt?: string;
  visitId?: string;
  status?: string;
  proposedRentalType?: string;
  proposedBy?: 'CUSTOMER' | 'EMPLOYEE';
  selectionConfirmed?: boolean;
  selectionConfirmedBy?: 'CUSTOMER' | 'EMPLOYEE';
  customerPrimaryLanguage?: 'EN' | 'ES';
  customerDobMonthDay?: string;
  customerLastVisitAt?: string;
  customerNotes?: string;
  pastDueBalance?: number;
  pastDueBlocked?: boolean;
  pastDueBypassed?: boolean;
  paymentIntentId?: string;
  paymentStatus?: 'DUE' | 'PAID';
  paymentMethod?: 'CASH' | 'CREDIT';
  paymentTotal?: number;
  paymentFailureReason?: string;
  agreementSigned?: boolean;
  assignedResourceType?: 'room' | 'locker';
  assignedResourceNumber?: string;
  checkoutAt?: string;
}

/**
 * Selection proposed event payload.
 */
export interface SelectionProposedPayload {
  sessionId: string;
  rentalType: string;
  proposedBy: 'CUSTOMER' | 'EMPLOYEE';
}

/**
 * Selection locked event payload.
 */
export interface SelectionLockedPayload {
  sessionId: string;
  rentalType: string;
  confirmedBy: 'CUSTOMER' | 'EMPLOYEE';
  lockedAt: string;
}

/**
 * Selection acknowledged event payload.
 */
export interface SelectionAcknowledgedPayload {
  sessionId: string;
  acknowledgedBy: 'CUSTOMER' | 'EMPLOYEE';
}

/**
 * Waitlist created event payload.
 */
export interface WaitlistCreatedPayload {
  sessionId: string;
  waitlistId: string;
  desiredType: string;
  backupType: string;
  position: number;
  estimatedReadyAt?: string;
  upgradeFee?: number;
}

/**
 * Assignment created event payload.
 */
export interface AssignmentCreatedPayload {
  sessionId: string;
  roomId?: string;
  roomNumber?: string;
  lockerId?: string;
  lockerNumber?: string;
  rentalType: string;
}

/**
 * Assignment failed event payload.
 */
export interface AssignmentFailedPayload {
  sessionId: string;
  reason: string;
  requestedRoomId?: string;
  requestedLockerId?: string;
}

/**
 * Customer confirmation required event payload.
 */
export interface CustomerConfirmationRequiredPayload {
  sessionId: string;
  requestedType: string;
  selectedType: string;
  selectedNumber: string;
}

/**
 * Customer confirmed event payload.
 */
export interface CustomerConfirmedPayload {
  sessionId: string;
  confirmedType: string;
  confirmedNumber: string;
}

/**
 * Customer declined event payload.
 */
export interface CustomerDeclinedPayload {
  sessionId: string;
  requestedType: string;
}

// Additional types for visits, checkouts, etc.
export interface Visit {
  id: string;
  customerId: string;
  startedAt: Date;
  endedAt?: Date;
}

export interface CheckinBlock {
  id: string;
  visitId: string;
  blockType: 'INITIAL' | 'RENEWAL' | 'FINAL_EXTENSION';
  startsAt: Date;
  endsAt: Date;
  rentalType: string;
  roomId?: string;
  lockerId?: string;
}

export interface ActiveVisit {
  id: string;
  customerName: string;
  membershipNumber?: string;
  currentCheckoutAt: Date;
}

export type CheckoutRequestStatus = 'SUBMITTED' | 'CLAIMED' | 'VERIFIED' | 'CANCELLED';

export interface CheckoutChecklist {
  key?: boolean;
  towel?: boolean;
  sheets?: boolean;
  remote?: boolean;
}

export interface ResolvedCheckoutKey {
  keyTagId: string;
  occupancyId: string;
  customerId: string;
  customerName: string;
  membershipNumber?: string;
  rentalType: string;
  roomId?: string;
  roomNumber?: string;
  lockerId?: string;
  lockerNumber?: string;
  scheduledCheckoutAt: Date | string;
  hasTvRemote: boolean;
  lateMinutes: number;
  lateFeeAmount: number;
  banApplied: boolean;
}

export interface CheckoutRequestSummary {
  requestId: string;
  customerName: string;
  membershipNumber?: string;
  rentalType: string;
  roomNumber?: string;
  lockerNumber?: string;
  scheduledCheckoutAt: Date;
  currentTime: Date;
  lateMinutes: number;
  lateFeeAmount: number;
  banApplied: boolean;
}

export interface CheckoutRequestedPayload {
  request: CheckoutRequestSummary;
}

export interface CheckoutClaimedPayload {
  requestId: string;
  claimedBy: string;
}

export interface CheckoutUpdatedPayload {
  requestId: string;
  itemsConfirmed: boolean;
  feePaid: boolean;
}

export interface CheckoutCompletedPayload {
  requestId: string;
}

/**
 * Register session updated event payload.
 * Emitted when a register session is created, signed out, force signed out, or expires.
 */
export interface RegisterSessionUpdatedPayload {
  registerNumber: 1 | 2;
  active: boolean;
  sessionId: string | null;
  employee: {
    id: string;
    displayName: string;
    role: string;
  } | null;
  deviceId: string | null;
  createdAt: string | null;
  lastHeartbeatAt: string | null;
  reason: 'CONFIRMED' | 'SIGNED_OUT' | 'FORCED_SIGN_OUT' | 'TTL_EXPIRED' | 'DEVICE_DISABLED';
}

