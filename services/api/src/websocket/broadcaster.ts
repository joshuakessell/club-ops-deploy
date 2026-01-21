import type { WebSocket } from 'ws';
import type {
  WebSocketEventType,
  WebSocketEvent,
  RoomStatusChangedPayload,
  InventoryUpdatedPayload,
  SessionUpdatedPayload,
  CheckinOptionHighlightedPayload,
  SelectionForcedPayload,
  CheckoutRequestedPayload,
  CheckoutClaimedPayload,
  CheckoutUpdatedPayload,
  CheckoutCompletedPayload,
  CustomerConfirmationRequiredPayload,
  CustomerConfirmedPayload,
  CustomerDeclinedPayload,
  AssignmentCreatedPayload,
  AssignmentFailedPayload,
  SelectionProposedPayload,
  SelectionLockedPayload,
  SelectionAcknowledgedPayload,
  WaitlistCreatedPayload,
  RegisterSessionUpdatedPayload,
} from '@club-ops/shared';

/**
 * Room assignment event payload.
 */
export interface RoomAssignedPayload {
  roomId: string;
  sessionId: string;
  customerId: string;
}

/**
 * Room released event payload.
 */
export interface RoomReleasedPayload {
  roomId: string;
  sessionId: string;
}

/**
 * Union type for all WebSocket payloads.
 */
export type WebSocketPayload =
  | RoomStatusChangedPayload
  | InventoryUpdatedPayload
  | RoomAssignedPayload
  | RoomReleasedPayload
  | SessionUpdatedPayload
  | CheckinOptionHighlightedPayload
  | CheckoutRequestedPayload
  | CheckoutClaimedPayload
  | CheckoutUpdatedPayload
  | CheckoutCompletedPayload
  | CustomerConfirmationRequiredPayload
  | CustomerConfirmedPayload
  | CustomerDeclinedPayload
  | SelectionForcedPayload
  | AssignmentCreatedPayload
  | AssignmentFailedPayload
  | SelectionProposedPayload
  | SelectionLockedPayload
  | SelectionAcknowledgedPayload
  | WaitlistCreatedPayload
  | RegisterSessionUpdatedPayload;

/**
 * Client metadata for lane-scoped broadcasts.
 */
interface ClientMetadata {
  socket: WebSocket;
  lane?: string;
  subscribedEvents?: Set<WebSocketEventType>;
}

/**
 * WebSocket broadcaster for sending real-time updates to connected clients.
 * Follows CONTRIBUTING.md requirement: "Realtime is push-based"
 * Supports lane-scoped broadcasts for SESSION_UPDATED events.
 */
export interface Broadcaster {
  addClient(id: string, socket: WebSocket, lane?: string): void;
  removeClient(id: string): void;
  updateClientLane(id: string, lane?: string): void;
  subscribeClient(id: string, events: WebSocketEventType[]): void;
  broadcast<T>(event: WebSocketEvent<T>): void;
  broadcastToLane<T>(event: WebSocketEvent<T>, lane: string): void;
  broadcastRoomStatusChanged(payload: RoomStatusChangedPayload): void;
  broadcastInventoryUpdated(payload: InventoryUpdatedPayload): void;
  broadcastRoomAssigned(payload: RoomAssignedPayload): void;
  broadcastRoomReleased(payload: RoomReleasedPayload): void;
  broadcastSessionUpdated(payload: SessionUpdatedPayload, lane: string): void;
  broadcastCustomerConfirmationRequired(
    payload: CustomerConfirmationRequiredPayload,
    lane: string
  ): void;
  broadcastCustomerConfirmed(payload: CustomerConfirmedPayload, lane: string): void;
  broadcastCustomerDeclined(payload: CustomerDeclinedPayload, lane: string): void;
  broadcastSelectionForced(payload: SelectionForcedPayload, lane: string): void;
  broadcastAssignmentCreated(payload: AssignmentCreatedPayload, lane: string): void;
  broadcastAssignmentFailed(payload: AssignmentFailedPayload, lane: string): void;
  broadcastRegisterSessionUpdated(payload: RegisterSessionUpdatedPayload): void;
  getClientCount(): number;
}

export function createBroadcaster(): Broadcaster {
  const clients = new Map<string, ClientMetadata>();

  function broadcast<T>(event: WebSocketEvent<T>): void {
    const message = JSON.stringify(event);
    const failedClients: string[] = [];

    for (const [id, metadata] of clients) {
      // Check if client is subscribed to this event type
      if (metadata.subscribedEvents && !metadata.subscribedEvents.has(event.type)) {
        continue;
      }

      try {
        if (metadata.socket.readyState === metadata.socket.OPEN) {
          metadata.socket.send(message);
        } else {
          failedClients.push(id);
        }
      } catch {
        failedClients.push(id);
      }
    }

    // Clean up failed clients
    for (const id of failedClients) {
      clients.delete(id);
    }
  }

  function broadcastToLane<T>(event: WebSocketEvent<T>, lane: string): void {
    const message = JSON.stringify(event);
    const failedClients: string[] = [];

    for (const [id, metadata] of clients) {
      // Only send to clients in the specified lane
      if (metadata.lane !== lane) {
        continue;
      }

      // Check if client is subscribed to this event type
      if (metadata.subscribedEvents && !metadata.subscribedEvents.has(event.type)) {
        continue;
      }

      try {
        if (metadata.socket.readyState === metadata.socket.OPEN) {
          metadata.socket.send(message);
        } else {
          failedClients.push(id);
        }
      } catch {
        failedClients.push(id);
      }
    }

    // Clean up failed clients
    for (const id of failedClients) {
      clients.delete(id);
    }
  }

  function createEvent<T>(type: WebSocketEventType, payload: T): WebSocketEvent<T> {
    return {
      type,
      payload,
      timestamp: new Date().toISOString(),
    };
  }

  return {
    addClient(id: string, socket: WebSocket, lane?: string) {
      clients.set(id, { socket, lane, subscribedEvents: undefined });
    },

    removeClient(id: string) {
      clients.delete(id);
    },

    updateClientLane(id: string, lane?: string) {
      const metadata = clients.get(id);
      if (metadata) {
        metadata.lane = lane;
      }
    },

    subscribeClient(id: string, events: WebSocketEventType[]) {
      const metadata = clients.get(id);
      if (metadata) {
        metadata.subscribedEvents = new Set(events);
      }
    },

    broadcast,

    broadcastToLane,

    /**
     * Broadcast a room status change event.
     * Called when a room's cleaning status changes (DIRTY, CLEANING, CLEAN).
     */
    broadcastRoomStatusChanged(payload: RoomStatusChangedPayload) {
      broadcast(createEvent('ROOM_STATUS_CHANGED', payload));
    },

    /**
     * Broadcast an inventory update event.
     * Called when the overall inventory counts change.
     */
    broadcastInventoryUpdated(payload: InventoryUpdatedPayload) {
      broadcast(createEvent('INVENTORY_UPDATED', payload));
    },

    /**
     * Broadcast a room assignment event.
     * Called when a room is assigned to a member session.
     */
    broadcastRoomAssigned(payload: RoomAssignedPayload) {
      broadcast(createEvent('ROOM_ASSIGNED', payload));
    },

    /**
     * Broadcast a room released event.
     * Called when a room is released from a session.
     */
    broadcastRoomReleased(payload: RoomReleasedPayload) {
      broadcast(createEvent('ROOM_RELEASED', payload));
    },

    /**
     * Broadcast a session updated event to a specific lane.
     * Called when a lane session is created or updated.
     */
    broadcastSessionUpdated(payload: SessionUpdatedPayload, lane: string) {
      broadcastToLane(createEvent('SESSION_UPDATED', payload), lane);
    },

    /**
     * Broadcast a customer confirmation required event to a specific lane.
     * Called when employee selects different type than customer requested.
     */
    broadcastCustomerConfirmationRequired(
      payload: CustomerConfirmationRequiredPayload,
      lane: string
    ) {
      broadcastToLane(createEvent('CUSTOMER_CONFIRMATION_REQUIRED', payload), lane);
    },

    /**
     * Broadcast a customer confirmed event to a specific lane.
     * Called when customer accepts the different selection.
     */
    broadcastCustomerConfirmed(payload: CustomerConfirmedPayload, lane: string) {
      broadcastToLane(createEvent('CUSTOMER_CONFIRMED', payload), lane);
    },

    /**
     * Broadcast a customer declined event to a specific lane.
     * Called when customer rejects the different selection.
     */
    broadcastCustomerDeclined(payload: CustomerDeclinedPayload, lane: string) {
      broadcastToLane(createEvent('CUSTOMER_DECLINED', payload), lane);
    },

    /**
     * Broadcast a selection forced event to a specific lane.
     * Used when employee double-taps to force selection and advance flow.
     */
    broadcastSelectionForced(payload: SelectionForcedPayload, lane: string) {
      broadcastToLane(createEvent('SELECTION_FORCED', payload), lane);
    },

    /**
     * Broadcast an assignment created event to a specific lane.
     * Called when a room or locker is successfully assigned.
     */
    broadcastAssignmentCreated(payload: AssignmentCreatedPayload, lane: string) {
      broadcastToLane(createEvent('ASSIGNMENT_CREATED', payload), lane);
    },

    /**
     * Broadcast an assignment failed event to a specific lane.
     * Called when assignment fails (e.g., race condition).
     */
    broadcastAssignmentFailed(payload: AssignmentFailedPayload, lane: string) {
      broadcastToLane(createEvent('ASSIGNMENT_FAILED', payload), lane);
    },

    /**
     * Broadcast a register session updated event globally.
     * Called when a register session is created, signed out, force signed out, or expires.
     */
    broadcastRegisterSessionUpdated(payload: RegisterSessionUpdatedPayload) {
      broadcast(createEvent('REGISTER_SESSION_UPDATED', payload));
    },

    getClientCount() {
      return clients.size;
    },
  };
}

// Note: Selection and waitlist events are broadcast via broadcastToLane
// using the generic broadcastToLane method, so no specific methods needed here
