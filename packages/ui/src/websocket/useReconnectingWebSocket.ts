import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getInstalledTelemetry } from '../telemetry/global';

export type ReconnectingWebSocketStatus = 'connecting' | 'open' | 'closed' | 'reconnecting';

export type UseReconnectingWebSocketOptions = {
  url: string;
  protocols?: string | string[];
  onMessage?: (event: MessageEvent) => void;
  onOpen?: () => void;
  onClose?: (ev: CloseEvent) => void;
  onError?: (ev: Event) => void;
  onOpenSendJson?: unknown[];
  autoReconnect?: boolean;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterMs?: number;
  maxRetries?: number;
  reconnectOnFocus?: boolean;
  reconnectOnOnline?: boolean;
  reconnectOnVisibility?: boolean;
  pingIntervalMs?: number;
  pingJson?: unknown;
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

function isSocketConnecting(ws: WebSocket | null): ws is WebSocket {
  return !!ws && ws.readyState === WebSocket.CONNECTING;
}

const recentCloseTimesByUrl = new Map<string, number[]>();
const lastReconnectLoopLogByUrl = new Map<string, number>();

export function useReconnectingWebSocket(
  options: UseReconnectingWebSocketOptions
): UseReconnectingWebSocketResult {
  const {
    url,
    protocols,
    autoReconnect = true,
    baseDelayMs = 250,
    maxDelayMs = 30_000,
    jitterMs = 250,
    maxRetries = Infinity,
    reconnectOnFocus = true,
    reconnectOnOnline = true,
    reconnectOnVisibility = true,
    pingIntervalMs = 0,
    pingJson = { type: 'ping' },
  } = options;

  const [status, setStatus] = useState<ReconnectingWebSocketStatus>('connecting');
  const [connected, setConnected] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [lastCloseEvent, setLastCloseEvent] = useState<CloseEvent | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const closedByUserRef = useRef(false);
  const stoppedRef = useRef(false);
  const retryCountRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const pingTimerRef = useRef<number | null>(null);
  const sendQueueRef = useRef<string[]>([]);

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

  const connectRef = useRef<(nextStatus: ReconnectingWebSocketStatus) => void>(() => {});

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current != null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const clearPingTimer = useCallback(() => {
    if (pingTimerRef.current != null) {
      window.clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
  }, []);

  const startPingTimerIfEnabled = useCallback(
    (ws: WebSocket) => {
      clearPingTimer();
      if (pingIntervalMs <= 0) return;
      if (ws.readyState !== WebSocket.OPEN) return;
      pingTimerRef.current = window.setInterval(() => {
        if (wsRef.current !== ws) return;
        if (ws.readyState !== WebSocket.OPEN) return;
        try {
          ws.send(JSON.stringify(pingJson));
        } catch {
          // ignore
        }
      }, pingIntervalMs);
    },
    [clearPingTimer, pingIntervalMs, pingJson]
  );

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

  const connect = useCallback(
    (nextStatus: ReconnectingWebSocketStatus) => {
      if (stoppedRef.current || closedByUserRef.current) return;

      const existing = wsRef.current;
      if (existing && (isSocketOpen(existing) || isSocketConnecting(existing)) && existing.url === url) {
        return;
      }

      clearReconnectTimer();
      clearPingTimer();

      setStatus(nextStatus);
      setConnected(false);

      const createdAt = Date.now();
      let openedAt: number | null = null;

      const ws = protocols ? new WebSocket(url, protocols) : new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (wsRef.current !== ws) return;
        openedAt = Date.now();
        retryCountRef.current = 0;
        setRetryCount(0);
        setLastCloseEvent(null);
        setStatus('open');
        setConnected(true);

        flushSendQueue(ws);

        const toSend = onOpenSendJsonRef.current ?? [];
        for (const msg of toSend) {
          try {
            ws.send(JSON.stringify(msg));
          } catch {
            // ignore
          }
        }

        startPingTimerIfEnabled(ws);
        onOpenRef.current?.();
      };

      ws.onmessage = (event) => {
        if (wsRef.current !== ws) return;
        onMessageRef.current?.(event);
      };

      ws.onerror = (ev) => {
        if (wsRef.current !== ws) return;
        try {
          getInstalledTelemetry()?.capture({
            level: 'error',
            kind: 'ws.error',
            message: 'WebSocket error',
            url,
            meta: {
              status: nextStatus,
              retryCount: retryCountRef.current,
              online: typeof navigator !== 'undefined' ? navigator.onLine : undefined,
            },
          });
        } catch {
          // ignore
        }
        onErrorRef.current?.(ev);
      };

      ws.onclose = (ev) => {
        if (wsRef.current !== ws) return;
        clearPingTimer();
        setConnected(false);
        setLastCloseEvent(ev);
        setStatus('closed');
        try {
          const now = Date.now();
          const durationMs = openedAt != null ? now - openedAt : now - createdAt;
          const closedBeforeOpen = openedAt == null;

          const list = recentCloseTimesByUrl.get(url) ?? [];
          list.push(now);
          const pruned = list.filter((t) => now - t <= 30_000);
          recentCloseTimesByUrl.set(url, pruned);

          getInstalledTelemetry()?.capture({
            level: closedBeforeOpen ? 'warn' : 'error',
            kind: closedBeforeOpen ? 'ws.closed_before_open' : 'ws.close',
            message: closedBeforeOpen ? 'WebSocket closed before open' : 'WebSocket closed',
            url,
            meta: {
              code: ev.code,
              reason: ev.reason,
              wasClean: ev.wasClean,
              durationMs,
              status: nextStatus,
              retryCount: retryCountRef.current,
              online: typeof navigator !== 'undefined' ? navigator.onLine : undefined,
            },
          });

          if (pruned.length >= 5) {
            const lastLogged = lastReconnectLoopLogByUrl.get(url) ?? 0;
            if (now - lastLogged > 30_000) {
              lastReconnectLoopLogByUrl.set(url, now);
              getInstalledTelemetry()?.capture({
                level: 'warn',
                kind: 'ws.reconnect_loop',
                message: 'WebSocket reconnect loop detected',
                url,
                meta: { closesIn30s: pruned.length },
              });
            }
          }
        } catch {
          // ignore
        }
        onCloseRef.current?.(ev);

        if (stoppedRef.current || closedByUserRef.current) return;
        if (!autoReconnect) return;
        if (retryCountRef.current >= maxRetries) return;

        const attempt = retryCountRef.current;
        const closedBeforeOpen = openedAt == null;
        const effectiveBaseDelayMs = closedBeforeOpen ? Math.max(baseDelayMs, 1000) : baseDelayMs;
        const delay =
          Math.min(maxDelayMs, effectiveBaseDelayMs * Math.pow(2, attempt)) +
          Math.floor(Math.random() * jitterMs);
        retryCountRef.current = attempt + 1;
        setRetryCount(retryCountRef.current);

        reconnectTimerRef.current = window.setTimeout(() => {
          reconnectTimerRef.current = null;
          connectRef.current('reconnecting');
        }, delay);
      };
    },
    [
      autoReconnect,
      baseDelayMs,
      clearPingTimer,
      clearReconnectTimer,
      flushSendQueue,
      jitterMs,
      maxDelayMs,
      maxRetries,
      protocols,
      startPingTimerIfEnabled,
      url,
    ]
  );

  connectRef.current = connect;

  const reconnectNow = useCallback(() => {
    if (stoppedRef.current) return;
    clearReconnectTimer();

    const existing = wsRef.current;
    if (existing && (isSocketOpen(existing) || isSocketConnecting(existing))) {
      // Ensure the close event from this socket doesn't schedule a reconnect.
      closedByUserRef.current = true;
      try {
        existing.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
      setConnected(false);
      setStatus('closed');
      // Allow new connections and reconnect immediately.
      closedByUserRef.current = false;
    }

    retryCountRef.current = 0;
    setRetryCount(0);
    connectRef.current('reconnecting');
  }, [clearReconnectTimer]);

  const sendJson = useCallback(
    (msg: unknown) => {
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
      if (stoppedRef.current || closedByUserRef.current) return;
      if (!isSocketConnecting(ws)) {
        connectRef.current(status === 'open' ? 'reconnecting' : status);
      }
    },
    [status]
  );

  const close = useCallback(() => {
    stoppedRef.current = true;
    closedByUserRef.current = true;
    clearReconnectTimer();
    clearPingTimer();
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws && (isSocketOpen(ws) || isSocketConnecting(ws))) {
      try {
        ws.close();
      } catch {
        // ignore
      }
    }
    setConnected(false);
    setStatus('closed');
  }, [clearPingTimer, clearReconnectTimer]);

  const focusHandlers = useMemo(() => {
    const maybeReconnect = () => {
      if (stoppedRef.current || closedByUserRef.current) return;
      if (!isSocketOpen(wsRef.current)) reconnectNow();
    };

    return {
      onFocus: () => {
        if (!reconnectOnFocus) return;
        maybeReconnect();
      },
      onOnline: () => {
        if (!reconnectOnOnline) return;
        maybeReconnect();
      },
      onVisibilityChange: () => {
        if (!reconnectOnVisibility) return;
        if (document.visibilityState !== 'visible') return;
        maybeReconnect();
      },
    };
  }, [reconnectNow, reconnectOnFocus, reconnectOnOnline, reconnectOnVisibility]);

  // Initial connect + url/protocol changes.
  useEffect(() => {
    stoppedRef.current = false;
    closedByUserRef.current = false;
    retryCountRef.current = 0;
    setRetryCount(0);
    connectRef.current('connecting');

    window.addEventListener('focus', focusHandlers.onFocus);
    window.addEventListener('online', focusHandlers.onOnline);
    document.addEventListener('visibilitychange', focusHandlers.onVisibilityChange);

    return () => {
      closedByUserRef.current = true;
      stoppedRef.current = true;
      clearReconnectTimer();
      clearPingTimer();

      window.removeEventListener('focus', focusHandlers.onFocus);
      window.removeEventListener('online', focusHandlers.onOnline);
      document.removeEventListener('visibilitychange', focusHandlers.onVisibilityChange);

      const ws = wsRef.current;
      wsRef.current = null;
      if (ws && (isSocketOpen(ws) || isSocketConnecting(ws))) {
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
    };
  }, [clearPingTimer, clearReconnectTimer, focusHandlers, url, protocols]);

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


