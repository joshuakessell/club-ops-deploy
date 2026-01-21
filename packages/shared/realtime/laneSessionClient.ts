export type LaneRole = 'customer' | 'employee';

export interface LaneSessionClientOptions {
  laneId: string;
  role: LaneRole;
  kioskToken: string;
  onMessage?: (event: MessageEvent) => void;
  onOpen?: () => void;
  onClose?: (event: CloseEvent) => void;
  onError?: (event: Event) => void;
}

interface InternalClient {
  socket: WebSocket;
  retries: number;
  retryTimer?: ReturnType<typeof setTimeout>;
}

// Internal state
const clients = new Map<string, InternalClient>();

// Constants
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 1000;

const loggedCreated = new Set<string>();
const loggedReused = new Set<string>();
const loggedClosed = new Set<string>();
const loggedRetryExhausted = new Set<string>();
const loggedAuthFailure = new Set<string>();

function keyFor(laneId: string, role: LaneRole): string {
  return `${laneId}:${role}`;
}

function assertKioskToken(kioskToken: string): void {
  if (!kioskToken || !kioskToken.trim()) {
    throw new Error('Missing kioskToken for lane session WebSocket');
  }
}

function buildWsUrl({ laneId, role }: { laneId: string; role: LaneRole }): string {
  // Existing repo convention: connect to the current Vite origin and rely on /ws proxying to the API.
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const base = `${scheme}//${window.location.host}/ws`;
  const params = new URLSearchParams();
  if (laneId) params.set('lane', laneId);
  params.set('role', role);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

function isAuthFailure(event: CloseEvent): boolean {
  // Best-effort heuristics. Browsers often surface auth handshake failures as code 1006 with empty reason.
  const code = event.code;
  const reason = (event.reason || '').toLowerCase();
  if (code === 1008) return true; // policy violation
  if (reason.includes('auth')) return true;
  if (reason.includes('unauthorized')) return true;
  if (reason.includes('forbidden')) return true;
  if (reason.includes('401')) return true;
  if (reason.includes('403')) return true;
  return false;
}

function createSocket(options: LaneSessionClientOptions): WebSocket {
  const url = buildWsUrl({ laneId: options.laneId, role: options.role });
  // Browser WebSockets can't set headers; repo convention uses subprotocol for kiosk token.
  const protocols = [`kiosk-token.${options.kioskToken}`];
  const socket = new WebSocket(url, protocols);

  if (!loggedCreated.has(keyFor(options.laneId, options.role))) {
    loggedCreated.add(keyFor(options.laneId, options.role));
    console.info('[realtime] LaneSessionClient created', { key: keyFor(options.laneId, options.role) });
  }

  socket.onopen = () => {
    options.onOpen?.();
  };
  socket.onmessage = (event) => {
    options.onMessage?.(event);
  };
  socket.onerror = (event) => {
    options.onError?.(event);
  };
  socket.onclose = (event) => {
    options.onClose?.(event);
  };

  return socket;
}

function attachCloseHandler(key: string, options: LaneSessionClientOptions, socket: WebSocket): void {
  socket.onclose = (event) => {
    options.onClose?.(event);

    if (isAuthFailure(event)) {
      if (!loggedAuthFailure.has(key)) {
        loggedAuthFailure.add(key);
        console.error('[realtime] LaneSessionClient auth failure (no retry)', { key, code: event.code });
      }
      const existing = clients.get(key);
      if (existing?.retryTimer) {
        clearTimeout(existing.retryTimer);
      }
      clients.delete(key);
      return;
    }

    const current = clients.get(key);
    if (!current) return;

    if (current.retries >= MAX_RETRIES) {
      if (!loggedRetryExhausted.has(key)) {
        loggedRetryExhausted.add(key);
        console.error('[realtime] LaneSessionClient retries exhausted (permanent close)', { key });
      }
      if (current.retryTimer) clearTimeout(current.retryTimer);
      clients.delete(key);
      return;
    }

    current.retries += 1;
    if (current.retryTimer) clearTimeout(current.retryTimer);
    current.retryTimer = setTimeout(() => {
      const still = clients.get(key);
      if (!still) return;
      const next = createSocket(options);
      // Replace the socket reference in InternalClient
      still.socket = next;
      attachCloseHandler(key, options, next);
    }, RETRY_DELAY_MS);
  };
}

export function getLaneSessionClient(options: LaneSessionClientOptions): WebSocket {
  // Implement in exact order
  const key = keyFor(options.laneId, options.role);

  const existing = clients.get(key);
  if (existing) {
    if (!loggedReused.has(key)) {
      loggedReused.add(key);
      console.info('[realtime] LaneSessionClient reused', { key });
    }
    return existing.socket;
  }

  assertKioskToken(options.kioskToken);

  const socket = createSocket(options);

  const internal: InternalClient = { socket, retries: 0 };
  clients.set(key, internal);

  // Reconnect logic (only here)
  attachCloseHandler(key, options, socket);

  return socket;
}

export function closeLaneSessionClient(laneId: string, role: LaneRole): void {
  const key = keyFor(laneId, role);
  const client = clients.get(key);
  if (!client) return;

  if (client.retryTimer) {
    clearTimeout(client.retryTimer);
    client.retryTimer = undefined;
  }

  try {
    if (client.socket.readyState === WebSocket.OPEN) {
      client.socket.close();
    } else {
      // Best-effort close in any non-closed state
      client.socket.close();
    }
  } catch {
    // ignore
  }

  clients.delete(key);

  if (!loggedClosed.has(key)) {
    loggedClosed.add(key);
    console.info('[realtime] LaneSessionClient closed', { key });
  }
}

/**
 * Test helper: closes and clears ALL cached lane session clients (and retry timers).
 *
 * In app code, clients are intentionally cached globally to allow reuse across screens.
 * In tests, this caching can keep timers/sockets alive after a test completes, which
 * prevents Vitest from exiting cleanly.
 */
export function closeAllLaneSessionClients(): void {
  for (const [key, client] of clients.entries()) {
    if (client.retryTimer) {
      clearTimeout(client.retryTimer);
      client.retryTimer = undefined;
    }

    try {
      client.socket.close();
    } catch {
      // ignore
    }

    clients.delete(key);
  }
}
