import { getInstalledTelemetry, setInstalledTelemetry } from './global.js';
import { getCurrentRoute } from './interactionTelemetry.js';
import type { TelemetryClient, TelemetryContext, TelemetrySpanInput } from './types.js';

export type InstallTelemetryOptions = {
  app: 'customer-kiosk' | 'employee-register' | string;
  endpoint?: string;
  isDev?: boolean;
  maxBatchSize?: number;
  flushIntervalMs?: number;
  getLane?: () => string | undefined;
  breadcrumbsEnabled?: boolean;
  deepOnWarn?: boolean;
  deepOnError?: boolean;
  deepWindowMs?: number;
  breadcrumbLimit?: number;
  breadcrumbSampleRate?: number;
};

const DEFAULT_ENDPOINT = '/api/v1/telemetry';
const DEFAULT_BREADCRUMB_LIMIT = 200;
const DEFAULT_DEEP_WINDOW_MS = 60_000;
const HEADER_BLOCKLIST = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-csrf-token',
  'csrf-token',
  'proxy-authorization',
]);
const BODY_DENYLIST = ['/payment', '/square', '/auth', '/login', '/pin'];

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

function shouldSkipUrl(url: string, endpoint: string): boolean {
  if (url.includes(endpoint)) return true;
  if (url.includes('/v1/telemetry')) return true;
  return false;
}

function shouldCaptureBody(url: string): boolean {
  const lower = url.toLowerCase();
  return !BODY_DENYLIST.some((part) => lower.includes(part));
}

function stripQuery(url: string): { path: string; queryKeys: string[] } {
  try {
    const base = 'http://local.invalid';
    const u = new URL(url, base);
    const queryKeys = Array.from(new Set(Array.from(u.searchParams.keys())));
    u.search = '';
    u.hash = '';
    return { path: u.pathname || url, queryKeys };
  } catch {
    const [path] = url.split('?');
    return { path: path || url, queryKeys: [] };
  }
}

function redactHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (HEADER_BLOCKLIST.has(key.toLowerCase())) {
      out[key] = '[redacted]';
    } else {
      out[key] = value.slice(0, 512);
    }
  });
  return out;
}

function truncateBody(value: string, maxBytes: number): { value: string; truncated: boolean } {
  const bytes = new TextEncoder().encode(value).length;
  if (bytes <= maxBytes) return { value, truncated: false };
  return { value: value.slice(0, maxBytes), truncated: true };
}

function redactBody(payload: unknown): unknown {
  if (payload == null) return payload;
  if (Array.isArray(payload)) return payload.map((item) => redactBody(item));
  if (typeof payload === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
      const lower = k.toLowerCase();
      if (
        lower.includes('password') ||
        lower.includes('passcode') ||
        lower === 'pin' ||
        lower.includes('token') ||
        lower.includes('secret') ||
        lower.includes('apikey') ||
        lower.includes('authorization') ||
        lower.includes('cardnumber') ||
        lower.includes('cvv') ||
        lower.includes('cvc') ||
        lower === 'exp' ||
        lower.includes('expiry') ||
        lower.includes('expiration') ||
        lower.includes('accountnumber') ||
        lower.includes('routingnumber') ||
        lower.includes('ssn')
      ) {
        out[k] = '[redacted]';
      } else {
        out[k] = redactBody(v);
      }
    }
    return out;
  }
  return payload;
}

function serializeBody(value: unknown): { body: unknown | null; meta: Record<string, unknown> } {
  const meta: Record<string, unknown> = {};
  if (value == null) return { body: null, meta };
  let data: unknown = value;
  if (typeof value === 'string') {
    try {
      data = JSON.parse(value);
    } catch {
      return { body: null, meta: { bodyParseError: true } };
    }
  }
  if (typeof data !== 'object') return { body: null, meta };
  const scrubbed = redactBody(data);
  const json = JSON.stringify(scrubbed);
  const truncated = truncateBody(json, 32 * 1024);
  if (truncated.truncated) meta.bodyTruncated = true;
  try {
    return { body: JSON.parse(truncated.value), meta };
  } catch {
    return { body: null, meta: { ...meta, bodyParseError: true } };
  }
}

export function installTelemetry(opts: InstallTelemetryOptions): TelemetryClient {
  const existing = getInstalledTelemetry();
  if (existing) return existing;

  if (typeof window === 'undefined') {
    const noop: TelemetryClient = {
      capture: () => {},
      flush: () => {},
      startIncident: () => 'noop',
      endIncident: () => {},
      setTraceId: () => {},
      getContext: () => ({
        app: opts.app,
        route: '/',
        sessionId: 'server',
        deviceId: 'server',
        traceId: 'server',
      }),
      flushBreadcrumbs: () => {},
    };
    setInstalledTelemetry(noop);
    return noop;
  }

  const endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
  const isDev = opts.isDev ?? false;
  const maxBatchSize = opts.maxBatchSize ?? 25;
  const flushIntervalMs = opts.flushIntervalMs ?? 5000;
  const breadcrumbsEnabled = opts.breadcrumbsEnabled ?? true;
  const deepOnWarn = opts.deepOnWarn ?? true;
  const deepOnError = opts.deepOnError ?? true;
  const deepWindowMs = opts.deepWindowMs ?? DEFAULT_DEEP_WINDOW_MS;
  const breadcrumbLimit = opts.breadcrumbLimit ?? DEFAULT_BREADCRUMB_LIMIT;
  const breadcrumbSampleRate = opts.breadcrumbSampleRate ?? (isDev ? 1 : 0.2);

  const deviceId = getOrCreateStorageId(localStorage, 'clubops.deviceId');
  const sessionId = getOrCreateStorageId(sessionStorage, 'clubops.telemetry.sessionId');
  let baseTraceId = getOrCreateStorageId(sessionStorage, 'clubops.telemetry.traceId');

  type QueuedSpan = {
    traceId: string;
    span: TelemetrySpanInput;
  };

  const pending: QueuedSpan[] = [];
  const breadcrumbs: TelemetrySpanInput[] = [];
  let flushTimer: number | null = null;

  let incidentActive = false;
  let incidentId: string | null = null;
  let incidentReason: string | null = null;
  let incidentTraceId: string | null = null;
  let incidentStartedAt = 0;
  let incidentTimer: number | null = null;
  let pendingIncident: { incidentId: string; reason: string; startedAt: string } | null = null;
  let incidentSpanCount = 0;
  let incidentDeepCount = 0;
  let incidentBreadcrumbCount = 0;

  const originalFetch = window.fetch.bind(window);
  const originalConsoleError = console.error.bind(console);
  const originalConsoleWarn = console.warn.bind(console);
  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);

  const getActiveTraceId = () => incidentTraceId ?? baseTraceId;

  const getContext = (): TelemetryContext => {
    const lane = opts.getLane?.() ?? safeString(sessionStorage.getItem('lane'), 64);
    return {
      app: opts.app,
      route: getCurrentRoute(),
      sessionId,
      deviceId,
      traceId: getActiveTraceId(),
      incidentId: incidentId ?? undefined,
      lane: lane || undefined,
    };
  };

  const enqueue = (span: TelemetrySpanInput, traceId: string) => {
    pending.push({ span, traceId });
    if (pending.length >= maxBatchSize) {
      flush();
    } else {
      scheduleFlush();
    }
  };

  const send = (spans: TelemetrySpanInput[], traceId: string, useBeacon: boolean) => {
    if (spans.length === 0) return;
    const payload = JSON.stringify({
      traceId,
      app: opts.app,
      deviceId,
      sessionId,
      spans,
      incident: pendingIncident && traceId === incidentTraceId ? pendingIncident : undefined,
    });

    if (pendingIncident && traceId === incidentTraceId) {
      pendingIncident = null;
    }

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
    const grouped = new Map<string, TelemetrySpanInput[]>();
    for (const item of batch) {
      const list = grouped.get(item.traceId) ?? [];
      list.push(item.span);
      grouped.set(item.traceId, list);
    }
    for (const [traceId, spans] of grouped.entries()) {
      send(spans, traceId, useBeacon);
    }
  };

  const scheduleFlush = () => {
    if (flushTimer != null) return;
    flushTimer = window.setTimeout(() => {
      flushTimer = null;
      flush();
    }, flushIntervalMs);
  };

  const recordBreadcrumb = (span: TelemetrySpanInput) => {
    if (!breadcrumbsEnabled) return;
    breadcrumbs.push(span);
    if (breadcrumbs.length > breadcrumbLimit) {
      breadcrumbs.splice(0, breadcrumbs.length - breadcrumbLimit);
    }
  };

  const flushBreadcrumbs = (options?: { useBeacon?: boolean }) => {
    if (!breadcrumbsEnabled || breadcrumbs.length === 0 || !incidentTraceId || !incidentId) return;
    const toSend = breadcrumbs.splice(0, breadcrumbs.length).map((span) => ({
      ...span,
      incidentId,
      incidentReason: incidentReason ?? undefined,
      meta: { ...(span.meta ?? {}), breadcrumb: true },
    }));
    incidentBreadcrumbCount += toSend.length;
    send(toSend, incidentTraceId, options?.useBeacon ?? false);
  };

  const startIncident = (reason: string, opts?: { forceNew?: boolean }) => {
    if (incidentActive && !opts?.forceNew) {
      if (incidentTimer) window.clearTimeout(incidentTimer);
      incidentTimer = window.setTimeout(endIncident, deepWindowMs);
      return incidentId ?? 'incident';
    }

    if (incidentActive && opts?.forceNew) {
      endIncident();
    }

    incidentActive = true;
    incidentId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    incidentReason = reason;
    incidentTraceId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    incidentStartedAt = Date.now();
    incidentSpanCount = 0;
    incidentDeepCount = 0;
    incidentBreadcrumbCount = 0;

    pendingIncident = { incidentId, reason, startedAt: nowIso() };
    flushBreadcrumbs();
    if (incidentTimer) window.clearTimeout(incidentTimer);
    incidentTimer = window.setTimeout(endIncident, deepWindowMs);
    return incidentId;
  };

  const endIncident = () => {
    if (!incidentActive || !incidentId || !incidentTraceId) return;
    const durationMs = Date.now() - incidentStartedAt;
    const span: TelemetrySpanInput = {
      spanType: 'incident.end',
      level: 'info',
      startedAt: nowIso(),
      durationMs,
      incidentId,
      incidentReason: incidentReason ?? undefined,
      meta: {
        spanCount: incidentSpanCount,
        deepSpanCount: incidentDeepCount,
        breadcrumbCount: incidentBreadcrumbCount,
      },
    };
    enqueue(span, incidentTraceId);
    incidentActive = false;
    incidentId = null;
    incidentReason = null;
    incidentTraceId = null;
    incidentStartedAt = 0;
    pendingIncident = null;
    if (incidentTimer) window.clearTimeout(incidentTimer);
    incidentTimer = null;
  };

  const setTraceId = (traceId: string) => {
    if (!traceId || !traceId.trim()) return;
    try {
      sessionStorage.setItem('clubops.telemetry.traceId', traceId);
      baseTraceId = traceId;
    } catch {
      // ignore
    }
  };

  const shouldSampleBreadcrumb = () => Math.random() <= breadcrumbSampleRate;

  const capture = (span: TelemetrySpanInput) => {
    try {
      const ctx = getContext();
      const isBreadcrumb =
        span.meta?.breadcrumb === true ||
        span.spanType === 'ui.click' ||
        span.spanType === 'ui.nav' ||
        span.spanType === 'net.request' ||
        span.spanType === 'net.response';

      if (isBreadcrumb && !incidentActive && breadcrumbsEnabled && !shouldSampleBreadcrumb()) {
        return;
      }

      const enriched: TelemetrySpanInput = {
        ...span,
        startedAt: span.startedAt ?? nowIso(),
        route: span.route ?? ctx.route,
        meta: span.meta ?? {},
        incidentId: incidentActive ? incidentId ?? undefined : span.incidentId,
        incidentReason: incidentActive ? incidentReason ?? undefined : span.incidentReason,
      };

      if (isBreadcrumb) {
        recordBreadcrumb(enriched);
      }
      if (incidentActive) {
        incidentSpanCount += 1;
        if (enriched.meta?.deep === true) incidentDeepCount += 1;
      }
      enqueue(enriched, getActiveTraceId());
    } catch {
      // ignore
    }
  };

  const captureNav = () => {
    capture({
      spanType: 'ui.nav',
      name: `Nav: ${window.location.pathname || '/'}`,
      level: 'info',
      meta: { breadcrumb: true },
    });
  };

  const captureClick = (event: MouseEvent) => {
    if (!breadcrumbsEnabled) return;
    const target = event.target as HTMLElement | null;
    if (!target) return;

    let el: HTMLElement | null = target;
    let label = '';
    let tag = '';
    let testId = '';
    let ariaLabel = '';

    while (el && el !== document.body) {
      tag = el.tagName.toLowerCase();
      testId = el.getAttribute('data-testid') ?? '';
      ariaLabel = el.getAttribute('aria-label') ?? '';
      if (testId || ariaLabel || tag === 'button' || tag === 'a') {
        label = testId || ariaLabel || (el.textContent ?? '').trim();
        break;
      }
      el = el.parentElement;
    }

    if (!label) {
      label = (target.textContent ?? '').trim();
    }

    const truncatedLabel = truncate(label || tag || 'click', 60);
    capture({
      spanType: 'ui.click',
      name: `Click: ${truncatedLabel || 'unknown'}`,
      level: 'info',
      meta: {
        breadcrumb: true,
        element: {
          tag: tag || target.tagName.toLowerCase(),
          testId: testId || undefined,
          ariaLabel: ariaLabel || undefined,
          text: truncatedLabel || undefined,
        },
      },
    });
  };

  const handleRouteChange = () => {
    captureNav();
  };

  const onWarn = (...args: unknown[]) => {
    try {
      capture({
        spanType: 'console.warn',
        level: 'warn',
        message: safeString(args[0], 2000),
        meta: { args: safeJson(args, 4000) },
      });
      if (deepOnWarn) startIncident('console.warn');
    } catch {
      // ignore
    }
  };

  const onError = (...args: unknown[]) => {
    try {
      const firstErr = args.find((a) => a instanceof Error) as Error | undefined;
      capture({
        spanType: 'console.error',
        level: 'error',
        message: firstErr?.message ?? safeString(args[0], 2000),
        stack: firstErr?.stack ? safeString(firstErr.stack, 8000) : undefined,
        meta: { args: safeJson(args, 4000) },
      });
      if (deepOnError) startIncident('console.error');
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
      spanType: 'ui.error',
      level: 'error',
      message: safeString(anyEv.message, 2000) ?? 'Unhandled error',
      stack: safeErrorStack(anyEv.error),
      meta: {
        filename: anyEv.filename,
        lineno: anyEv.lineno,
        colno: anyEv.colno,
      },
    });
    if (deepOnError) startIncident('ui.error');
  });

  window.addEventListener('unhandledrejection', (ev) => {
    const reason = (ev as PromiseRejectionEvent).reason;
    capture({
      spanType: 'ui.unhandledrejection',
      level: 'error',
      message: safeErrorMessage(reason) ?? 'Unhandled rejection',
      stack: safeErrorStack(reason),
      meta: { reason: safeJson(reason, 2000) },
    });
    if (deepOnError) startIncident('unhandledrejection');
  });

  console.error = (...args: unknown[]) => {
    onError(...args);
    originalConsoleError(...args);
  };

    console.warn = (...args: unknown[]) => {
    onWarn(...args);
      originalConsoleWarn(...args);
    };

  document.addEventListener('click', captureClick, true);
  window.addEventListener('popstate', handleRouteChange);
  history.pushState = (...args) => {
    originalPushState(...args);
    handleRouteChange();
  };
  history.replaceState = (...args) => {
    originalReplaceState(...args);
    handleRouteChange();
  };

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

    const requestKey = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    const method =
      safeString(init?.method, 16) ??
      (typeof input === 'string' || input instanceof URL ? 'GET' : safeString(input.method, 16) ?? 'GET');
    const { path, queryKeys } = stripQuery(url);
    const headers = new Headers(
      init?.headers ?? (typeof input === 'string' || input instanceof URL ? undefined : input.headers)
    );

    headers.set('x-request-key', requestKey);
    headers.set('x-trace-id', getActiveTraceId());
    headers.set('x-device-id', deviceId);
    headers.set('x-session-id', sessionId);
    headers.set('x-app-name', opts.app);
    if (incidentActive) headers.set('x-telemetry-deep', '1');

    const req =
      typeof input === 'string' || input instanceof URL
        ? new Request(input, { ...init, headers })
        : new Request(input, { ...init, headers });

    const start = performance.now();
    const requestMeta: Record<string, unknown> = { breadcrumb: true, requestKey };
    if (queryKeys.length > 0) requestMeta.queryKeys = queryKeys;

    if (incidentActive) {
      requestMeta.deep = true;
      requestMeta.incidentId = incidentId;
    }

    let requestHeaders: Record<string, unknown> | undefined;
    let requestBody: unknown | undefined;
    let requestMetaExtra: Record<string, unknown> = {};

    if (incidentActive) {
      requestHeaders = redactHeaders(headers);
      if (shouldCaptureBody(path) && headers.get('content-type')?.includes('application/json')) {
        const serialized = serializeBody(init?.body);
        requestBody = serialized.body ?? undefined;
        requestMetaExtra = serialized.meta;
      }
    }

    capture({
      spanType: 'net.request',
      level: 'info',
      method,
      url: path,
      requestHeaders,
      requestBody,
      requestKey,
      meta: { ...requestMeta, ...requestMetaExtra },
    });

    try {
      const res = await originalFetch(req);
      const durationMs = Math.round(performance.now() - start);
      const responseMeta: Record<string, unknown> = {
        breadcrumb: !incidentActive,
        requestKey,
        durationMs,
      };
      if (queryKeys.length > 0) responseMeta.queryKeys = queryKeys;
      if (incidentActive) {
        responseMeta.deep = true;
        responseMeta.incidentId = incidentId;
      }

      let responseHeaders: Record<string, unknown> | undefined;
      let responseBody: unknown | undefined;
      let responseMetaExtra: Record<string, unknown> = {};

      if (incidentActive) {
        responseHeaders = redactHeaders(res.headers);
        if (shouldCaptureBody(path) && res.headers.get('content-type')?.includes('application/json')) {
            const text = await res.clone().text().catch(() => '');
          const serialized = serializeBody(text);
          responseBody = serialized.body ?? undefined;
          responseMetaExtra = serialized.meta;
        }
        }

        capture({
        spanType: 'net.response',
        level: res.status >= 500 ? 'error' : res.status >= 400 ? 'warn' : 'info',
          method,
          status: res.status,
        url: path,
        durationMs,
        responseHeaders,
        responseBody,
        requestKey,
        meta: { ...responseMeta, ...responseMetaExtra },
      });

      if (res.status >= 500 && deepOnError) {
        startIncident('http_error');
      } else if (res.status >= 400 && deepOnWarn) {
        startIncident('http_warn');
      }

      return res;
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      capture({
        spanType: 'net.response',
        level: 'error',
        method,
        url: path,
        message: safeErrorMessage(err) ?? 'Fetch failed',
        stack: safeErrorStack(err),
        durationMs,
        requestKey,
        meta: { breadcrumb: !incidentActive, requestKey, durationMs, error: true },
      });
      if (deepOnError) startIncident('network_error');
      throw err;
    }
  };

  const flushOnHide = () => flush({ useBeacon: true });
  window.addEventListener('pagehide', flushOnHide);
  window.addEventListener('beforeunload', flushOnHide);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushOnHide();
  });

  const client: TelemetryClient = {
    capture,
    flush,
    startIncident,
    endIncident,
    setTraceId,
    getContext,
    flushBreadcrumbs,
  };
  setInstalledTelemetry(client);
  return client;
}
