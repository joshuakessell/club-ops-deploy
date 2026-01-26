import { useEffect, useRef } from 'react';
import { safeParseWebSocketEvent, useLaneSession } from '@club-ops/shared';
import { safeJsonParse } from '@club-ops/ui';
import { getWebSocketUrl } from '@club-ops/shared';
import {
  applyRegisterWebSocketEvent,
  type RegisterWebSocketParams,
} from './registerWebSocketHandlers';

export function useRegisterWebSocketEvents(params: RegisterWebSocketParams): {
  connected: boolean;
} {
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

  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  useEffect(() => {
    if (!lastMessage) return;
    try {
      const parsed: unknown = safeJsonParse(String(lastMessage.data));
      const message = safeParseWebSocketEvent(parsed);
      if (!message) return;
      applyRegisterWebSocketEvent(message, paramsRef.current);
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
    }
  }, [lastMessage]);

  return { connected };
}
