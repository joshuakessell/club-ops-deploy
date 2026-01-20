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

  it('ingests a single event and echoes x-request-id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/telemetry',
      headers: { 'x-request-id': 'ingest-1' },
      payload: {
        timestamp: new Date().toISOString(),
        app: 'customer-kiosk',
        level: 'error',
        kind: 'ui.error',
        message: 'boom',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-request-id']).toBe('ingest-1');

    const rows = await query<{
      app: string;
      kind: string;
      request_id: string | null;
      message: string | null;
    }>(`SELECT app, kind, request_id, message FROM telemetry_events ORDER BY id DESC LIMIT 1`);

    expect(rows.rows[0]?.app).toBe('customer-kiosk');
    expect(rows.rows[0]?.kind).toBe('ui.error');
    // Fallback when event.requestId is omitted.
    expect(rows.rows[0]?.request_id).toBe('ingest-1');
    expect(rows.rows[0]?.message).toBe('boom');
  });

  it('auto-captures backend 5xx responses with requestId', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/boom',
      headers: { 'x-request-id': 'req-500' },
    });

    expect(res.statusCode).toBe(500);
    expect(res.headers['x-request-id']).toBe('req-500');

    const rows = await query<{ kind: string; request_id: string | null }>(
      `SELECT kind, request_id FROM telemetry_events WHERE request_id = $1 ORDER BY id DESC`,
      ['req-500']
    );
    expect(rows.rows.some((r) => r.kind === 'backend.http_5xx')).toBe(true);
  });
});
