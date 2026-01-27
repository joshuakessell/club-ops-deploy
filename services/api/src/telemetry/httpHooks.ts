import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { redactHeaders, sanitizeJsonBody } from './redact';
import { storeTelemetrySpans } from './storeTelemetrySpans';
import type { TelemetrySpanInput } from './spanTypes';

const TELEMETRY_PATH = '/v1/telemetry';
const ALLOWED_DEEP_APPS = new Set(['customer-kiosk', 'employee-register']);

type TelemetryRequestContext = {
  startTime: number;
  traceId: string;
  appName: string;
  deviceId: string;
  sessionId: string;
  requestKey: string;
  route: string | null;
  url: string | null;
  method: string | null;
  deepRequested: boolean;
  responseHeaders?: Record<string, unknown> | null;
  responseBody?: unknown | null;
};

declare module 'fastify' {
  interface FastifyRequest {
    telemetryContext?: TelemetryRequestContext;
  }
}

function toTruncatedString(value: unknown, maxLen: number): string | null {
  if (value == null) return null;
  const s = typeof value === 'string' ? value : String(value);
  const trimmed = s.trim();
  if (!trimmed) return null;
  return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen)}…` : trimmed;
}

function isTelemetryRequest(request: FastifyRequest): boolean {
  const url = request.url || '';
  return url === TELEMETRY_PATH || url.startsWith(`${TELEMETRY_PATH}?`);
}

function getRouteForRequest(request: FastifyRequest): string | null {
  const routeUrl = (request as unknown as { routeOptions?: { url?: unknown } }).routeOptions?.url;
  const byRoute = toTruncatedString(routeUrl, 256);
  if (byRoute) return byRoute;
  const url = request.url || '';
  return toTruncatedString(url.split('?')[0], 256);
}

function getHeader(request: FastifyRequest, name: string): string | null {
  const raw = request.headers[name.toLowerCase()];
  if (Array.isArray(raw)) return toTruncatedString(raw[0], 256);
  return toTruncatedString(raw, 256);
}

function getTraceContext(request: FastifyRequest): {
  traceId: string;
  appName: string;
  deviceId: string;
  sessionId: string;
  requestKey: string;
  deepRequested: boolean;
} {
  const traceId = getHeader(request, 'x-trace-id') ?? crypto.randomUUID();
  const appName = getHeader(request, 'x-app-name') ?? 'unknown';
  const deviceId = getHeader(request, 'x-device-id') ?? 'unknown';
  const sessionId = getHeader(request, 'x-session-id') ?? 'unknown';
  const requestKey = getHeader(request, 'x-request-key') ?? crypto.randomUUID();
  const deepRequested = getHeader(request, 'x-telemetry-deep') === '1';
  return { traceId, appName, deviceId, sessionId, requestKey, deepRequested };
}

function extractHeaders(reply: FastifyReply): Record<string, unknown> {
  const headers = reply.getHeaders();
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[key] = value;
  }
  return normalized;
}

function isJsonContentType(contentType?: string | string[]): boolean {
  if (!contentType) return false;
  const value = Array.isArray(contentType) ? contentType.join(';') : contentType;
  return value.toLowerCase().includes('application/json');
}

export function registerTelemetryHttpHooks(fastify: FastifyInstance): void {
  fastify.addHook('onRequest', async (request) => {
    if (isTelemetryRequest(request)) return;
    const ctx = getTraceContext(request);
    request.telemetryContext = {
      startTime: performance.now(),
      traceId: ctx.traceId,
      appName: ctx.appName,
      deviceId: ctx.deviceId,
      sessionId: ctx.sessionId,
      requestKey: ctx.requestKey,
      route: getRouteForRequest(request),
      url: toTruncatedString(request.url, 2000),
      method: toTruncatedString(request.method, 16),
      deepRequested: ctx.deepRequested,
    };
  });

  fastify.addHook('onSend', async (request, reply, payload) => {
    if (isTelemetryRequest(request)) return payload;
    const ctx = request.telemetryContext;
    if (!ctx) return payload;
    const isAllowedDeep = ALLOWED_DEEP_APPS.has(ctx.appName);
    const shouldDeep = isAllowedDeep && (ctx.deepRequested || reply.statusCode >= 500);
    if (!shouldDeep) return payload;

    const responseHeaders = redactHeaders(extractHeaders(reply));
    const contentType = reply.getHeader('content-type') as string | string[] | undefined;
    let responseBody: unknown | null = null;
    if (isJsonContentType(contentType)) {
      if (payload && typeof payload === 'object') {
        responseBody = payload;
      } else if (typeof payload === 'string') {
        try {
          responseBody = JSON.parse(payload);
        } catch {
          responseBody = null;
        }
      }
    }

    ctx.responseHeaders = responseHeaders;
    ctx.responseBody = responseBody;
    return payload;
  });

  fastify.addHook('onResponse', async (request, reply) => {
    if (isTelemetryRequest(request)) return;
    const ctx = request.telemetryContext;
    if (!ctx) return;

    const isAllowedDeep = ALLOWED_DEEP_APPS.has(ctx.appName);
    const shouldDeep = isAllowedDeep && (ctx.deepRequested || reply.statusCode >= 500);
    const durationMs = Math.round(performance.now() - ctx.startTime);

    const metaBase: Record<string, unknown> = {
      requestKey: ctx.requestKey,
    };
    if (shouldDeep) metaBase.deepCaptured = true;
    if (!shouldDeep) metaBase.breadcrumb = true;

    const requestHeaders = shouldDeep
      ? redactHeaders((request.headers as unknown as Record<string, unknown>) ?? {})
      : null;
    const requestBodySanitized = shouldDeep
      ? sanitizeJsonBody(request.body, ctx.route ?? ctx.url, 'request')
      : { body: null, meta: {} };
    const responseBodySanitized = shouldDeep
      ? sanitizeJsonBody(ctx.responseBody, ctx.route ?? ctx.url, 'response')
      : { body: null, meta: {} };

    const requestSpan: TelemetrySpanInput = {
      spanType: 'api.request',
      level: 'info',
      startedAt: new Date(Date.now() - durationMs).toISOString(),
      route: ctx.route ?? undefined,
      method: ctx.method ?? undefined,
      url: ctx.url ?? undefined,
      requestHeaders: requestHeaders ?? undefined,
      requestBody: requestBodySanitized.body ?? undefined,
      requestKey: ctx.requestKey,
      meta: { ...metaBase, ...requestBodySanitized.meta },
    };

    const responseSpan: TelemetrySpanInput = {
      spanType: 'api.response',
      level: reply.statusCode >= 500 ? 'error' : reply.statusCode >= 400 ? 'warn' : 'info',
      startedAt: new Date().toISOString(),
      durationMs,
      route: ctx.route ?? undefined,
      method: ctx.method ?? undefined,
      status: reply.statusCode,
      url: ctx.url ?? undefined,
      responseHeaders: shouldDeep ? (ctx.responseHeaders ?? undefined) : undefined,
      responseBody: responseBodySanitized.body ?? undefined,
      requestKey: ctx.requestKey,
      meta: { ...metaBase, ...responseBodySanitized.meta },
    };

    try {
      await storeTelemetrySpans({
        traceId: ctx.traceId,
        app: ctx.appName,
        deviceId: ctx.deviceId,
        sessionId: ctx.sessionId,
        spans: [requestSpan, responseSpan],
      });
    } catch {
      // Best-effort; never block response.
    }
  });
}
