import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { initializeDatabase, query, closeDatabase } from '../src/db/index.js';
import { truncateAllTables } from './testDb.js';
import { setupTelemetry } from '../src/telemetry/plugin.js';

describe('Telemetry', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await initializeDatabase();
    app = Fastify({ logger: false });
    await setupTelemetry(app);

    app.get('/boom', async (_req, reply) => {
      reply.code(500).send({ ok: false });
    });

    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables((text, params) => query(text, params));
  });

  afterAll(async () => {
    try {
      await app.close();
    } finally {
      // Critical: DB pool keeps TCP handles open and can cause Vitest to hang.
      await closeDatabase();
    }
  });

  it('ingests spans and echoes x-request-id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/telemetry',
      headers: { 'x-request-id': 'ingest-1' },
      payload: {
        traceId: 'trace-1',
        app: 'customer-kiosk',
        deviceId: 'device-1',
        sessionId: 'session-1',
        spans: [
          {
            spanType: 'ui.click',
            level: 'info',
            name: 'Click: Submit',
            route: '/start',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-request-id']).toBe('ingest-1');

    const rows = await query<{
      span_type: string;
      trace_id: string;
      app: string;
      device_id: string;
      session_id: string;
    }>(
      `SELECT span_type, trace_id, app, device_id, session_id FROM telemetry_spans ORDER BY started_at DESC LIMIT 1`
    );

    expect(rows.rows[0]?.span_type).toBe('ui.click');
    expect(rows.rows[0]?.trace_id).toBe('trace-1');
    expect(rows.rows[0]?.app).toBe('customer-kiosk');
    expect(rows.rows[0]?.device_id).toBe('device-1');
    expect(rows.rows[0]?.session_id).toBe('session-1');
  });

  it('auto-captures backend 5xx responses', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/boom',
      headers: { 'x-request-id': 'req-500' },
    });

    expect(res.statusCode).toBe(500);
    expect(res.headers['x-request-id']).toBe('req-500');

    const rows = await query<{ span_type: string; status: number | null }>(
      `SELECT span_type, status FROM telemetry_spans WHERE status = 500 ORDER BY started_at DESC`
    );
    expect(rows.rows.some((r) => r.span_type === 'api.response')).toBe(true);
  });
});
