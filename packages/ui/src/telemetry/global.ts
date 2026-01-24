import type { TelemetryClient } from './types.js';

const TELEMETRY_KEY = '__clubOpsTelemetryClient';

export function getInstalledTelemetry(): TelemetryClient | null {
  return (
    ((globalThis as unknown as Record<string, unknown>)[TELEMETRY_KEY] as TelemetryClient | null) ??
    null
  );
}

export function setInstalledTelemetry(client: TelemetryClient | null): void {
  (globalThis as unknown as Record<string, unknown>)[TELEMETRY_KEY] = client;
}
