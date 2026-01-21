import type { FastifyInstance, FastifyRequest } from 'fastify';
import { insertTelemetryEvents } from './store';
import { sanitizeTelemetryEventInput, type TelemetryEventRow } from './types';

declare module 'fastify' {
  interface FastifyRequest {
    requestId: string;
  }
}

const TELEMETRY_PATH = '/v1/telemetry';
const BACKEND_APP = 'services/api';

function isTelemetryRequest(request: FastifyRequest): boolean {
  const url = request.url || '';
  return url === TELEMETRY_PATH || url.startsWith(`${TELEMETRY_PATH}?`);
}

function toTruncatedString(value: unknown, maxLen: number): string | null {
  if (value == null) return null;
  const s = typeof value === 'string' ? value : String(value);
  const trimmed = s.trim();
  if (!trimmed) return null;
  return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen)}…` : trimmed;
}

function getHeaderString(request: FastifyRequest, name: string): string | null {
  const raw = request.headers[name.toLowerCase()];
  if (Array.isArray(raw)) return toTruncatedString(raw[0], 128);
  return toTruncatedString(raw, 128);
}

function getOrCreateRequestId(request: FastifyRequest): string {
  const existing = getHeaderString(request, 'x-request-id');
  return existing ?? crypto.randomUUID();
}

function getRouteForRequest(request: FastifyRequest): string | null {
  // Prefer routeOptions.url (Fastify v4+); fallback to url path.
  const routeUrl = (request as unknown as { routeOptions?: { url?: unknown } }).routeOptions?.url;
  const byRoute = toTruncatedString(routeUrl, 256);
  if (byRoute) return byRoute;
  const url = request.url || '';
  return toTruncatedString(url.split('?')[0], 256);
}

function errorToTelemetryRow(params: {
  requestId: string | null;
  route: string | null;
  method: string | null;
  status: number | null;
  url: string | null;
  kind: string;
  err: unknown;
  meta?: Record<string, unknown>;
}): TelemetryEventRow {
  const err = params.err;
  const message =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : 'Unknown error';
  const stack = err instanceof Error ? err.stack ?? null : null;
  return {
    createdAt: new Date(),
    app: BACKEND_APP,
    level: 'error',
    kind: params.kind,
    route: params.route,
    message: toTruncatedString(message, 2000),
    stack: toTruncatedString(stack, 8000),
    requestId: params.requestId,
    sessionId: null,
    deviceId: null,
    lane: null,
    method: params.method,
    status: params.status,
    url: params.url,
    meta: params.meta ?? {},
  };
}

function extractLogError(args: unknown[]): { err: unknown; message: string | null; meta: Record<string, unknown> } {
  let err: unknown = null;
  let message: string | null = null;
  let meta: Record<string, unknown> = {};

  for (const a of args) {
    if (!err && a instanceof Error) err = a;
    if (!message && typeof a === 'string') message = a;
    if (a && typeof a === 'object' && !(a instanceof Error)) {
      meta = a as Record<string, unknown>;
      if (!err && 'err' in meta && meta.err instanceof Error) err = meta.err;
    }
  }

  return { err: err ?? new Error(message ?? 'Logged error'), message, meta };
}

let processHandlersInstalled = false;

async function safeInsert(events: TelemetryEventRow[]): Promise<void> {
  try {
    await insertTelemetryEvents(events);
  } catch {
    // Telemetry must never impact request flow.
  }
}

export async function setupTelemetry(fastify: FastifyInstance): Promise<void> {
  // Correlate all requests (including telemetry ingestion itself).
  fastify.addHook('onRequest', async (request, reply) => {
    const requestId = getOrCreateRequestId(request);
    request.requestId = requestId;
    reply.header('x-request-id', requestId);
  });

  // Ingest frontend telemetry; best-effort and always 200.
  fastify.post(TELEMETRY_PATH, async (request, reply) => {
    try {
      const body = request.body as unknown;
      const rawEvents: unknown[] = Array.isArray(body)
        ? body
        : body && typeof body === 'object' && Array.isArray((body as { events?: unknown }).events)
          ? ((body as { events: unknown[] }).events as unknown[])
          : body && typeof body === 'object'
            ? [body]
            : [];

      const sanitized: TelemetryEventRow[] = [];
      for (const raw of rawEvents) {
        const row = sanitizeTelemetryEventInput(raw);
        if (!row) continue;
        // Ensure correlation if the client omitted requestId.
        row.requestId = row.requestId ?? request.requestId ?? null;
        sanitized.push(row);
      }

      if (sanitized.length > 0) {
        await safeInsert(sanitized);
      }
    } catch {
      // ignore
    } finally {
      if (!reply.sent) reply.code(200).send({ ok: true });
    }
  });

  // Ensure the telemetry endpoint never surfaces an error response (e.g., body parser errors).
  fastify.addHook('onError', async (request, reply, error) => {
    if (isTelemetryRequest(request)) {
      if (!reply.sent) reply.code(200).send({ ok: true });
      return;
    }

    void safeInsert([
      errorToTelemetryRow({
        requestId: request.requestId ?? null,
        route: getRouteForRequest(request),
        method: toTruncatedString(request.method, 16),
        status: typeof reply.statusCode === 'number' ? reply.statusCode : 500,
        url: toTruncatedString(request.url, 2000),
        kind: 'backend.error',
        err: error,
        meta: {
          // Some Fastify errors carry a code; keep it for grouping.
          code: (error as unknown as { code?: unknown }).code,
        },
      }),
    ]);
  });

  fastify.addHook('onResponse', async (request, reply) => {
    if (isTelemetryRequest(request)) return;
    if (reply.statusCode < 500) return;
    void safeInsert([
      {
        createdAt: new Date(),
        app: BACKEND_APP,
        level: 'error',
        kind: 'backend.http_5xx',
        route: getRouteForRequest(request),
        message: `HTTP ${reply.statusCode}`,
        stack: null,
        requestId: request.requestId ?? null,
        sessionId: null,
        deviceId: null,
        lane: null,
        method: toTruncatedString(request.method, 16),
        status: reply.statusCode,
        url: toTruncatedString(request.url, 2000),
        meta: {},
      },
    ]);
  });

  // Persist explicit fastify.log.error calls (best-effort).
  const logAny = fastify.log as unknown as { error: (...args: unknown[]) => void };
  const originalError = logAny.error.bind(fastify.log);
  logAny.error = (...args: unknown[]) => {
    originalError(...args);
    try {
      const extracted = extractLogError(args);
      void safeInsert([
        errorToTelemetryRow({
          requestId: null,
          route: null,
          method: null,
          status: null,
          url: null,
          kind: 'backend.log_error',
          err: extracted.err,
          meta: {
            message: extracted.message,
            ...extracted.meta,
          },
        }),
      ]);
    } catch {
      // ignore
    }
  };

  // Process-level capture (install once per process).
  if (!processHandlersInstalled) {
    processHandlersInstalled = true;

    process.on('unhandledRejection', (reason) => {
      void safeInsert([
        errorToTelemetryRow({
          requestId: null,
          route: null,
          method: null,
          status: null,
          url: null,
          kind: 'process.unhandledRejection',
          err: reason,
        }),
      ]);
    });

    process.once('uncaughtException', (err) => {
      void safeInsert([
        errorToTelemetryRow({
          requestId: null,
          route: null,
          method: null,
          status: null,
          url: null,
          kind: 'process.uncaughtException',
          err,
        }),
      ]);
      // Preserve default "fatal" semantics; give telemetry a short window to write.
      setTimeout(() => process.exit(1), 250).unref();
    });
  }
}

