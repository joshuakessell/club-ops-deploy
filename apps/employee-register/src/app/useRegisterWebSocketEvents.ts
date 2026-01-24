import { useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import {
  safeParseWebSocketEvent,
  type AssignmentFailedPayload,
  type CheckoutChecklist,
  type CheckoutRequestSummary,
  type SessionUpdatedPayload,
  useLaneSession,
} from '@club-ops/shared';
import { safeJsonParse } from '@club-ops/ui';
import type { BottomToastTone } from '../components/register/toasts/BottomToastStack';
import { getWebSocketUrl } from '@club-ops/shared';

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
  const wsUrl = getWebSocketUrl(`/ws?lane=${encodeURIComponent(lane)}`);
  const rawEnv = import.meta.env as unknown as Record<string, unknown>;
  const kioskToken =
    typeof rawEnv.VITE_KIOSK_TOKEN === 'string' && rawEnv.VITE_KIOSK_TOKEN.trim()
      ? rawEnv.VITE_KIOSK_TOKEN.trim()
      : null;
  void wsUrl;

  const { connected, lastMessage } = useLaneSession({
    laneId: lane,
    role: 'employee',
    kioskToken: kioskToken ?? '',
    enabled: true,
  });

  // Keep the latest callbacks/stateful refs without re-processing the same WS message on every render.
  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  useEffect(() => {
    if (!lastMessage) return;
    const event = lastMessage;
    try {
      const parsed: unknown = safeJsonParse(String(event.data));
      const message = safeParseWebSocketEvent(parsed);
      if (!message) return;

        const p = paramsRef.current;
        if (message.type === 'CHECKOUT_REQUESTED') {
          const payload = message.payload;
          p.setCheckoutRequests((prev) => {
            const next = new Map(prev);
            next.set(payload.request.requestId, payload.request);
            return next;
          });
        } else if (message.type === 'CHECKOUT_CLAIMED') {
          const payload = message.payload;
          p.setCheckoutRequests((prev) => {
            const next = new Map(prev);
            next.delete(payload.requestId);
            return next;
          });
        } else if (message.type === 'CHECKOUT_UPDATED') {
          const payload = message.payload;
          if (p.selectedCheckoutRequestRef.current === payload.requestId) {
            p.setCheckoutItemsConfirmed(payload.itemsConfirmed);
            p.setCheckoutFeePaid(payload.feePaid);
          }
        } else if (message.type === 'CHECKOUT_COMPLETED') {
          const payload = message.payload;
          p.setCheckoutRequests((prev) => {
            const next = new Map(prev);
            next.delete(payload.requestId);
            return next;
          });
          if (p.selectedCheckoutRequestRef.current === payload.requestId) {
            p.setSelectedCheckoutRequest(null);
            p.setCheckoutChecklist({});
            p.setCheckoutItemsConfirmed(false);
            p.setCheckoutFeePaid(false);
          }
        } else if (message.type === 'SESSION_UPDATED') {
          const payload = message.payload;
          p.laneSessionActions.applySessionUpdated(payload);
          if (payload?.status === 'COMPLETED' && (!payload.customerName || payload.customerName === '')) {
            p.onLaneSessionCleared();
          }
        } else if (message.type === 'WAITLIST_UPDATED') {
          p.onWaitlistUpdated();
        } else if (message.type === 'UPGRADE_HOLD_AVAILABLE') {
          const payload = message.payload;
          p.pushBottomToast({
            message: `Room ${payload.roomNumber} available for ${payload.customerName}'s ${payload.desiredTier} upgrade.`,
            tone: 'warning',
          });
          p.onWaitlistUpdated();
        } else if (message.type === 'UPGRADE_OFFER_EXPIRED') {
          const payload = message.payload;
          p.pushBottomToast({
            message: `Upgrade offer expired for ${payload.customerName}.`,
            tone: 'warning',
          });
          p.onWaitlistUpdated();
        } else if (message.type === 'SELECTION_PROPOSED') {
          const payload = message.payload;
          if (payload.sessionId === p.currentSessionIdRef.current) {
            p.laneSessionActions.applySelectionProposed({
              rentalType: payload.rentalType,
              proposedBy: payload.proposedBy,
            });
          }
        } else if (message.type === 'SELECTION_LOCKED') {
          const payload = message.payload;
          if (payload.sessionId === p.currentSessionIdRef.current) {
            p.laneSessionActions.applySelectionLocked({
              rentalType: payload.rentalType,
              confirmedBy: payload.confirmedBy,
            });
          }
        } else if (message.type === 'SELECTION_FORCED') {
          const payload = message.payload;
          if (payload.sessionId === p.currentSessionIdRef.current) {
            p.laneSessionActions.applySelectionForced({ rentalType: payload.rentalType });
          }
        } else if (message.type === 'SELECTION_ACKNOWLEDGED') {
          p.laneSessionActions.selectionAcknowledged();
        } else if (message.type === 'INVENTORY_UPDATED' || message.type === 'ROOM_STATUS_CHANGED') {
          p.onInventoryUpdated();
        } else if (message.type === 'ASSIGNMENT_FAILED') {
          const payload = message.payload;
          if (payload.sessionId === p.currentSessionIdRef.current) {
            p.onAssignmentFailed(payload);
          }
        } else if (message.type === 'CUSTOMER_CONFIRMED') {
          const payload = message.payload;
          if (payload.sessionId === p.currentSessionIdRef.current) {
            p.onCustomerConfirmed();
          }
        } else if (message.type === 'CUSTOMER_DECLINED') {
          const payload = message.payload;
          if (payload.sessionId === p.currentSessionIdRef.current) {
            p.onCustomerDeclined();
          }
        }
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
    }
  }, [lastMessage]);

  return { connected };
}

