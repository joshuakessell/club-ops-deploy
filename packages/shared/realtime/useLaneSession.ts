import { useEffect, useRef, useState } from 'react';
import {
  closeLaneSessionClient,
  getLaneSessionClient,
  type LaneRole,
} from './laneSessionClient.js';

export function useLaneSession({
  laneId,
  role,
  kioskToken,
  enabled = true,
}: {
  laneId?: string;
  role: LaneRole;
  kioskToken: string;
  enabled?: boolean;
}): {
  connected: boolean;
  lastMessage: MessageEvent | null;
  lastError: Event | null;
} {
  const MAX_CONSECUTIVE_FAILURES = 3;
  const COOLDOWN_MS = 60_000;
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<MessageEvent | null>(null);
  const [lastError, setLastError] = useState<Event | null>(null);

  // Force a re-connect effect when we need to build a fresh socket and re-attach listeners.
  const [connectNonce, setConnectNonce] = useState(0);
  const retryCountRef = useRef(0);
  const consecutiveFailureRef = useRef(0);
  const hasEverConnectedRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedIntentionallyRef = useRef(false);

  useEffect(() => {
    consecutiveFailureRef.current = 0;
    hasEverConnectedRef.current = false;
    if (cooldownTimerRef.current) {
      clearTimeout(cooldownTimerRef.current);
      cooldownTimerRef.current = null;
    }
  }, [laneId, role, kioskToken]);

  // Ensure we don't keep background sockets alive when this hook is not mounted anymore,
  // or when the lane/role changes.
  useEffect(() => {
    return () => {
      if (laneId === undefined) return;
      closeLaneSessionClient(laneId, role);
    };
  }, [laneId, role]);

  useEffect(() => {
    if (!enabled || laneId === undefined) {
      closedIntentionallyRef.current = true;
      setConnected(false);
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (cooldownTimerRef.current) {
        clearTimeout(cooldownTimerRef.current);
        cooldownTimerRef.current = null;
      }
      if (laneId !== undefined) {
        closeLaneSessionClient(laneId, role);
      }
      return;
    }

    closedIntentionallyRef.current = false;

    const scheduleReconnect = () => {
      if (!enabled) return;
      if (closedIntentionallyRef.current) return;
      if (
        !hasEverConnectedRef.current &&
        consecutiveFailureRef.current >= MAX_CONSECUTIVE_FAILURES
      ) {
        if (cooldownTimerRef.current) return;
        cooldownTimerRef.current = setTimeout(() => {
          cooldownTimerRef.current = null;
          consecutiveFailureRef.current = 0;
          setConnectNonce((n) => n + 1);
        }, COOLDOWN_MS);
        return;
      }
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);

      const attempt = retryCountRef.current + 1;
      retryCountRef.current = attempt;

      const baseDelay = Math.min(30000, 500 * Math.pow(2, attempt - 1));
      const jitter = baseDelay * 0.2 * Math.random();
      const delayMs = Math.round(baseDelay + jitter);

      reconnectTimerRef.current = setTimeout(() => {
        setConnectNonce((n) => n + 1);
      }, delayMs);
    };

    // No socket creation during render; only inside effect.
    const socket = getLaneSessionClient({ laneId, role, kioskToken });

    const onOpen = () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (cooldownTimerRef.current) {
        clearTimeout(cooldownTimerRef.current);
        cooldownTimerRef.current = null;
      }
      retryCountRef.current = 0;
      consecutiveFailureRef.current = 0;
      hasEverConnectedRef.current = true;
      setConnected(true);
    };
    const onClose = (event: CloseEvent) => {
      void event;
      setConnected(false);
      if (!hasEverConnectedRef.current) {
        consecutiveFailureRef.current += 1;
      } else {
        consecutiveFailureRef.current = 0;
      }
      scheduleReconnect();
    };
    const onMessage = (event: MessageEvent) => setLastMessage(event);
    const onError = (event: Event) => setLastError(event);

    socket.addEventListener('open', onOpen);
    socket.addEventListener('close', onClose);
    socket.addEventListener('message', onMessage);
    socket.addEventListener('error', onError);

    // If the socket is already open by the time we subscribe, reflect it immediately.
    if (socket.readyState === WebSocket.OPEN) {
      onOpen();
    } else if (socket.readyState !== WebSocket.CONNECTING) {
      setConnected(false);
      scheduleReconnect();
    }

    return () => {
      socket.removeEventListener('open', onOpen);
      socket.removeEventListener('close', onClose);
      socket.removeEventListener('message', onMessage);
      socket.removeEventListener('error', onError);

      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [connectNonce, enabled, laneId, kioskToken, role]);

  return { connected, lastMessage, lastError };
}
