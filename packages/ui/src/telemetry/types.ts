export type TelemetryLevel = 'error' | 'warn' | 'info';

export type TelemetrySpanInput = {
  spanType: string;
  name?: string;
  level?: TelemetryLevel;
  startedAt?: string;
  endedAt?: string;
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

export type TelemetryContext = {
  app: string;
  route: string;
  sessionId: string;
  deviceId: string;
  traceId: string;
  incidentId?: string;
  lane?: string;
};

export type TelemetryClient = {
  capture: (span: TelemetrySpanInput) => void;
  flush: (opts?: { useBeacon?: boolean }) => void;
  startIncident: (reason: string, opts?: { forceNew?: boolean }) => string;
  endIncident: () => void;
  setTraceId: (traceId: string) => void;
  getContext: () => TelemetryContext;
  flushBreadcrumbs: (opts?: { useBeacon?: boolean }) => void;
};

