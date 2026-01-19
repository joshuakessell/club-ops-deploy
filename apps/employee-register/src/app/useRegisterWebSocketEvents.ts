import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import {
  safeParseWebSocketEvent,
  type AssignmentFailedPayload,
  type CheckoutChecklist,
  type CheckoutRequestSummary,
  type SessionUpdatedPayload,
} from '@club-ops/shared';
import { safeJsonParse, useReconnectingWebSocket } from '@club-ops/ui';
import type { BottomToastTone } from '../components/register/toasts/BottomToastStack';

export function useRegisterWebSocketEvents(params: {
  lane: string;
  currentSessionIdRef: MutableRefObject<string | null>;
  selectedCheckoutRequestRef: MutableRefObject<string | null>;
  customerSelectedTypeRef: MutableRefObject<string | null>;

  // lane session reducer actions
  laneSessionActions: {
    applySessionUpdated: (payload: SessionUpdatedPayload) => void;
    applySelectionProposed: (payload: { rentalType: string; proposedBy: 'CUSTOMER' | 'EMPLOYEE' }) => void;
    applySelectionLocked: (payload: { rentalType: string; confirmedBy: 'CUSTOMER' | 'EMPLOYEE' }) => void;
    applySelectionForced: (payload: { rentalType: string }) => void;
    selectionAcknowledged: () => void;
  };

  // checkout request state (kept outside reducer)
  setCheckoutRequests: Dispatch<SetStateAction<Map<string, CheckoutRequestSummary>>>;
  setCheckoutItemsConfirmed: Dispatch<SetStateAction<boolean>>;
  setCheckoutFeePaid: Dispatch<SetStateAction<boolean>>;
  setSelectedCheckoutRequest: Dispatch<SetStateAction<string | null>>;
  setCheckoutChecklist: Dispatch<SetStateAction<CheckoutChecklist>>;

  // other UI state effects
  onWaitlistUpdated: () => void;
  onInventoryUpdated: () => void;
  onLaneSessionCleared: () => void;
  pushBottomToast: (toast: { message: string; tone?: BottomToastTone }) => void;
  onAssignmentFailed: (payload: AssignmentFailedPayload) => void;
  onCustomerConfirmed: () => void;
  onCustomerDeclined: () => void;
}): { connected: boolean } {
  const { lane } = params;
  const wsScheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsScheme}//${window.location.host}/ws?lane=${encodeURIComponent(lane)}`;

  const ws = useReconnectingWebSocket({
    url: wsUrl,
    onOpenSendJson: [
      {
        type: 'subscribe',
        events: [
          'CHECKOUT_REQUESTED',
          'CHECKOUT_CLAIMED',
          'CHECKOUT_UPDATED',
          'CHECKOUT_COMPLETED',
          'SESSION_UPDATED',
          'ROOM_STATUS_CHANGED',
          'INVENTORY_UPDATED',
          'ASSIGNMENT_CREATED',
          'ASSIGNMENT_FAILED',
          'CUSTOMER_CONFIRMED',
          'CUSTOMER_DECLINED',
          'WAITLIST_UPDATED',
          'SELECTION_PROPOSED',
          'SELECTION_LOCKED',
          'SELECTION_ACKNOWLEDGED',
          'SELECTION_FORCED',
          'UPGRADE_HOLD_AVAILABLE',
          'UPGRADE_OFFER_EXPIRED',
        ],
      },
    ],
    onMessage: (event) => {
      try {
        const parsed: unknown = safeJsonParse(String(event.data));
        const message = safeParseWebSocketEvent(parsed);
        if (!message) return;

        if (message.type === 'CHECKOUT_REQUESTED') {
          const payload = message.payload;
          params.setCheckoutRequests((prev) => {
            const next = new Map(prev);
            next.set(payload.request.requestId, payload.request);
            return next;
          });
        } else if (message.type === 'CHECKOUT_CLAIMED') {
          const payload = message.payload;
          params.setCheckoutRequests((prev) => {
            const next = new Map(prev);
            next.delete(payload.requestId);
            return next;
          });
        } else if (message.type === 'CHECKOUT_UPDATED') {
          const payload = message.payload;
          if (params.selectedCheckoutRequestRef.current === payload.requestId) {
            params.setCheckoutItemsConfirmed(payload.itemsConfirmed);
            params.setCheckoutFeePaid(payload.feePaid);
          }
        } else if (message.type === 'CHECKOUT_COMPLETED') {
          const payload = message.payload;
          params.setCheckoutRequests((prev) => {
            const next = new Map(prev);
            next.delete(payload.requestId);
            return next;
          });
          if (params.selectedCheckoutRequestRef.current === payload.requestId) {
            params.setSelectedCheckoutRequest(null);
            params.setCheckoutChecklist({});
            params.setCheckoutItemsConfirmed(false);
            params.setCheckoutFeePaid(false);
          }
        } else if (message.type === 'SESSION_UPDATED') {
          const payload = message.payload;
          params.laneSessionActions.applySessionUpdated(payload);
          if (payload?.status === 'COMPLETED' && (!payload.customerName || payload.customerName === '')) {
            params.onLaneSessionCleared();
          }
        } else if (message.type === 'WAITLIST_UPDATED') {
          params.onWaitlistUpdated();
        } else if (message.type === 'UPGRADE_HOLD_AVAILABLE') {
          const payload = message.payload;
          params.pushBottomToast({
            message: `Room ${payload.roomNumber} available for ${payload.customerName}'s ${payload.desiredTier} upgrade.`,
            tone: 'warning',
          });
          params.onWaitlistUpdated();
        } else if (message.type === 'UPGRADE_OFFER_EXPIRED') {
          const payload = message.payload;
          params.pushBottomToast({
            message: `Upgrade offer expired for ${payload.customerName}.`,
            tone: 'warning',
          });
          params.onWaitlistUpdated();
        } else if (message.type === 'SELECTION_PROPOSED') {
          const payload = message.payload;
          if (payload.sessionId === params.currentSessionIdRef.current) {
            params.laneSessionActions.applySelectionProposed({
              rentalType: payload.rentalType,
              proposedBy: payload.proposedBy,
            });
          }
        } else if (message.type === 'SELECTION_LOCKED') {
          const payload = message.payload;
          if (payload.sessionId === params.currentSessionIdRef.current) {
            params.laneSessionActions.applySelectionLocked({
              rentalType: payload.rentalType,
              confirmedBy: payload.confirmedBy,
            });
          }
        } else if (message.type === 'SELECTION_FORCED') {
          const payload = message.payload;
          if (payload.sessionId === params.currentSessionIdRef.current) {
            params.laneSessionActions.applySelectionForced({ rentalType: payload.rentalType });
          }
        } else if (message.type === 'SELECTION_ACKNOWLEDGED') {
          params.laneSessionActions.selectionAcknowledged();
        } else if (message.type === 'INVENTORY_UPDATED' || message.type === 'ROOM_STATUS_CHANGED') {
          params.onInventoryUpdated();
        } else if (message.type === 'ASSIGNMENT_FAILED') {
          const payload = message.payload;
          if (payload.sessionId === params.currentSessionIdRef.current) {
            params.onAssignmentFailed(payload);
          }
        } else if (message.type === 'CUSTOMER_CONFIRMED') {
          const payload = message.payload;
          if (payload.sessionId === params.currentSessionIdRef.current) {
            params.onCustomerConfirmed();
          }
        } else if (message.type === 'CUSTOMER_DECLINED') {
          const payload = message.payload;
          if (payload.sessionId === params.currentSessionIdRef.current) {
            params.onCustomerDeclined();
          }
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    },
  });

  return { connected: ws.connected };
}

