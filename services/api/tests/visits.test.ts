import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import pg from 'pg';
import { visitRoutes } from '../src/routes/visits.js';
import { createBroadcaster } from '../src/websocket/broadcaster.js';
import { truncateAllTables } from './testDb.js';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const FIFTEEN_MIN_MS = 15 * 60 * 1000;

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

describe('Visit and Renewal Flows', () => {
  let fastify: FastifyInstance;
  let pool: pg.Pool;
  let dbAvailable = false;

  const testCustomerId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const testRoomId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

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
    await fastify.ready();
  });

  afterAll(async () => {
    if (dbAvailable && fastify) await fastify.close();
    if (pool) await pool.end();
  });

  beforeEach(async () => {
    if (!dbAvailable) return;

    await truncateAllTables(pool.query.bind(pool));

    // Seed a staff row for auth + FK constraints
    await pool.query(
      `INSERT INTO staff (id, name, role, pin_hash, active)
       VALUES ($1, 'Test Staff', 'STAFF', 'test-hash', true)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, active = EXCLUDED.active`,
      [testStaffId]
    );

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
       VALUES ($1, '200', 'STANDARD', 'CLEAN', 1)
       ON CONFLICT (number) DO UPDATE SET id = EXCLUDED.id, type = EXCLUDED.type, status = EXCLUDED.status, floor = EXCLUDED.floor`,
      [testRoomId]
    );

  });

  const runIfDbAvailable = (testFn: () => Promise<void>) => async () => {
    if (!dbAvailable) {
      console.log('    ↳ Skipped (database not available)');
      return;
    }
    await testFn();
  };

  it(
    'should create an initial visit with initial block',
    runIfDbAvailable(async () => {
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

      // Verify block duration is 6 hours
      const startsAt = new Date(data.block.startsAt);
      const endsAt = new Date(data.block.endsAt);
      const durationMs = endsAt.getTime() - startsAt.getTime();
      // Checkout time is 6 hours after check-in, rounded UP to the next 15-minute boundary.
      expect(durationMs).toBeGreaterThanOrEqual(SIX_HOURS_MS);
      expect(durationMs).toBeLessThanOrEqual(SIX_HOURS_MS + FIFTEEN_MIN_MS);
    })
  );

  it(
    'should create renewal block that extends from previous checkout time, not from now',
    runIfDbAvailable(async () => {
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
      await new Promise((resolve) => setTimeout(resolve, 100));

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
      const renewalDurationMs = renewalEndsAt.getTime() - renewalStartsAt.getTime();
      expect(renewalDurationMs).toBeGreaterThanOrEqual(SIX_HOURS_MS);
      expect(renewalDurationMs).toBeLessThanOrEqual(SIX_HOURS_MS + FIFTEEN_MIN_MS);

      // Renewal should NOT start from "now" - verify it's close to initial checkout time
      const now = new Date();
      expect(Math.abs(renewalStartsAt.getTime() - initialBlockEndsAt.getTime())).toBeLessThan(1000);
    })
  );

  it(
    'should enforce 14-hour maximum visit duration',
    runIfDbAvailable(async () => {
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
    })
  );


  it(
    'should search active visits by membership number',
    runIfDbAvailable(async () => {
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
      // Current block may include up to 15 minutes of rounding; renewal adds 6 hours.
      expect(data.visits[0]?.totalHoursIfRenewed).toBeGreaterThanOrEqual(12);
      expect(data.visits[0]?.totalHoursIfRenewed).toBeLessThanOrEqual(12 + 15 / 60);
      // canFinalExtend is true only if renewal + final2h would be <= 14 hours.
      // With rounding, totalHoursIfRenewed can exceed 12 slightly, making final2h ineligible.
      expect(data.visits[0]?.canFinalExtend).toBe(data.visits[0]?.totalHoursIfRenewed <= 12);
    })
  );
});
