import { useEffect, useMemo, useRef, useState } from 'react';
import { closeLaneSessionClient, getLaneSessionClient, type LaneRole } from './laneSessionClient.js';

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
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<MessageEvent | null>(null);
  const [lastError, setLastError] = useState<Event | null>(null);

  const stableKey = useMemo(() => `${laneId ?? ''}:${role}`, [laneId, role]);
  const prevRef = useRef<{ laneId?: string; role: LaneRole; enabled: boolean } | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    // Close ONLY when lane/role changes, or enabled flips to false.
    if (prev) {
      const laneChanged = prev.laneId !== laneId;
      const roleChanged = prev.role !== role;
      const disabledNow = prev.enabled === true && enabled === false;
      if ((laneChanged || roleChanged || disabledNow) && prev.laneId !== undefined) {
        closeLaneSessionClient(prev.laneId, prev.role);
      }
    }

    prevRef.current = { laneId, role, enabled };

    if (!enabled) return;
    if (laneId === undefined) return;

    // No socket creation during render; only inside effect.
    const socket = getLaneSessionClient({ laneId, role, kioskToken });

    const onOpen = () => setConnected(true);
    const onClose = (event: CloseEvent) => {
      void event;
      setConnected(false);
    };
    const onMessage = (event: MessageEvent) => setLastMessage(event);
    const onError = (event: Event) => setLastError(event);

    socket.addEventListener('open', onOpen);
    socket.addEventListener('close', onClose);
    socket.addEventListener('message', onMessage);
    socket.addEventListener('error', onError);

    return () => {
      socket.removeEventListener('open', onOpen);
      socket.removeEventListener('close', onClose);
      socket.removeEventListener('message', onMessage);
      socket.removeEventListener('error', onError);
    };
  }, [enabled, laneId, kioskToken, role, stableKey]);

  return { connected, lastMessage, lastError };
}

