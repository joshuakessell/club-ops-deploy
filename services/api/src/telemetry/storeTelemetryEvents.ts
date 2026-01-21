import type { FastifyRequest } from 'fastify';
import { query } from '../db/index.js';

export type TelemetryLevel = 'error' | 'warn' | 'info';

export type TelemetryEventInput = {
  // Provided by client or backend hook
  ts?: string;

  app: string; // 'customer-kiosk' | 'employee-register' | 'api'
  env?: string;

  kind: string;
  level: TelemetryLevel;

  // Correlation / context
  requestId?: string;
  sessionId?: string;
  deviceId?: string;
  lane?: string;
  route?: string;

  // Message
  message?: string;
  stack?: string;

  // HTTP context
  url?: string;
  method?: string;
  status?: number;

  // Extra
  meta?: Record<string, unknown>;
};

type StoreOptions = {
  ip?: string | null;
  userAgent?: string | null;
};

const MAX_EVENTS_PER_BATCH = 200;
const MAX_TEXT = 12_000;
const DEDUPE_WINDOW_MS = 2_000;
const dedupe = new Map<string, number>();

function nowMs() {
  return Date.now();
}

function truncate(value: string, max = MAX_TEXT): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

function cleanText(value: unknown): string | null {
  if (value == null) return null;
  const s = typeof value === 'string' ? value : String(value);
  const trimmed = s.trim();
  if (!trimmed) return null;
  return truncate(trimmed);
}

function cleanEnv(value: unknown): string {
  const s = typeof value === 'string' ? value.trim() : '';
  return s || 'unknown';
}

function normalizeUrl(value: unknown): { url: string | null; queryKeys: string[] } {
  if (typeof value !== 'string' || !value.trim()) return { url: null, queryKeys: [] };
  try {
    // Works for absolute or relative URLs
    const base = 'http://local.invalid';
    const u = new URL(value, base);
    const queryKeys = Array.from(new Set(Array.from(u.searchParams.keys())));
    u.search = '';
    u.hash = '';
    return { url: u.pathname || value, queryKeys };
  } catch {
    // Best-effort: strip query manually
    const [path] = value.split('?');
    return { url: path || value, queryKeys: [] };
  }
}

function fingerprint(e: TelemetryEventInput): string {
  return [
    e.app,
    e.kind,
    e.level,
    e.message || '',
    e.stack || '',
    e.url || '',
    e.method || '',
    e.status ?? '',
    e.requestId || '',
  ].join('|');
}

function shouldStore(e: TelemetryEventInput): boolean {
  const fp = fingerprint(e);
  const t = nowMs();
  const last = dedupe.get(fp);
  if (last != null && t - last < DEDUPE_WINDOW_MS) return false;
  dedupe.set(fp, t);

  // prune map occasionally
  if (dedupe.size > 5000) {
    const cutoff = t - 60_000;
    for (const [k, v] of dedupe.entries()) {
      if (v < cutoff) dedupe.delete(k);
    }
  }
  return true;
}

export function getRequestId(request: FastifyRequest): string {
  const fromHeader = request.headers['x-request-id'];
  if (typeof fromHeader === 'string' && fromHeader.trim()) return fromHeader.trim();
  // fallback
  try {
    return crypto.randomUUID();
  } catch {
    return `req-${Math.random().toString(16).slice(2)}`;
  }
}

export async function storeTelemetryEvents(
  events: TelemetryEventInput[],
  opts: StoreOptions = {}
): Promise<void> {
  if (process.env.SKIP_DB === 'true') return;
  if (!Array.isArray(events) || events.length === 0) return;

  const env = cleanEnv(process.env.NODE_ENV);

  const cleaned = events
    .slice(0, MAX_EVENTS_PER_BATCH)
    .map((e) => {
      const { url, queryKeys } = normalizeUrl(e.url);
      const meta =
        e.meta && typeof e.meta === 'object'
          ? { ...e.meta, ...(queryKeys.length ? { queryKeys } : {}) }
          : queryKeys.length
            ? { queryKeys }
            : null;

      const createdAt = cleanText(e.ts) || new Date().toISOString();

      return {
        createdAt,
        app: cleanText(e.app) || 'unknown',
        env: cleanEnv(e.env) || env,
        kind: cleanText(e.kind) || 'unknown',
        level: e.level || 'error',

        requestId: cleanText(e.requestId) || undefined,
        sessionId: cleanText(e.sessionId) || undefined,
        deviceId: cleanText(e.deviceId) || undefined,
        lane: cleanText(e.lane) || undefined,
        route: cleanText(e.route) || undefined,

        message: cleanText(e.message) || undefined,
        stack: cleanText(e.stack) || undefined,

        url: url || undefined,
        method: cleanText(e.method) || undefined,
        status: typeof e.status === 'number' ? e.status : undefined,

        userAgent: cleanText(opts.userAgent) || undefined,
        ipAddress: cleanText(opts.ip) || undefined,

        meta: meta || undefined,
      };
    })
    .filter((e) => shouldStore(e));

  if (cleaned.length === 0) return;

  // Multi-row insert
  const cols = [
    'created_at',
    'app',
    'env',
    'kind',
    'level',
    'request_id',
    'session_id',
    'device_id',
    'lane',
    'route',
    'message',
    'stack',
    'url',
    'method',
    'status',
    'user_agent',
    'ip_address',
    'meta',
  ] as const;

  const values: unknown[] = [];
  const rowsSql = cleaned
    .map((e) => {
      const base = values.length;
      values.push(
        e.createdAt,
        e.app,
        e.env,
        e.kind,
        e.level,
        e.requestId ?? null,
        e.sessionId ?? null,
        e.deviceId ?? null,
        e.lane ?? null,
        e.route ?? null,
        e.message ?? null,
        e.stack ?? null,
        e.url ?? null,
        e.method ?? null,
        e.status ?? null,
        e.userAgent ?? null,
        e.ipAddress ?? null,
        e.meta ?? null
      );
      const placeholders = cols.map((_, i) => `$${base + i + 1}`).join(', ');
      return `(${placeholders})`;
    })
    .join(', ');

  const sql = `INSERT INTO telemetry_events (${cols.join(', ')}) VALUES ${rowsSql}`;
  try {
    await query(sql, values);
  } catch {
    // never throw from telemetry
  }
}

export function extractErrorLike(value: unknown): { message?: string; stack?: string } {
  if (value instanceof Error) return { message: value.message, stack: value.stack };
  if (value && typeof value === 'object') {
    const maybeMessage = (value as Record<string, unknown>)['message'];
    const maybeStack = (value as Record<string, unknown>)['stack'];
    return {
      message: typeof maybeMessage === 'string' ? maybeMessage : undefined,
      stack: typeof maybeStack === 'string' ? maybeStack : undefined,
    };
  }
  if (typeof value === 'string') return { message: value };
  return { message: undefined, stack: undefined };
}

