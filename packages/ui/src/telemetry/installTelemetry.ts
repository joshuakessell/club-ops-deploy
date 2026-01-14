import { getInstalledTelemetry, setInstalledTelemetry } from './global';
import type { TelemetryClient, TelemetryEvent } from './types';

export type InstallTelemetryOptions = {
  app: 'customer-kiosk' | 'employee-register' | string;
  endpoint?: string;
  isDev?: boolean;
  captureConsoleWarnInDev?: boolean;
  maxBatchSize?: number;
  flushIntervalMs?: number;
  getLane?: () => string | undefined;
};

const DEFAULT_ENDPOINT = '/api/v1/telemetry';

function nowIso(): string {
  return new Date().toISOString();
}

function truncate(s: string, maxLen: number): string {
  const trimmed = s.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}…`;
}

function safeString(value: unknown, maxLen: number): string | undefined {
  if (value == null) return undefined;
  const s = typeof value === 'string' ? value : String(value);
  const t = s.trim();
  if (!t) return undefined;
  return truncate(t, maxLen);
}

function safeErrorStack(err: unknown): string | undefined {
  if (err instanceof Error) return safeString(err.stack ?? err.message, 8000);
  return undefined;
}

function safeErrorMessage(err: unknown): string | undefined {
  if (err instanceof Error) return safeString(err.message, 2000);
  return safeString(err, 2000);
}

function safeJson(value: unknown, maxLen: number): string | undefined {
  try {
    const seen = new WeakSet<object>();
    const json = JSON.stringify(value, (_k, v) => {
      if (v instanceof Error) {
        return { name: v.name, message: v.message, stack: v.stack };
      }
      if (typeof v === 'object' && v) {
        if (seen.has(v as object)) return '[Circular]';
        seen.add(v as object);
      }
      return v;
    });
    return safeString(json, maxLen);
  } catch {
    return safeString(String(value), maxLen);
  }
}

function getOrCreateStorageId(storage: Storage, key: string): string {
  try {
    const existing = storage.getItem(key);
    if (existing) return existing;
    const created = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    storage.setItem(key, created);
    return created;
  } catch {
    return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  }
}

function currentRoute(): string {
  const path = window.location.pathname || '/';
  const search = window.location.search || '';
  return `${path}${search}`;
}

function shouldSkipUrl(url: string, endpoint: string): boolean {
  if (url.includes(endpoint)) return true;
  if (url.includes('/v1/telemetry')) return true;
  return false;
}

export function installTelemetry(opts: InstallTelemetryOptions): TelemetryClient {
  const existing = getInstalledTelemetry();
  if (existing) return existing;

  if (typeof window === 'undefined') {
    const noop: TelemetryClient = {
      capture: () => {},
      flush: () => {},
      getContext: () => ({ app: opts.app, route: '/', sessionId: 'server', deviceId: 'server' }),
    };
    setInstalledTelemetry(noop);
    return noop;
  }

  const endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
  const isDev = opts.isDev ?? false;
  const captureWarn = (opts.captureConsoleWarnInDev ?? true) && isDev;
  const maxBatchSize = opts.maxBatchSize ?? 25;
  const flushIntervalMs = opts.flushIntervalMs ?? 5000;

  const deviceId = getOrCreateStorageId(localStorage, 'clubops.deviceId');
  const sessionId = getOrCreateStorageId(sessionStorage, 'clubops.telemetry.sessionId');

  const pending: TelemetryEvent[] = [];
  let flushTimer: number | null = null;

  const originalFetch = window.fetch.bind(window);
  const originalConsoleError = console.error.bind(console);
  const originalConsoleWarn = console.warn.bind(console);

  const getContext = () => {
    const lane = opts.getLane?.() ?? safeString(sessionStorage.getItem('lane'), 64);
    return {
      app: opts.app,
      route: currentRoute(),
      sessionId,
      deviceId,
      lane: lane || undefined,
    };
  };

  const send = (events: TelemetryEvent[], useBeacon: boolean) => {
    if (events.length === 0) return;
    const payload = JSON.stringify(events);

    if (useBeacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      try {
        const blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon(endpoint, blob);
        return;
      } catch {
        // fall back to fetch
      }
    }

    void originalFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {
      // Never recurse on telemetry failures.
    });
  };

  const flush = (options?: { useBeacon?: boolean }) => {
    const useBeacon = options?.useBeacon ?? false;
    if (pending.length === 0) return;
    const batch = pending.splice(0, pending.length);
    send(batch, useBeacon);
  };

  const scheduleFlush = () => {
    if (flushTimer != null) return;
    flushTimer = window.setTimeout(() => {
      flushTimer = null;
      flush();
    }, flushIntervalMs);
  };

  const capture = (event: Omit<TelemetryEvent, 'timestamp' | 'app'> & { app?: string }) => {
    try {
      const ctx = getContext();
      const full: TelemetryEvent = {
        timestamp: nowIso(),
        app: event.app ?? ctx.app,
        level: event.level,
        kind: event.kind,
        route: event.route ?? ctx.route,
        message: safeString(event.message, 2000),
        stack: safeString(event.stack, 8000),
        requestId: safeString(event.requestId, 128),
        sessionId: ctx.sessionId,
        deviceId: ctx.deviceId,
        lane: event.lane ?? ctx.lane,
        method: safeString(event.method, 16),
        status: typeof event.status === 'number' ? event.status : undefined,
        url: safeString(event.url, 2000),
        meta: event.meta ?? {},
      };
      pending.push(full);
      if (pending.length >= maxBatchSize) {
        flush();
      } else {
        scheduleFlush();
      }
    } catch {
      // ignore
    }
  };

  window.addEventListener('error', (ev) => {
    const anyEv = ev as unknown as {
      error?: unknown;
      message?: unknown;
      filename?: unknown;
      lineno?: unknown;
      colno?: unknown;
    };
    capture({
      level: 'error',
      kind: 'ui.error',
      message: safeString(anyEv.message, 2000) ?? 'Unhandled error',
      stack: safeErrorStack(anyEv.error),
      meta: {
        filename: anyEv.filename,
        lineno: anyEv.lineno,
        colno: anyEv.colno,
      },
    });
  });

  window.addEventListener('unhandledrejection', (ev) => {
    const reason = (ev as PromiseRejectionEvent).reason;
    capture({
      level: 'error',
      kind: 'ui.unhandledrejection',
      message: safeErrorMessage(reason) ?? 'Unhandled rejection',
      stack: safeErrorStack(reason),
      meta: { reason: safeJson(reason, 2000) },
    });
  });

  console.error = (...args: unknown[]) => {
    try {
      const firstErr = args.find((a) => a instanceof Error) as Error | undefined;
      capture({
        level: 'error',
        kind: 'console.error',
        message: firstErr?.message ?? safeString(args[0], 2000) ?? 'console.error',
        stack: firstErr?.stack ? safeString(firstErr.stack, 8000) : undefined,
        meta: { args: safeJson(args, 4000) },
      });
    } catch {
      // ignore
    }
    originalConsoleError(...args);
  };

  if (captureWarn) {
    console.warn = (...args: unknown[]) => {
      try {
        capture({
          level: 'warn',
          kind: 'console.warn',
          message: safeString(args[0], 2000) ?? 'console.warn',
          meta: { args: safeJson(args, 4000) },
        });
      } catch {
        // ignore
      }
      originalConsoleWarn(...args);
    };
  }

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (shouldSkipUrl(url, endpoint)) {
      return originalFetch(input, init);
    }

    const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    const method =
      safeString(init?.method, 16) ??
      (typeof input === 'string' || input instanceof URL ? 'GET' : safeString(input.method, 16) ?? 'GET');

    const headers = new Headers(
      init?.headers ?? (typeof input === 'string' || input instanceof URL ? undefined : input.headers)
    );
    headers.set('x-request-id', requestId);

    const req =
      typeof input === 'string' || input instanceof URL
        ? new Request(input, { ...init, headers })
        : new Request(input, { ...init, headers });

    const start = performance.now();
    try {
      const res = await originalFetch(req);
      const durationMs = Math.round(performance.now() - start);
      const shouldLog = res.status >= 500 || (isDev && res.status >= 400 && res.status < 500);
      if (shouldLog) {
        let snippet: string | undefined;
        try {
          const contentLength = Number(res.headers.get('content-length') || '0');
          if (!Number.isFinite(contentLength) || contentLength <= 20_000) {
            const text = await res.clone().text().catch(() => '');
            snippet = safeString(text, 500);
          }
        } catch {
          // ignore
        }

        capture({
          level: res.status >= 500 ? 'error' : 'warn',
          kind: 'http.error',
          message: `HTTP ${res.status}`,
          requestId,
          method,
          status: res.status,
          url,
          meta: { durationMs, statusText: res.statusText, snippet },
        });
      }
      return res;
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      capture({
        level: 'error',
        kind: 'http.exception',
        message: safeErrorMessage(err) ?? 'Fetch failed',
        stack: safeErrorStack(err),
        requestId,
        method,
        url,
        meta: { durationMs },
      });
      throw err;
    }
  };

  const flushOnHide = () => flush({ useBeacon: true });
  window.addEventListener('pagehide', flushOnHide);
  window.addEventListener('beforeunload', flushOnHide);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushOnHide();
  });

  const client: TelemetryClient = { capture, flush, getContext };
  setInstalledTelemetry(client);
  return client;
}
