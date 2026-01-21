import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';

import { createBroadcaster } from '../src/websocket/broadcaster.js';
import { registerWsRoute } from '../src/websocket/wsRoute.js';
import { sessionRoutes } from '../src/routes/sessions.js';
import { cleaningRoutes } from '../src/routes/cleaning.js';
import { agreementRoutes } from '../src/routes/agreements.js';

function randomUuid(): string {
  // Good enough for tests that only need a syntactically-valid UUID.
  return '00000000-0000-4000-8000-000000000000';
}

describe('Auth enforcement (unauthenticated mutations)', () => {
  const TEST_KIOSK_TOKEN = 'test-kiosk-token';
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.KIOSK_TOKEN = TEST_KIOSK_TOKEN;

    app = Fastify({ logger: false });
    await app.register(websocket, {
      options: {
        handleProtocols: (protocols) => {
          for (const p of protocols) return p;
          return false;
        },
      },
    });

    const broadcaster = createBroadcaster();
    app.decorate('broadcaster', broadcaster);
    await registerWsRoute(app, broadcaster);

    await app.register(sessionRoutes);
    await app.register(cleaningRoutes);
    await app.register(agreementRoutes);

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects POST /v1/sessions without staff auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      payload: { customerId: randomUuid(), roomId: randomUuid() },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects POST /v1/sessions/scan-id without staff auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions/scan-id',
      payload: { idNumber: '123', lane: 'lane-1' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects POST /v1/sessions/scan-membership without staff auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions/scan-membership',
      payload: { membershipNumber: '123', lane: 'lane-1' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects POST /v1/cleaning/batch without staff auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/cleaning/batch',
      payload: { roomIds: [randomUuid()], targetStatus: 'CLEANING', override: false },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects POST /v1/checkins/:checkinId/agreement-sign without kiosk token or staff auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/checkins/${randomUuid()}/agreement-sign`,
      payload: { agreed: true },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects /ws without kiosk token or staff auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/ws?lane=lane-1',
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects /ws with invalid lane, even with kiosk token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/ws?lane=not-a-lane',
      headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
    });
    expect(res.statusCode).toBe(400);
  });

  it('allows /ws auth + lane validation to pass with kiosk token and valid lane', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/ws?lane=lane-1',
      headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
    });
    // Not a real websocket upgrade, but the auth/lane preHandlers ran and accepted it.
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(400);
  });

  it('allows /ws auth + lane validation to pass with kiosk token in Sec-WebSocket-Protocol', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/ws?lane=lane-1',
      headers: { 'sec-websocket-protocol': `kiosk-token.${TEST_KIOSK_TOKEN}` },
    });
    // Not a real websocket upgrade, but the auth/lane preHandlers ran and accepted it.
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(400);
  });
});

