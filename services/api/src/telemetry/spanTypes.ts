export type TelemetrySpanLevel = 'error' | 'warn' | 'info';

export type TelemetrySpanInput = {
  spanType?: string;
  name?: string;
  level?: TelemetrySpanLevel;
  startedAt?: string | number;
  endedAt?: string | number;
  durationMs?: number;
  route?: string;
  method?: string;
  status?: number;
  url?: string;
  message?: string;
  stack?: string;
  requestHeaders?: Record<string, unknown>;
  responseHeaders?: Record<string, unknown>;
  requestBody?: unknown;
  responseBody?: unknown;
  requestKey?: string;
  incidentId?: string;
  incidentReason?: string;
  meta?: Record<string, unknown>;
};

export type TelemetrySpanRow = {
  traceId: string;
  app: string;
  deviceId: string;
  sessionId: string;
  spanType: string;
  name: string | null;
  level: TelemetrySpanLevel;
  startedAt: Date;
  endedAt: Date | null;
  durationMs: number | null;
  route: string | null;
  method: string | null;
  status: number | null;
  url: string | null;
  message: string | null;
  stack: string | null;
  requestHeaders: Record<string, unknown> | null;
  responseHeaders: Record<string, unknown> | null;
  requestBody: unknown | null;
  responseBody: unknown | null;
  requestKey: string | null;
  incidentId: string | null;
  incidentReason: string | null;
  meta: Record<string, unknown>;
};

export type TelemetryIngestPayload = {
  traceId?: string;
  app?: string;
  deviceId?: string;
  sessionId?: string;
  spans?: TelemetrySpanInput[];
  incident?: { incidentId?: string; reason?: string; startedAt?: string | number };
};
