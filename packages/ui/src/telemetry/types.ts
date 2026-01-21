export type TelemetryLevel = 'error' | 'warn' | 'info';

export type TelemetryEvent = {
  timestamp: string;
  app: string;
  level: TelemetryLevel;
  kind: string;
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
  meta?: Record<string, unknown>;
};

export type TelemetryClient = {
  capture: (event: Omit<TelemetryEvent, 'timestamp' | 'app'> & { app?: string }) => void;
  flush: (opts?: { useBeacon?: boolean }) => void;
  getContext: () => {
    app: string;
    route: string;
    sessionId: string;
    deviceId: string;
    lane?: string;
  };
};

