import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { registerTelemetryHttpHooks } from './httpHooks';
import { storeTelemetrySpans } from './storeTelemetrySpans';
import type { TelemetrySpanInput } from './spanTypes';

declare module 'fastify' {
  interface FastifyRequest {
    requestId: string;
  }
}

const TELEMETRY_PATH = '/v1/telemetry';
const BACKEND_APP = 'services/api';
const SERVER_DEVICE = 'server';

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

function errorToSpan(params: {
  requestId: string | null;
  route: string | null;
  method: string | null;
  status: number | null;
  url: string | null;
  kind: string;
  err: unknown;
  meta?: Record<string, unknown>;
}): TelemetrySpanInput {
  const err = params.err;
  const message =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : 'Unknown error';
  const stack = err instanceof Error ? err.stack ?? null : null;
  return {
    spanType: params.kind,
    level: 'error',
    route: params.route ?? undefined,
    method: params.method ?? undefined,
    status: params.status ?? undefined,
    url: params.url ?? undefined,
    message: toTruncatedString(message, 2000) ?? undefined,
    stack: toTruncatedString(stack, 8000) ?? undefined,
    meta: { requestId: params.requestId, ...(params.meta ?? {}) },
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

async function safeInsert(spans: TelemetrySpanInput[], traceId?: string): Promise<void> {
  try {
    await storeTelemetrySpans({
      traceId: traceId ?? crypto.randomUUID(),
      app: BACKEND_APP,
      deviceId: SERVER_DEVICE,
      sessionId: SERVER_DEVICE,
      spans,
    });
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

  registerTelemetryHttpHooks(fastify);

  // Ingest frontend telemetry; best-effort and always 200.
  fastify.post(TELEMETRY_PATH, { bodyLimit: 1024 * 1024 }, async (request, reply) => {
    try {
      const body = request.body as unknown;
      const payload =
        body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;

      const spans = payload?.spans;
      const traceId = (payload?.traceId as string | undefined) ?? getHeaderString(request, 'x-trace-id');
      const deviceId = (payload?.deviceId as string | undefined) ?? getHeaderString(request, 'x-device-id');
      const sessionId = (payload?.sessionId as string | undefined) ?? getHeaderString(request, 'x-session-id');
      const app = (payload?.app as string | undefined) ?? getHeaderString(request, 'x-app-name');
      const incident = payload?.incident as
        | { incidentId?: string; reason?: string; startedAt?: string | number }
        | undefined;

      const spansArray: TelemetrySpanInput[] = Array.isArray(spans) ? (spans as TelemetrySpanInput[]) : [];
      if (spansArray.length > 0) {
        await storeTelemetrySpans({
          traceId: traceId ?? undefined,
          app: app ?? undefined,
          deviceId: deviceId ?? undefined,
          sessionId: sessionId ?? undefined,
          spans: spansArray,
          incident,
        });
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

    void safeInsert(
      [
        errorToSpan({
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
      ],
      request.telemetryContext?.traceId ?? undefined
    );
  });

  fastify.addHook('onResponse', async (request, reply) => {
    if (isTelemetryRequest(request)) return;
    if (reply.statusCode < 500) return;
    void safeInsert(
      [
        {
          spanType: 'backend.http_5xx',
          level: 'error',
          route: getRouteForRequest(request) ?? undefined,
          message: `HTTP ${reply.statusCode}`,
          method: toTruncatedString(request.method, 16) ?? undefined,
          status: reply.statusCode,
          url: toTruncatedString(request.url, 2000) ?? undefined,
          meta: {},
        },
      ],
      request.telemetryContext?.traceId ?? undefined
    );
  });

  // Persist explicit fastify.log.error calls (best-effort).
  const logAny = fastify.log as unknown as { error: (...args: unknown[]) => void };
  const originalError = logAny.error.bind(fastify.log);
  logAny.error = (...args: unknown[]) => {
    originalError(...args);
    try {
      const extracted = extractLogError(args);
      void safeInsert([
        errorToSpan({
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
        errorToSpan({
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
        errorToSpan({
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

