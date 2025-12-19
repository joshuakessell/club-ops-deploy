import type { WebSocket } from 'ws';
import type { 
  WebSocketEventType, 
  WebSocketEvent,
  RoomStatusChangedPayload,
  InventoryUpdatedPayload,
  SessionUpdatedPayload,
} from '@club-ops/shared';

/**
 * Room assignment event payload.
 */
export interface RoomAssignedPayload {
  roomId: string;
  sessionId: string;
  memberId: string;
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
  | SessionUpdatedPayload;

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
 * Follows AGENTS.md requirement: "Realtime is push-based"
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

    getClientCount() {
      return clients.size;
    },
  };
}
