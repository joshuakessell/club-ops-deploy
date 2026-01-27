export type LaneRole = 'customer' | 'employee';

export interface LaneSessionClientOptions {
  laneId: string;
  role: LaneRole;
  kioskToken: string;
  /**
   * Deprecated: consumers should attach listeners on the returned WebSocket instance.
   * These are kept only for backwards compatibility with older callers.
   */
  onMessage?: (event: MessageEvent) => void;
  /** @deprecated */
  onOpen?: () => void;
  /** @deprecated */
  onClose?: (event: CloseEvent) => void;
  /** @deprecated */
  onError?: (event: Event) => void;
}

interface InternalClient {
  socket: WebSocket;
}

// Internal state
const clients = new Map<string, InternalClient>();

const loggedCreated = new Set<string>();
const loggedReused = new Set<string>();
const loggedClosed = new Set<string>();

function keyFor(laneId: string, role: LaneRole): string {
  return `${laneId}:${role}`;
}

function assertKioskToken(kioskToken: string): void {
  if (!kioskToken || !kioskToken.trim()) {
    throw new Error('Missing kioskToken for lane session WebSocket');
  }
}

function getViteEnvString(key: string): string | undefined {
  // Vite injects env at build-time as `import.meta.env.*` (browser-safe). Keep this typed and optional.
  const env = (import.meta as unknown as { env?: Record<string, unknown> }).env;
  const value = env?.[key];
  return typeof value === 'string' ? value : undefined;
}

function normalizeApiBaseUrl(raw: string): string {
  let s = raw.trim();
  // Remove trailing slashes.
  while (s.endsWith('/')) s = s.slice(0, -1);
  // If it ends with "/api", strip it (repo convention expects host root).
  if (s.toLowerCase().endsWith('/api')) {
    s = s.slice(0, -4);
  }
  // Remove any trailing slashes again after stripping "/api".
  while (s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

function toWsBaseUrl(httpBase: string): string {
  const s = httpBase.trim();
  if (s.startsWith('ws://') || s.startsWith('wss://')) return s;
  if (s.startsWith('https://')) return `wss://${s.slice('https://'.length)}`;
  if (s.startsWith('http://')) return `ws://${s.slice('http://'.length)}`;
  return s;
}

function buildWsUrl({ laneId, role }: { laneId: string; role: LaneRole }): string {
  // Prefer an explicit API base URL in production (e.g. Vercel -> Render) and only fall back to
  // same-origin `/ws` for local dev where Vite proxies `/ws` to the API.
  const rawApiBase = getViteEnvString('VITE_API_BASE_URL');
  const base =
    rawApiBase && normalizeApiBaseUrl(rawApiBase)
      ? `${toWsBaseUrl(normalizeApiBaseUrl(rawApiBase))}/ws`
      : (() => {
          // Existing repo convention: connect to the current origin and rely on /ws proxying to the API.
          const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          return `${scheme}//${window.location.host}/ws`;
        })();
  const params = new URLSearchParams();
  if (laneId) params.set('lane', laneId);
  params.set('role', role);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

function createSocket(options: LaneSessionClientOptions): WebSocket {
  const url = buildWsUrl({ laneId: options.laneId, role: options.role });
  // Browser WebSockets can't set headers; repo convention uses subprotocol for kiosk token.
  const protocols = [`kiosk-token.${options.kioskToken}`];
  const socket = new WebSocket(url, protocols);

  if (!loggedCreated.has(keyFor(options.laneId, options.role))) {
    loggedCreated.add(keyFor(options.laneId, options.role));
    console.info(`[realtime] wsUrl=${url} lane=${options.laneId} role=${options.role}`);
  }

  return socket;
}

export function getLaneSessionClient(options: LaneSessionClientOptions): WebSocket {
  // Implement in exact order
  const key = keyFor(options.laneId, options.role);

  const existing = clients.get(key);
  if (existing) {
    if (
      existing.socket.readyState === WebSocket.OPEN ||
      existing.socket.readyState === WebSocket.CONNECTING
    ) {
      if (!loggedReused.has(key)) {
        loggedReused.add(key);
        console.info('[realtime] LaneSessionClient reused', { key });
      }
      return existing.socket;
    }

    // Stale socket: clear cache and create a new one below.
    clients.delete(key);
  }

  assertKioskToken(options.kioskToken);

  const socket = createSocket(options);

  const internal: InternalClient = { socket };
  clients.set(key, internal);

  // When a cached socket closes, evict it (only if it's still the cached one for this key).
  socket.addEventListener('close', () => {
    const current = clients.get(key);
    if (current?.socket === socket) {
      clients.delete(key);
    }
  });

  return socket;
}

export function closeLaneSessionClient(laneId: string, role: LaneRole): void {
  const key = keyFor(laneId, role);
  const client = clients.get(key);
  if (!client) return;

  try {
    if (client.socket.readyState === WebSocket.CONNECTING) {
      // Avoid "closed before the connection is established" warnings.
      client.socket.addEventListener(
        'open',
        () => {
          try {
            client.socket.close();
          } catch {
            // ignore
          }
        },
        { once: true }
      );
    } else {
      // Best-effort close in any non-closed state.
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
    try {
      client.socket.close();
    } catch {
      // ignore
    }

    clients.delete(key);
  }
}
