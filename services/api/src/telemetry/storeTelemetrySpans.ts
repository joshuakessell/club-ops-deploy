import crypto from 'node:crypto';
import { query } from '../db';
import { redactHeaders, sanitizeJsonBody } from './redact';
import type {
  TelemetryIngestPayload,
  TelemetrySpanInput,
  TelemetrySpanLevel,
  TelemetrySpanRow,
} from './spanTypes';

const ALLOWED_DEEP_APPS = new Set(['customer-kiosk', 'employee-register']);
const MAX_SPANS_PER_BATCH = 200;
const MAX_TEXT = 12_000;
const META_REDACT_KEYS = [
  'password',
  'passcode',
  'pin',
  'token',
  'secret',
  'apikey',
  'authorization',
  'cardnumber',
  'cvv',
  'cvc',
  'exp',
  'expiry',
  'expiration',
  'accountnumber',
  'routingnumber',
  'ssn',
];

function truncate(value: string, max = MAX_TEXT): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

function cleanText(value: unknown, max = MAX_TEXT): string | null {
  if (value == null) return null;
  const s = typeof value === 'string' ? value : String(value);
  const trimmed = s.trim();
  if (!trimmed) return null;
  return truncate(trimmed, max);
}

function safeString(value: unknown, max = 256): string | null {
  const cleaned = cleanText(value, max);
  return cleaned;
}

function parseDate(value: unknown): Date | null {
  if (typeof value === 'number') {
    const d = new Date(value);
    if (Number.isFinite(d.getTime())) return d;
  }
  if (typeof value === 'string') {
    const d = new Date(value);
    if (Number.isFinite(d.getTime())) return d;
  }
  return null;
}

function normalizeUrl(value: unknown): { url: string | null; queryKeys: string[] } {
  if (typeof value !== 'string' || !value.trim()) return { url: null, queryKeys: [] };
  try {
    const base = 'http://local.invalid';
    const u = new URL(value, base);
    const queryKeys = Array.from(new Set(Array.from(u.searchParams.keys())));
    u.search = '';
    u.hash = '';
    return { url: u.pathname || value, queryKeys };
  } catch {
    const [path] = value.split('?');
    return { url: path || value, queryKeys: [] };
  }
}

function sanitizeLevel(level: unknown): TelemetrySpanLevel {
  if (level === 'error' || level === 'warn' || level === 'info') return level;
  return 'info';
}

function toRequestKey(value: unknown): string | null {
  return safeString(value, 128);
}

function coerceJson(value: unknown): unknown | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof value === 'object') return value;
  return null;
}

function shouldRedactMetaKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return META_REDACT_KEYS.some((needle) => normalized.includes(needle));
}

function scrubMeta(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (depth > 8) return '[truncated]';
  if (Array.isArray(value)) return value.map((v) => scrubMeta(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = shouldRedactMetaKey(k) ? '[redacted]' : scrubMeta(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string') return truncate(value, 2000);
  return value;
}

function sanitizeSpanInput(
  input: TelemetrySpanInput,
  ctx: { traceId: string; app: string; deviceId: string; sessionId: string; allowDeep: boolean }
): TelemetrySpanRow | null {
  const spanType = safeString(input.spanType, 80);
  if (!spanType) return null;

  const startedAt = parseDate(input.startedAt) ?? new Date();
  const endedAt = parseDate(input.endedAt);
  const durationMs =
    typeof input.durationMs === 'number' && Number.isFinite(input.durationMs)
      ? Math.round(input.durationMs)
      : endedAt
        ? Math.max(0, endedAt.getTime() - startedAt.getTime())
        : null;

  const { url, queryKeys } = normalizeUrl(input.url);
  const meta: Record<string, unknown> = {
    ...(input.meta && typeof input.meta === 'object'
      ? (scrubMeta(input.meta) as Record<string, unknown>)
      : {}),
  };
  if (queryKeys.length > 0) meta.queryKeys = queryKeys;

  let requestHeaders: Record<string, unknown> | null = null;
  let responseHeaders: Record<string, unknown> | null = null;
  let requestBody: unknown | null = null;
  let responseBody: unknown | null = null;

  if (ctx.allowDeep) {
    if (input.requestHeaders) {
      requestHeaders = redactHeaders(input.requestHeaders);
    }
    if (input.responseHeaders) {
      responseHeaders = redactHeaders(input.responseHeaders);
    }
    if (input.requestBody !== undefined) {
      const sanitized = sanitizeJsonBody(
        coerceJson(input.requestBody),
        input.route ?? url,
        'request'
      );
      requestBody = sanitized.body;
      Object.assign(meta, sanitized.meta);
    }
    if (input.responseBody !== undefined) {
      const sanitized = sanitizeJsonBody(
        coerceJson(input.responseBody),
        input.route ?? url,
        'response'
      );
      responseBody = sanitized.body;
      Object.assign(meta, sanitized.meta);
    }
  }

  return {
    traceId: ctx.traceId,
    app: ctx.app,
    deviceId: ctx.deviceId,
    sessionId: ctx.sessionId,
    spanType,
    name: cleanText(input.name, 200),
    level: sanitizeLevel(input.level),
    startedAt,
    endedAt,
    durationMs,
    route: cleanText(input.route, 512),
    method: cleanText(input.method, 16),
    status:
      typeof input.status === 'number' && Number.isFinite(input.status)
        ? Math.trunc(input.status)
        : null,
    url,
    message: cleanText(input.message, 4000),
    stack: cleanText(input.stack, 12_000),
    requestHeaders,
    responseHeaders,
    requestBody,
    responseBody,
    requestKey: toRequestKey(input.requestKey),
    incidentId: cleanText(input.incidentId, 128),
    incidentReason: cleanText(input.incidentReason, 200),
    meta,
  };
}

function ensureTraceId(raw?: string | null): string {
  const trimmed = raw?.trim();
  if (trimmed) return trimmed;
  return crypto.randomUUID();
}

function buildSpanInsert(rows: TelemetrySpanRow[]) {
  const values: unknown[] = [];
  const rowsSql = rows
    .map((row) => {
      const base = values.length;
      values.push(
        row.traceId,
        row.app,
        row.deviceId,
        row.sessionId,
        row.spanType,
        row.name,
        row.level,
        row.startedAt,
        row.endedAt,
        row.durationMs,
        row.route,
        row.method,
        row.status,
        row.url,
        row.message,
        row.stack,
        row.requestHeaders,
        row.responseHeaders,
        row.requestBody,
        row.responseBody,
        row.requestKey,
        row.incidentId,
        row.incidentReason,
        row.meta
      );
      const placeholders = Array.from({ length: 24 }, (_, i) => `$${base + i + 1}`).join(', ');
      return `(${placeholders})`;
    })
    .join(', ');

  return { values, rowsSql };
}

export async function storeTelemetrySpans(payload: TelemetryIngestPayload): Promise<void> {
  if (process.env.SKIP_DB === 'true') return;
  const spans = Array.isArray(payload.spans) ? payload.spans.slice(0, MAX_SPANS_PER_BATCH) : [];
  if (spans.length === 0) return;

  const traceId = ensureTraceId(payload.traceId);
  const app = safeString(payload.app, 100) ?? 'unknown';
  const deviceId = safeString(payload.deviceId, 255) ?? 'unknown';
  const sessionId = safeString(payload.sessionId, 128) ?? 'unknown';
  const allowDeep = ALLOWED_DEEP_APPS.has(app);

  const cleaned = spans
    .map((s) => sanitizeSpanInput(s, { traceId, app, deviceId, sessionId, allowDeep }))
    .filter((s): s is TelemetrySpanRow => !!s);

  if (cleaned.length === 0) return;

  const hasIncidentSpan =
    cleaned.some((s) => s.incidentId) || cleaned.some((s) => s.spanType.startsWith('incident.'));
  const hasIncidentEnd = cleaned.some((s) => s.spanType === 'incident.end');
  const hasIncidentPayload = payload.incident?.incidentId || payload.incident?.reason;

  const now = new Date();
  const incidentLastAt = hasIncidentSpan || hasIncidentPayload ? now : null;

  await query(
    `
    INSERT INTO telemetry_traces (
      trace_id, app, device_id, session_id, started_at, last_seen_at, incident_open, incident_last_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (trace_id)
    DO UPDATE SET
      app = EXCLUDED.app,
      device_id = EXCLUDED.device_id,
      session_id = EXCLUDED.session_id,
      last_seen_at = EXCLUDED.last_seen_at,
      incident_open = CASE
        WHEN $9::boolean THEN false
        WHEN $10::boolean THEN true
        ELSE telemetry_traces.incident_open
      END,
      incident_last_at = CASE
        WHEN $11::boolean THEN EXCLUDED.last_seen_at
        ELSE telemetry_traces.incident_last_at
      END
    `,
    [
      traceId,
      app,
      deviceId,
      sessionId,
      now,
      now,
      !hasIncidentEnd && (hasIncidentSpan || hasIncidentPayload),
      incidentLastAt,
      hasIncidentEnd,
      hasIncidentSpan || hasIncidentPayload,
      hasIncidentSpan || hasIncidentPayload || hasIncidentEnd,
    ]
  );

  const { values, rowsSql } = buildSpanInsert(cleaned);
  if (!rowsSql) return;

  await query(
    `
    INSERT INTO telemetry_spans (
      trace_id, app, device_id, session_id, span_type, name, level,
      started_at, ended_at, duration_ms, route, method, status, url, message, stack,
      request_headers, response_headers, request_body, response_body,
      request_key, incident_id, incident_reason, meta
    )
    VALUES ${rowsSql}
    `,
    values
  );
}
