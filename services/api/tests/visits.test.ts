import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import pg from 'pg';
import { visitRoutes } from '../src/routes/visits.js';
import { agreementRoutes } from '../src/routes/agreements.js';
import { createBroadcaster } from '../src/websocket/broadcaster.js';

// Mock auth middleware to allow test requests
vi.mock('../src/auth/middleware.js', () => ({
  requireAuth: async (request: any, _reply: any) => {
    request.staff = { staffId: 'test-staff', role: 'STAFF' };
  },
  requireAdmin: async (_request: any, _reply: any) => {
    // No-op for tests
  },
  requireReauth: async (request: any, _reply: any) => {
    request.staff = { staffId: 'test-staff', role: 'STAFF' };
  },
  requireReauthForAdmin: async (request: any, _reply: any) => {
    request.staff = { staffId: 'test-staff', role: 'ADMIN' };
  },
}));

describe('Visit and Renewal Flows', () => {
  let fastify: FastifyInstance;
  let pool: pg.Pool;
  let dbAvailable = false;

  const testCustomerId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const testRoomId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const testAgreementId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

  beforeAll(async () => {
    const dbConfig = {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5433', 10),
      database: process.env.DB_NAME || 'club_operations',
      user: process.env.DB_USER || 'clubops',
      password: process.env.DB_PASSWORD || 'clubops_dev',
      connectionTimeoutMillis: 3000,
    };

    pool = new pg.Pool(dbConfig);

    try {
      await pool.query('SELECT 1');
      dbAvailable = true;
    } catch {
      console.warn('\n⚠️  Database not available. Integration tests will be skipped.\n');
      return;
    }

    fastify = Fastify();
    const broadcaster = createBroadcaster();
    fastify.decorate('broadcaster', broadcaster);

    // Register routes
    await fastify.register(visitRoutes);
    await fastify.register(agreementRoutes);
    await fastify.ready();
  });

  afterAll(async () => {
    if (dbAvailable && fastify) await fastify.close();
    if (pool) await pool.end();
  });

  beforeEach(async () => {
    if (!dbAvailable) return;

    // Clean up test data - delete in order to respect foreign key constraints
    await pool.query('DELETE FROM agreement_signatures WHERE checkin_block_id IN (SELECT id FROM checkin_blocks WHERE visit_id IN (SELECT id FROM visits WHERE customer_id = $1))', [testCustomerId]);
    await pool.query('DELETE FROM charges WHERE visit_id IN (SELECT id FROM visits WHERE customer_id = $1)', [testCustomerId]);
    await pool.query('DELETE FROM checkin_blocks WHERE visit_id IN (SELECT id FROM visits WHERE customer_id = $1)', [testCustomerId]);
    await pool.query('DELETE FROM sessions WHERE visit_id IN (SELECT id FROM visits WHERE customer_id = $1) OR customer_id = $1', [testCustomerId]);
    await pool.query('DELETE FROM visits WHERE customer_id = $1', [testCustomerId]);
    await pool.query('DELETE FROM checkout_requests WHERE customer_id = $1', [testCustomerId]);
    await pool.query('DELETE FROM rooms WHERE id = $1 OR number = $2', [testRoomId, 'TEST-101']);
    await pool.query('DELETE FROM agreements WHERE id = $1', [testAgreementId]);
    await pool.query('DELETE FROM customers WHERE id = $1 OR membership_number = $2', [testCustomerId, 'TEST-001']);

    // Insert test customer with ON CONFLICT handling for both id and membership_number
    await pool.query(
      `INSERT INTO customers (id, name, membership_number)
       VALUES ($1, 'Test Customer', 'TEST-001')
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, membership_number = EXCLUDED.membership_number`,
      [testCustomerId]
    );

    // Insert test room with ON CONFLICT handling (handle number conflicts)
    await pool.query(
      `INSERT INTO rooms (id, number, type, status, floor)
       VALUES ($1, 'TEST-101', 'STANDARD', 'CLEAN', 1)
       ON CONFLICT (number) DO UPDATE SET id = EXCLUDED.id, type = EXCLUDED.type, status = EXCLUDED.status, floor = EXCLUDED.floor`,
      [testRoomId]
    );

    // Insert active agreement with ON CONFLICT handling
    await pool.query(
      `INSERT INTO agreements (id, version, title, body_text, active)
       VALUES ($1, 'placeholder-v1', 'Club Agreement', '', true)
       ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version, title = EXCLUDED.title, body_text = EXCLUDED.body_text, active = EXCLUDED.active`,
      [testAgreementId]
    );
  });

  const runIfDbAvailable = (testFn: () => Promise<void>) => async () => {
    if (!dbAvailable) {
      console.log('    ↳ Skipped (database not available)');
      return;
    }
    await testFn();
  };

  it('should create an initial visit with initial block', runIfDbAvailable(async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/v1/visits',
      payload: {
        customerId: testCustomerId,
        rentalType: 'STANDARD',
        roomId: testRoomId,
      },
    });

    expect(response.statusCode).toBe(201);
    const data = JSON.parse(response.body);
    expect(data.visit).toBeDefined();
    expect(data.visit.customerId).toBe(testCustomerId);
    expect(data.block).toBeDefined();
    expect(data.block.blockType).toBe('INITIAL');
    expect(data.block.rentalType).toBe('STANDARD');
    expect(data.sessionId).toBeDefined();

    // Verify block duration is 6 hours
    const startsAt = new Date(data.block.startsAt);
    const endsAt = new Date(data.block.endsAt);
    const durationHours = (endsAt.getTime() - startsAt.getTime()) / (1000 * 60 * 60);
    expect(durationHours).toBe(6);
  }));

  it('should create renewal block that extends from previous checkout time, not from now', runIfDbAvailable(async () => {
    // Create initial visit
    const initialResponse = await fastify.inject({
      method: 'POST',
      url: '/v1/visits',
      payload: {
        customerId: testCustomerId,
        rentalType: 'STANDARD',
        roomId: testRoomId,
      },
    });

    const initialData = JSON.parse(initialResponse.body);
    const visitId = initialData.visit.id;
    const initialBlockEndsAt = new Date(initialData.block.endsAt);

    // Wait a bit to ensure "now" is different from initial checkout
    await new Promise(resolve => setTimeout(resolve, 100));

    // Create renewal
    const renewalResponse = await fastify.inject({
      method: 'POST',
      url: `/v1/visits/${visitId}/renew`,
      payload: {
        rentalType: 'STANDARD',
        roomId: testRoomId,
      },
    });

    expect(renewalResponse.statusCode).toBe(201);
    const renewalData = JSON.parse(renewalResponse.body);
    expect(renewalData.block.blockType).toBe('RENEWAL');

    const renewalStartsAt = new Date(renewalData.block.startsAt);
    const renewalEndsAt = new Date(renewalData.block.endsAt);

    // Renewal should start from previous checkout time (within 1 second tolerance)
    expect(Math.abs(renewalStartsAt.getTime() - initialBlockEndsAt.getTime())).toBeLessThan(1000);

    // Renewal should end 6 hours after it starts
    const renewalDurationHours = (renewalEndsAt.getTime() - renewalStartsAt.getTime()) / (1000 * 60 * 60);
    expect(renewalDurationHours).toBe(6);

    // Renewal should NOT start from "now" - verify it's close to initial checkout time
    const now = new Date();
    expect(Math.abs(renewalStartsAt.getTime() - initialBlockEndsAt.getTime())).toBeLessThan(1000);
  }));

  it('should enforce 14-hour maximum visit duration', runIfDbAvailable(async () => {
    // Create initial visit (6 hours)
    const initialResponse = await fastify.inject({
      method: 'POST',
      url: '/v1/visits',
      payload: {
        customerId: testCustomerId,
        rentalType: 'STANDARD',
        roomId: testRoomId,
      },
    });

    const initialData = JSON.parse(initialResponse.body);
    const visitId = initialData.visit.id;

    // Create first renewal (6 hours, total 12 hours)
    const renewal1Response = await fastify.inject({
      method: 'POST',
      url: `/v1/visits/${visitId}/renew`,
      payload: {
        rentalType: 'STANDARD',
        roomId: testRoomId,
      },
    });

    expect(renewal1Response.statusCode).toBe(201);

    // Try to create second renewal (would be 18 hours total, should fail)
    const renewal2Response = await fastify.inject({
      method: 'POST',
      url: `/v1/visits/${visitId}/renew`,
      payload: {
        rentalType: 'STANDARD',
        roomId: testRoomId,
      },
    });

    expect(renewal2Response.statusCode).toBe(400);
    const error = JSON.parse(renewal2Response.body);
    expect(error.error).toContain('14-hour maximum');
  }));

  it('should require agreement signature for INITIAL block', runIfDbAvailable(async () => {
    // Create initial visit
    const visitResponse = await fastify.inject({
      method: 'POST',
      url: '/v1/visits',
      payload: {
        customerId: testCustomerId,
        rentalType: 'STANDARD',
        roomId: testRoomId,
      },
    });

    const visitData = JSON.parse(visitResponse.body);
    const sessionId = visitData.sessionId;

    // Sign agreement
    const signResponse = await fastify.inject({
      method: 'POST',
      url: `/v1/checkins/${sessionId}/agreement-sign`,
      payload: {
        signaturePngBase64: 'dGVzdC1zaWduYXR1cmU=',
        agreed: true,
      },
      headers: {
        'x-device-type': 'customer-kiosk',
        'x-device-id': 'test-device',
      },
    });

    expect(signResponse.statusCode).toBe(200);

    // Verify block is marked as agreement signed
    const blockResult = await pool.query(
      'SELECT agreement_signed FROM checkin_blocks WHERE session_id = $1',
      [sessionId]
    );
    expect(blockResult.rows[0]?.agreement_signed).toBe(true);

    // Verify signature is linked to block
    const signatureResult = await pool.query(
      'SELECT checkin_block_id FROM agreement_signatures WHERE checkin_id = $1',
      [sessionId]
    );
    expect(signatureResult.rows[0]?.checkin_block_id).toBeDefined();
  }));

  it('should require agreement signature for RENEWAL block', runIfDbAvailable(async () => {
    // Create initial visit
    const initialResponse = await fastify.inject({
      method: 'POST',
      url: '/v1/visits',
      payload: {
        customerId: testCustomerId,
        rentalType: 'STANDARD',
        roomId: testRoomId,
      },
    });

    const initialData = JSON.parse(initialResponse.body);
    const visitId = initialData.visit.id;

    // Create renewal
    const renewalResponse = await fastify.inject({
      method: 'POST',
      url: `/v1/visits/${visitId}/renew`,
      payload: {
        rentalType: 'STANDARD',
        roomId: testRoomId,
      },
    });

    const renewalData = JSON.parse(renewalResponse.body);
    const renewalSessionId = renewalData.sessionId;

    // Sign agreement for renewal
    const signResponse = await fastify.inject({
      method: 'POST',
      url: `/v1/checkins/${renewalSessionId}/agreement-sign`,
      payload: {
        signaturePngBase64: 'dGVzdC1zaWduYXR1cmU=',
        agreed: true,
      },
      headers: {
        'x-device-type': 'customer-kiosk',
        'x-device-id': 'test-device',
      },
    });

    expect(signResponse.statusCode).toBe(200);

    // Verify renewal block is marked as agreement signed
    const blockResult = await pool.query(
      'SELECT agreement_signed FROM checkin_blocks WHERE session_id = $1',
      [renewalSessionId]
    );
    expect(blockResult.rows[0]?.agreement_signed).toBe(true);
    expect(blockResult.rows[0]?.agreement_signed).toBe(true);
  }));

  it('should search active visits by membership number', runIfDbAvailable(async () => {
    // Create initial visit
    await fastify.inject({
      method: 'POST',
      url: '/v1/visits',
      payload: {
        customerId: testCustomerId,
        rentalType: 'STANDARD',
        roomId: testRoomId,
      },
    });

    // Search for active visit
    const searchResponse = await fastify.inject({
      method: 'GET',
      url: `/v1/visits/active?membershipNumber=TEST-001`,
    });

    expect(searchResponse.statusCode).toBe(200);
    const data = JSON.parse(searchResponse.body);
    expect(data.visits).toBeDefined();
    expect(data.visits.length).toBeGreaterThan(0);
    expect(data.visits[0]?.customerId).toBe(testCustomerId);
    expect(data.visits[0]?.currentCheckoutAt).toBeDefined();
    expect(data.visits[0]?.totalHoursIfRenewed).toBe(12); // 6 + 6
    expect(data.visits[0]?.canFinalExtend).toBe(true); // Can extend if total would be <= 14
  }));
});


