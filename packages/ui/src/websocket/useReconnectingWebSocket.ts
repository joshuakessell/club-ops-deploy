import { useCallback, useEffect, useRef, useState } from 'react';
import { closeLaneSessionClient, getLaneSessionClient } from '@club-ops/shared';
import { getInstalledTelemetry } from '../telemetry/global.js';

export type ReconnectingWebSocketStatus = 'connecting' | 'open' | 'closed' | 'reconnecting';

export type UseReconnectingWebSocketOptions = {
  url: string;
  protocols?: string | string[];
  onMessage?: (event: MessageEvent) => void;
  onOpen?: () => void;
  onClose?: (ev: CloseEvent) => void;
  onError?: (ev: Event) => void;
  onOpenSendJson?: unknown[];
  /**
   * Lane-scoped realtime connections are guarded and shared in `@club-ops/shared`.
   * This hook is now a thin subscription wrapper (no socket creation, no reconnect loops).
   */
  role?: 'customer' | 'employee';
};

export type UseReconnectingWebSocketResult = {
  socket: WebSocket | null;
  status: ReconnectingWebSocketStatus;
  connected: boolean;
  retryCount: number;
  lastCloseEvent: CloseEvent | null;
  sendJson: (msg: unknown) => void;
  reconnectNow: () => void;
  close: () => void;
};

export function safeJsonParse<T = unknown>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function isSocketOpen(ws: WebSocket | null): ws is WebSocket {
  return !!ws && ws.readyState === WebSocket.OPEN;
}

function extractLaneIdFromUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl, window.location.href);
    return url.searchParams.get('lane')?.trim() ?? '';
  } catch {
    return '';
  }
}

function extractKioskTokenFromProtocols(protocols?: string | string[]): string | null {
  const list =
    typeof protocols === 'string' ? [protocols] : Array.isArray(protocols) ? protocols : [];
  for (const p of list) {
    const s = String(p).trim();
    if (s.startsWith('kiosk-token.')) {
      const token = s.slice('kiosk-token.'.length).trim();
      return token || null;
    }
  }
  return null;
}

export function useReconnectingWebSocket(
  options: UseReconnectingWebSocketOptions
): UseReconnectingWebSocketResult {
  const { url, protocols, role = 'employee' } = options;

  const [status, setStatus] = useState<ReconnectingWebSocketStatus>('connecting');
  const [connected, setConnected] = useState(false);
  const [retryCount, setRetryCount] = useState(0); // shared module owns retries; we expose 0 for compatibility.
  const [lastCloseEvent, setLastCloseEvent] = useState<CloseEvent | null>(null);
  const [connectNonce, setConnectNonce] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const closedByUserRef = useRef(false);
  const sendQueueRef = useRef<string[]>([]);
  const unsubscribeRef = useRef<null | (() => void)>(null);

  const onMessageRef = useRef<UseReconnectingWebSocketOptions['onMessage']>();
  const onOpenRef = useRef<UseReconnectingWebSocketOptions['onOpen']>();
  const onCloseRef = useRef<UseReconnectingWebSocketOptions['onClose']>();
  const onErrorRef = useRef<UseReconnectingWebSocketOptions['onError']>();
  const onOpenSendJsonRef = useRef<unknown[] | undefined>();

  onMessageRef.current = options.onMessage;
  onOpenRef.current = options.onOpen;
  onCloseRef.current = options.onClose;
  onErrorRef.current = options.onError;
  onOpenSendJsonRef.current = options.onOpenSendJson;

  const flushSendQueue = useCallback((ws: WebSocket) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    const queued = sendQueueRef.current;
    if (queued.length === 0) return;
    sendQueueRef.current = [];
    for (const raw of queued) {
      try {
        ws.send(raw);
      } catch {
        // If send fails, re-queue and stop flushing.
        sendQueueRef.current.unshift(raw, ...sendQueueRef.current);
        break;
      }
    }
  }, []);

  const reconnectNow = useCallback(() => {
    // Explicit user action only: force a fresh guarded connection (no loops).
    const laneId = extractLaneIdFromUrl(url);
    closeLaneSessionClient(laneId, role);
    setRetryCount(0);
    setStatus('reconnecting');
    setConnectNonce((n) => n + 1);
  }, [role, url]);

  const sendJson = useCallback((msg: unknown) => {
    const raw = JSON.stringify(msg);
    const ws = wsRef.current;
    if (isSocketOpen(ws)) {
      try {
        ws.send(raw);
        return;
      } catch {
        // fall through to queue
      }
    }
    sendQueueRef.current.push(raw);
    if (closedByUserRef.current) return;
  }, []);

  const close = useCallback(() => {
    closedByUserRef.current = true;
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    const laneId = extractLaneIdFromUrl(url);
    closeLaneSessionClient(laneId, role);
    wsRef.current = null;
    setConnected(false);
    setStatus('closed');
  }, [role, url]);

  // Guarded connect + subscription (no socket creation, no reconnect loops).
  useEffect(() => {
    closedByUserRef.current = false;
    setRetryCount(0);
    setLastCloseEvent(null);

    unsubscribeRef.current?.();
    unsubscribeRef.current = null;

    const kioskToken = extractKioskTokenFromProtocols(protocols);
    if (!kioskToken) {
      // Fail-fast: without kiosk token we do not create a WebSocket and we do not retry.
      setStatus('closed');
      setConnected(false);
      wsRef.current = null;
      return;
    }

    const laneId = extractLaneIdFromUrl(url);
    setStatus('connecting');
    setConnected(false);

    let ws: WebSocket | null = null;
    try {
      ws = getLaneSessionClient({ laneId, role, kioskToken }) as unknown as WebSocket;
      wsRef.current = ws;
    } catch (err) {
      try {
        getInstalledTelemetry()?.capture({
          spanType: 'ws.guard_error',
          level: 'error',
          message: err instanceof Error ? err.message : 'Failed to init guarded WebSocket',
          url,
        });
      } catch {
        // ignore
      }
      setStatus('closed');
      setConnected(false);
      wsRef.current = null;
      return;
    }

    const onOpen = () => {
      const current = wsRef.current;
      if (!current || current !== ws) return;
      setStatus('open');
      setConnected(true);
      flushSendQueue(current);

      const toSend = onOpenSendJsonRef.current ?? [];
      for (const msg of toSend) {
        try {
          current.send(JSON.stringify(msg));
        } catch {
          // ignore
        }
      }
      onOpenRef.current?.();
    };

    const onMessage = (event: { data: unknown }) => {
      const current = wsRef.current;
      if (!current || current !== ws) return;
      onMessageRef.current?.({ data: event.data } as MessageEvent);
    };

    const onClose = (event: { code?: number; reason?: string }) => {
      const current = wsRef.current;
      if (!current || current !== ws) return;
      setConnected(false);
      setStatus('closed');
      setLastCloseEvent(event as unknown as CloseEvent);
      onCloseRef.current?.(event as unknown as CloseEvent);
    };

    const onError = (event: { type?: string }) => {
      const current = wsRef.current;
      if (!current || current !== ws) return;
      try {
        getInstalledTelemetry()?.capture({
          spanType: 'ws.error',
          level: 'error',
          message: 'WebSocket error',
          url,
          meta: { type: event.type },
        });
      } catch {
        // ignore
      }
      onErrorRef.current?.(event as unknown as Event);
    };

    ws.addEventListener('open', onOpen as unknown as (ev: Event) => void);
    ws.addEventListener('message', onMessage as unknown as (ev: MessageEvent) => void);
    ws.addEventListener('close', onClose as unknown as (ev: CloseEvent) => void);
    ws.addEventListener('error', onError as unknown as (ev: Event) => void);
    unsubscribeRef.current = () => {
      ws?.removeEventListener('open', onOpen as unknown as (ev: Event) => void);
      ws?.removeEventListener('message', onMessage as unknown as (ev: MessageEvent) => void);
      ws?.removeEventListener('close', onClose as unknown as (ev: CloseEvent) => void);
      ws?.removeEventListener('error', onError as unknown as (ev: Event) => void);
    };

    return () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
    };
  }, [connectNonce, flushSendQueue, protocols, role, url]);

  return {
    socket: wsRef.current,
    status,
    connected,
    retryCount,
    lastCloseEvent,
    sendJson,
    reconnectNow,
    close,
  };
}
