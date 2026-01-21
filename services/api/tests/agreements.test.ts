import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import pg from 'pg';
import { agreementRoutes } from '../src/routes/agreements.js';
import { sessionRoutes } from '../src/routes/sessions.js';
import { upgradeRoutes } from '../src/routes/upgrades.js';
import { createBroadcaster } from '../src/websocket/broadcaster.js';
import { truncateAllTables } from './testDb.js';

// Mock auth middleware to allow test requests
const testStaffId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
vi.mock('../src/auth/middleware.js', () => ({
  requireAuth: async (request: any, _reply: any) => {
    request.staff = { staffId: testStaffId, role: 'STAFF' };
  },
  optionalAuth: async (request: any, _reply: any) => {
    request.staff = { staffId: testStaffId, role: 'STAFF' };
  },
  requireAdmin: async (_request: any, _reply: any) => {
    // No-op for tests
  },
  requireReauth: async (request: any, _reply: any) => {
    request.staff = { staffId: testStaffId, role: 'STAFF' };
  },
  requireReauthForAdmin: async (request: any, _reply: any) => {
    request.staff = { staffId: testStaffId, role: 'ADMIN' };
  },
}));

describe('Agreement and Upgrade Flows', () => {
  let fastify: FastifyInstance;
  let pool: pg.Pool;
  let dbAvailable = false;

  const testCustomerId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const testRoomId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const testAgreementId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const validPngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

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

    // Register routes (auth is mocked via vi.mock)
    await fastify.register(agreementRoutes);
    await fastify.register(upgradeRoutes);
    await fastify.register(sessionRoutes);
    await fastify.ready();
  });

  afterAll(async () => {
    if (dbAvailable && fastify) await fastify.close();
    if (pool) await pool.end();
  });

  beforeEach(async () => {
    if (!dbAvailable) return;

    await truncateAllTables(pool.query.bind(pool));

    await pool.query(
      `INSERT INTO staff (id, name, role, pin_hash, active)
       VALUES ($1, 'Test Staff', 'STAFF', 'test-hash', true)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, active = EXCLUDED.active`,
      [testStaffId]
    );

    // Insert test customer with ON CONFLICT handling
    await pool.query(
      `INSERT INTO customers (id, name, membership_number)
       VALUES ($1, 'Test Customer', 'TEST-001')
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, membership_number = EXCLUDED.membership_number`,
      [testCustomerId]
    );

    // Insert test room with ON CONFLICT handling (handle number conflicts)
    await pool.query(
      `INSERT INTO rooms (id, number, type, status, floor)
       VALUES ($1, '200', 'STANDARD', 'CLEAN', 1)
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

  describe('Agreement Endpoints', () => {
    it(
      'should return active agreement',
      runIfDbAvailable(async () => {
        const response = await fastify.inject({
          method: 'GET',
          url: '/v1/agreements/active',
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.version).toBe('placeholder-v1');
        expect(body.title).toBe('Club Agreement');
        expect(body.bodyText).toBe('');
        expect(body.active).toBe(true);
      })
    );
  });

  describe('Agreement Signing', () => {
    it(
      'should require agreement signature for initial check-in',
      runIfDbAvailable(async () => {
        // Create initial check-in session
        const sessionResponse = await fastify.inject({
          method: 'POST',
          url: '/v1/sessions',
          payload: {
            customerId: testCustomerId,
            roomId: testRoomId,
            expectedDuration: 360,
            checkinType: 'INITIAL',
          },
        });

        expect(sessionResponse.statusCode).toBe(201);
        const session = JSON.parse(sessionResponse.body);
        const checkinId = session.id;

        // Sign agreement
        const signResponse = await fastify.inject({
          method: 'POST',
          url: `/v1/checkins/${checkinId}/agreement-sign`,
          payload: {
            signaturePngBase64: validPngBase64,
            agreed: true,
          },
        });

        expect(signResponse.statusCode).toBe(200);
        const signBody = JSON.parse(signResponse.body);
        expect(signBody.agreementVersion).toBe('placeholder-v1');

        // Verify signature stored
        const sigResult = await pool.query(
          'SELECT * FROM agreement_signatures WHERE checkin_id = $1',
          [checkinId]
        );
        expect(sigResult.rows.length).toBe(1);
        expect(sigResult.rows[0].agreement_version).toBe('placeholder-v1');
        expect(sigResult.rows[0].agreement_text_snapshot).toBe('');

        // Verify session marked as signed
        const sessionResult = await pool.query(
          'SELECT agreement_signed FROM sessions WHERE id = $1',
          [checkinId]
        );
        expect(sessionResult.rows[0].agreement_signed).toBe(true);
      })
    );

    it(
      'should require agreement signature for renewal',
      runIfDbAvailable(async () => {
        const sessionResponse = await fastify.inject({
          method: 'POST',
          url: '/v1/sessions',
          payload: {
            customerId: testCustomerId,
            roomId: testRoomId,
            expectedDuration: 360,
            checkinType: 'RENEWAL',
          },
        });

        expect(sessionResponse.statusCode).toBe(201);
        const session = JSON.parse(sessionResponse.body);

        const signResponse = await fastify.inject({
          method: 'POST',
          url: `/v1/checkins/${session.id}/agreement-sign`,
          payload: {
            signaturePngBase64: validPngBase64,
            agreed: true,
          },
        });

        expect(signResponse.statusCode).toBe(200);
      })
    );

    it(
      'should reject agreement signing for upgrades',
      runIfDbAvailable(async () => {
        // Create upgrade session
        const sessionResponse = await fastify.inject({
          method: 'POST',
          url: '/v1/sessions',
          payload: {
            customerId: testCustomerId,
            roomId: testRoomId,
            expectedDuration: 360,
            checkinType: 'UPGRADE',
          },
        });

        expect(sessionResponse.statusCode).toBe(201);
        const session = JSON.parse(sessionResponse.body);

        const signResponse = await fastify.inject({
          method: 'POST',
          url: `/v1/checkins/${session.id}/agreement-sign`,
          payload: {
            signaturePngBase64: validPngBase64,
            agreed: true,
          },
        });

        expect(signResponse.statusCode).toBe(400);
        const body = JSON.parse(signResponse.body);
        expect(body.error).toContain('not required for upgrades');
      })
    );

    it(
      'should store agreement text snapshot even when empty',
      runIfDbAvailable(async () => {
        const sessionResponse = await fastify.inject({
          method: 'POST',
          url: '/v1/sessions',
          payload: {
            customerId: testCustomerId,
            roomId: testRoomId,
            expectedDuration: 360,
            checkinType: 'INITIAL',
          },
        });

        const session = JSON.parse(sessionResponse.body);

        await fastify.inject({
          method: 'POST',
          url: `/v1/checkins/${session.id}/agreement-sign`,
          payload: {
            signaturePngBase64: validPngBase64,
            agreed: true,
          },
        });

        const sigResult = await pool.query(
          'SELECT agreement_text_snapshot, agreement_version FROM agreement_signatures WHERE checkin_id = $1',
          [session.id]
        );
        expect(sigResult.rows[0].agreement_text_snapshot).toBe('');
        expect(sigResult.rows[0].agreement_version).toBe('placeholder-v1');
      })
    );
  });

  describe('Upgrade Disclaimer', () => {
    it(
      'should log upgrade disclaimer when joining waitlist',
      runIfDbAvailable(async () => {
        const sessionResponse = await fastify.inject({
          method: 'POST',
          url: '/v1/sessions',
          payload: {
            customerId: testCustomerId,
            roomId: testRoomId,
            expectedDuration: 360,
            checkinType: 'INITIAL',
          },
        });

        const session = JSON.parse(sessionResponse.body);

        const waitlistResponse = await fastify.inject({
          method: 'POST',
          url: '/v1/upgrades/waitlist',
          payload: {
            sessionId: session.id,
            desiredRoomType: 'DOUBLE',
            acknowledgedDisclaimer: true,
          },
        });

        expect(waitlistResponse.statusCode).toBe(200);

        // Verify audit log entry
        const auditResult = await pool.query(
          `SELECT action, new_value FROM audit_log 
         WHERE entity_id = $1 AND action = 'UPGRADE_DISCLAIMER'`,
          [session.id]
        );
        expect(auditResult.rows.length).toBe(1);
        const rawNewValue = auditResult.rows[0].new_value as unknown;
        const newValue =
          typeof rawNewValue === 'string'
            ? (JSON.parse(rawNewValue) as Record<string, unknown>)
            : (rawNewValue as Record<string, unknown>);
        expect(newValue.action).toBe('JOIN_WAITLIST');
        expect(newValue.desiredRoomType).toBe('DOUBLE');
      })
    );

    it(
      'should log upgrade disclaimer when accepting upgrade',
      runIfDbAvailable(async () => {
        // Create second room for upgrade (clean up first, then insert)
        const upgradeRoomId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
        await pool.query('DELETE FROM rooms WHERE id = $1 OR number = $2', [
          upgradeRoomId,
          'TEST-201',
        ]);
        await pool.query(
          `INSERT INTO rooms (id, number, type, status, floor)
         VALUES ($1, 'TEST-201', 'DOUBLE', 'CLEAN', 2)
         ON CONFLICT (number) DO UPDATE SET id = EXCLUDED.id, type = EXCLUDED.type, status = EXCLUDED.status, floor = EXCLUDED.floor`,
          [upgradeRoomId]
        );

        const sessionResponse = await fastify.inject({
          method: 'POST',
          url: '/v1/sessions',
          payload: {
            customerId: testCustomerId,
            roomId: testRoomId,
            expectedDuration: 360,
            checkinType: 'INITIAL',
          },
        });

        const session = JSON.parse(sessionResponse.body);
        const originalCheckoutAt = new Date(Date.now() + 360 * 60 * 1000);

        const upgradeResponse = await fastify.inject({
          method: 'POST',
          url: '/v1/upgrades/accept',
          payload: {
            sessionId: session.id,
            newRoomId: upgradeRoomId,
            acknowledgedDisclaimer: true,
          },
        });

        expect(upgradeResponse.statusCode).toBe(200);
        const upgradeBody = JSON.parse(upgradeResponse.body);
        expect(upgradeBody.newRoomId).toBe(upgradeRoomId);

        // Verify audit log entry
        const auditResult = await pool.query(
          `SELECT action, new_value FROM audit_log 
         WHERE entity_id = $1 AND action = 'UPGRADE_DISCLAIMER'
         ORDER BY created_at DESC LIMIT 1`,
          [session.id]
        );
        expect(auditResult.rows.length).toBe(1);
        const rawNewValue = auditResult.rows[0].new_value as unknown;
        const newValue =
          typeof rawNewValue === 'string'
            ? (JSON.parse(rawNewValue) as Record<string, unknown>)
            : (rawNewValue as Record<string, unknown>);
        expect(newValue.action).toBe('ACCEPT_UPGRADE');

        // Verify checkout_at did not change
        const sessionResult = await pool.query(
          'SELECT checkout_at, checkin_type FROM sessions WHERE id = $1',
          [session.id]
        );
        const checkoutAt = new Date(sessionResult.rows[0].checkout_at);
        expect(checkoutAt.getTime()).toBeCloseTo(originalCheckoutAt.getTime(), -3);
        expect(sessionResult.rows[0].checkin_type).toBe('UPGRADE');
      })
    );

    it(
      'should not log disclaimer for normal check-in without upgrade intent',
      runIfDbAvailable(async () => {
        const sessionResponse = await fastify.inject({
          method: 'POST',
          url: '/v1/sessions',
          payload: {
            customerId: testCustomerId,
            roomId: testRoomId,
            expectedDuration: 360,
            checkinType: 'INITIAL',
          },
        });

        const session = JSON.parse(sessionResponse.body);

        // Check audit log - should only have CHECK_IN, not UPGRADE_DISCLAIMER
        const auditResult = await pool.query(
          `SELECT action FROM audit_log 
         WHERE entity_id = $1 AND action = 'UPGRADE_DISCLAIMER'`,
          [session.id]
        );
        expect(auditResult.rows.length).toBe(0);
      })
    );
  });

  describe('Checkout Time on Upgrade', () => {
    it(
      'should not change checkout_at on upgrade',
      runIfDbAvailable(async () => {
        const upgradeRoomId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
        await pool.query('DELETE FROM rooms WHERE id = $1 OR number = $2', [
          upgradeRoomId,
          'TEST-301',
        ]);
        await pool.query(
          `INSERT INTO rooms (id, number, type, status, floor)
         VALUES ($1, 'TEST-301', 'SPECIAL', 'CLEAN', 3)
         ON CONFLICT (number) DO UPDATE SET id = EXCLUDED.id, type = EXCLUDED.type, status = EXCLUDED.status, floor = EXCLUDED.floor`,
          [upgradeRoomId]
        );

        const sessionResponse = await fastify.inject({
          method: 'POST',
          url: '/v1/sessions',
          payload: {
            customerId: testCustomerId,
            roomId: testRoomId,
            expectedDuration: 360,
            checkinType: 'INITIAL',
          },
        });

        const session = JSON.parse(sessionResponse.body);

        // Get original checkout_at
        const originalResult = await pool.query('SELECT checkout_at FROM sessions WHERE id = $1', [
          session.id,
        ]);
        const originalCheckoutAt = new Date(originalResult.rows[0].checkout_at);

        // Perform upgrade
        await fastify.inject({
          method: 'POST',
          url: '/v1/upgrades/accept',
          payload: {
            sessionId: session.id,
            newRoomId: upgradeRoomId,
            acknowledgedDisclaimer: true,
          },
        });

        // Verify checkout_at unchanged
        const afterResult = await pool.query('SELECT checkout_at FROM sessions WHERE id = $1', [
          session.id,
        ]);
        const afterCheckoutAt = new Date(afterResult.rows[0].checkout_at);

        expect(afterCheckoutAt.getTime()).toBe(originalCheckoutAt.getTime());
      })
    );
  });
});
