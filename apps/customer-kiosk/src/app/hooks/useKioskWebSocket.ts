import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import {
  safeParseWebSocketEvent,
  SessionUpdatedPayloadSchema,
  useLaneSession,
  type CustomerConfirmationRequiredPayload,
  type SessionUpdatedPayload,
} from '@club-ops/shared';
import { isRecord, readJson, safeJsonParse } from '@club-ops/ui';
import type { SessionState } from '../../utils/membership';

export function useKioskWebSocket({
  lane,
  kioskToken,
  sessionIdRef,
  applySessionUpdatedPayload,
  setProposedRentalType,
  setProposedBy,
  setSelectionConfirmed,
  setSelectionConfirmedBy,
  setSelectedRental,
  setSelectionAcknowledged,
  setHighlightedLanguage,
  setHighlightedMembershipChoice,
  setHighlightedWaitlistBackup,
  setCustomerConfirmationData,
  setShowCustomerConfirmation,
  setSession,
  setView,
  applyInventoryUpdate,
  resetToIdle,
  apiBase,
  kioskAuthHeaders,
}: {
  lane: string | null;
  kioskToken: string | null;
  sessionIdRef: MutableRefObject<string | null>;
  applySessionUpdatedPayload: (payload: SessionUpdatedPayload) => void;
  setProposedRentalType: (value: string | null) => void;
  setProposedBy: (value: 'CUSTOMER' | 'EMPLOYEE' | null) => void;
  setSelectionConfirmed: (value: boolean) => void;
  setSelectionConfirmedBy: (value: 'CUSTOMER' | 'EMPLOYEE' | null) => void;
  setSelectedRental: (value: string | null) => void;
  setSelectionAcknowledged: (value: boolean) => void;
  setHighlightedLanguage: (value: 'EN' | 'ES' | null) => void;
  setHighlightedMembershipChoice: (value: 'ONE_TIME' | 'SIX_MONTH' | null) => void;
  setHighlightedWaitlistBackup: (value: string | null) => void;
  setCustomerConfirmationData: (value: CustomerConfirmationRequiredPayload | null) => void;
  setShowCustomerConfirmation: (value: boolean) => void;
  setSession: Dispatch<SetStateAction<SessionState>>;
  setView: (view: 'idle' | 'language' | 'selection' | 'payment' | 'agreement' | 'agreement-bypass' | 'complete') => void;
  applyInventoryUpdate: (payload: unknown) => void;
  resetToIdle: () => void;
  apiBase: string;
  kioskAuthHeaders: (extra?: Record<string, string>) => Record<string, string>;
}) {
  const { connected: wsConnected, lastMessage } = useLaneSession({
    laneId: lane ?? undefined,
    role: 'customer',
    kioskToken: kioskToken ?? '',
    enabled: Boolean(lane),
  });

  const onWsMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const parsed: unknown = safeJsonParse(String(event.data));
        const message = safeParseWebSocketEvent(parsed);
        if (!message) return;
        console.log('WebSocket message:', message);

        if (message.type === 'SESSION_UPDATED') {
          applySessionUpdatedPayload(message.payload);
        } else if (message.type === 'SELECTION_PROPOSED') {
          const payload = message.payload;
          if (payload.sessionId === sessionIdRef.current) {
            setProposedRentalType(payload.rentalType);
            setProposedBy(payload.proposedBy);
          }
        } else if (message.type === 'SELECTION_LOCKED') {
          const payload = message.payload;
          if (payload.sessionId === sessionIdRef.current) {
            setSelectionConfirmed(true);
            setSelectionConfirmedBy(payload.confirmedBy);
            setSelectedRental(payload.rentalType);
            setSelectionAcknowledged(true);
            setView('payment');
          }
        } else if (message.type === 'SELECTION_FORCED') {
          const payload = message.payload;
          if (payload.sessionId === sessionIdRef.current) {
            setSelectionConfirmed(true);
            setSelectionConfirmedBy('EMPLOYEE');
            setSelectedRental(payload.rentalType);
            setSelectionAcknowledged(true);
            setView('payment');
          }
        } else if (message.type === 'SELECTION_ACKNOWLEDGED') {
          setSelectionAcknowledged(true);
        } else if (message.type === 'CHECKIN_OPTION_HIGHLIGHTED') {
          const payload = message.payload;
          if (payload.sessionId !== sessionIdRef.current) return;
          if (payload.step === 'LANGUAGE') {
            const opt = payload.option === 'EN' || payload.option === 'ES' ? payload.option : null;
            setHighlightedLanguage(opt);
          } else if (payload.step === 'MEMBERSHIP') {
            const opt =
              payload.option === 'ONE_TIME' || payload.option === 'SIX_MONTH'
                ? payload.option
                : null;
            setHighlightedMembershipChoice(opt);
          } else if (payload.step === 'WAITLIST_BACKUP') {
            setHighlightedWaitlistBackup(payload.option);
          }
        } else if (message.type === 'CUSTOMER_CONFIRMATION_REQUIRED') {
          const payload = message.payload;
          setCustomerConfirmationData(payload);
          setShowCustomerConfirmation(true);
        } else if (message.type === 'ASSIGNMENT_CREATED') {
          const payload = message.payload;
          if (payload.sessionId === sessionIdRef.current) {
            const assignedResourceType = payload.roomNumber
              ? 'room'
              : payload.lockerNumber
                ? 'locker'
                : undefined;
            const assignedResourceNumber = payload.roomNumber ?? payload.lockerNumber;
            if (assignedResourceType && assignedResourceNumber) {
              setSession((prev) => ({
                ...prev,
                assignedResourceType,
                assignedResourceNumber,
              }));
              setView('complete');
            }
          }
        } else if (message.type === 'INVENTORY_UPDATED') {
          applyInventoryUpdate(message.payload);
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    },
    [
      applyInventoryUpdate,
      applySessionUpdatedPayload,
      sessionIdRef,
      setCustomerConfirmationData,
      setHighlightedLanguage,
      setHighlightedMembershipChoice,
      setHighlightedWaitlistBackup,
      setProposedBy,
      setProposedRentalType,
      setSelectionAcknowledged,
      setSelectionConfirmed,
      setSelectionConfirmedBy,
      setSelectedRental,
      setSession,
      setShowCustomerConfirmation,
      setView,
    ]
  );

  useEffect(() => {
    if (!lastMessage) return;
    onWsMessage(lastMessage);
  }, [lastMessage, onWsMessage]);

  const pollingStartedRef = useRef(false);
  const pollingDelayTimerRef = useRef<number | null>(null);
  const pollingIntervalRef = useRef<number | null>(null);
  useEffect(() => {
    const laneId = lane;
    if (!laneId) return;
    if (pollingDelayTimerRef.current !== null) {
      window.clearTimeout(pollingDelayTimerRef.current);
      pollingDelayTimerRef.current = null;
    }
    if (pollingIntervalRef.current !== null) {
      window.clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    pollingStartedRef.current = false;

    if (wsConnected) return;

    pollingDelayTimerRef.current = window.setTimeout(() => {
      if (wsConnected) return;
      if (!pollingStartedRef.current) {
        pollingStartedRef.current = true;
        console.info('[customer-kiosk] WS disconnected; entering polling fallback');
      }

      const pollOnce = async () => {
        try {
          const res = await fetch(
            `${apiBase}/v1/checkin/lane/${encodeURIComponent(laneId)}/session-snapshot`,
            { headers: kioskAuthHeaders() }
          );
          if (!res.ok) return;
          const data = await readJson<unknown>(res);
          if (!isRecord(data)) return;
          const sessionPayload = data['session'];
          if (sessionPayload == null) {
            resetToIdle();
            return;
          }
          if (isRecord(sessionPayload)) {
            const parsedPayload = SessionUpdatedPayloadSchema.safeParse(sessionPayload);
            if (parsedPayload.success) {
              applySessionUpdatedPayload(parsedPayload.data);
            }
          }
        } catch {
          // Best-effort; keep polling.
        }
      };

      void pollOnce();
      pollingIntervalRef.current = window.setInterval(() => {
        void pollOnce();
      }, 1500);
    }, 1200);

    return () => {
      if (pollingDelayTimerRef.current !== null) {
        window.clearTimeout(pollingDelayTimerRef.current);
        pollingDelayTimerRef.current = null;
      }
      if (pollingIntervalRef.current !== null) {
        window.clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      pollingStartedRef.current = false;
    };
  }, [apiBase, applySessionUpdatedPayload, kioskAuthHeaders, lane, resetToIdle, wsConnected]);

  return { wsConnected };
}
