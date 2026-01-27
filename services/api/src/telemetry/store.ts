import { query } from '../db';
import type { TelemetryEventRow } from './types';

export async function insertTelemetryEvents(events: TelemetryEventRow[]): Promise<void> {
  if (process.env.SKIP_DB === 'true') return;
  if (events.length === 0) return;

  // Avoid huge statements; telemetry is best-effort.
  const batch = events.slice(0, 200);

  const values: unknown[] = [];
  const rowsSql: string[] = [];

  for (const e of batch) {
    const base = values.length;
    values.push(
      e.createdAt,
      e.app,
      e.level,
      e.kind,
      e.route,
      e.message,
      e.stack,
      e.requestId,
      e.sessionId,
      e.deviceId,
      e.lane,
      e.method,
      e.status,
      e.url,
      e.meta
    );
    rowsSql.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14}, $${base + 15})`
    );
  }

  await query(
    `
    INSERT INTO telemetry_events (
      created_at, app, level, kind, route, message, stack,
      request_id, session_id, device_id, lane,
      method, status, url, meta
    )
    VALUES ${rowsSql.join(', ')}
    `,
    values
  );
}
