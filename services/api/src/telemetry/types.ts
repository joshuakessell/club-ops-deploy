export type TelemetryLevel = 'error' | 'warn' | 'info';

export type TelemetryEventInput = {
  timestamp?: string | number;
  app?: string;
  level?: TelemetryLevel;
  kind?: string;
  route?: string;
  message?: string;
  stack?: string;
  requestId?: string;
  sessionId?: string;
  deviceId?: string;
  lane?: string;
  method?: string;
  status?: number;
  url?: string;
  meta?: unknown;
};

export type TelemetryEventRow = {
  createdAt: Date;
  app: string;
  level: TelemetryLevel;
  kind: string;
  route: string | null;
  message: string | null;
  stack: string | null;
  requestId: string | null;
  sessionId: string | null;
  deviceId: string | null;
  lane: string | null;
  method: string | null;
  status: number | null;
  url: string | null;
  meta: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toTruncatedString(value: unknown, maxLen: number): string | null {
  if (value == null) return null;
  const s = typeof value === 'string' ? value : String(value);
  const trimmed = s.trim();
  if (!trimmed) return null;
  return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen)}…` : trimmed;
}

function toDate(timestamp: unknown): Date {
  if (typeof timestamp === 'number') {
    const d = new Date(timestamp);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (typeof timestamp === 'string') {
    const d = new Date(timestamp);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

function sanitizeMeta(meta: unknown): Record<string, unknown> {
  if (meta == null) return {};
  if (isRecord(meta)) return meta;
  if (Array.isArray(meta)) return { items: meta };
  return { value: meta };
}

export function sanitizeTelemetryEventInput(input: unknown): TelemetryEventRow | null {
  if (!input || typeof input !== 'object') return null;
  const e = input as TelemetryEventInput;

  const app = toTruncatedString(e.app, 64);
  const level = (e.level ?? 'error') as TelemetryLevel;
  const kind = toTruncatedString(e.kind, 64);
  if (!app || !kind) return null;
  if (level !== 'error' && level !== 'warn' && level !== 'info') return null;

  return {
    createdAt: toDate(e.timestamp),
    app,
    level,
    kind,
    route: toTruncatedString(e.route, 256),
    message: toTruncatedString(e.message, 2000),
    stack: toTruncatedString(e.stack, 8000),
    requestId: toTruncatedString(e.requestId, 128),
    sessionId: toTruncatedString(e.sessionId, 128),
    deviceId: toTruncatedString(e.deviceId, 128),
    lane: toTruncatedString(e.lane, 64),
    method: toTruncatedString(e.method, 16),
    status: typeof e.status === 'number' && Number.isFinite(e.status) ? Math.trunc(e.status) : null,
    url: toTruncatedString(e.url, 2000),
    meta: sanitizeMeta(e.meta),
  };
}
