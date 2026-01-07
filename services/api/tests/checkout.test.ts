import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import pg from 'pg';
import { checkoutRoutes } from '../src/routes/checkout.js';
import { visitRoutes } from '../src/routes/visits.js';
import { createBroadcaster, type Broadcaster } from '../src/websocket/broadcaster.js';
import { RoomStatus } from '@club-ops/shared';
import { truncateAllTables } from './testDb.js';

// Mock auth middleware to allow test requests
// For checkout tests, we'll validate real tokens when provided
vi.mock('../src/auth/middleware.js', async () => {
  const { query } = await import('../src/db/index.js');
  async function ensureDefaultStaff(): Promise<{
    staffId: string;
    name: string;
    role: 'STAFF' | 'ADMIN';
  }> {
    const existing = await query<{ id: string; name: string; role: 'STAFF' | 'ADMIN' }>(
      `SELECT id, name, role FROM staff WHERE active = true ORDER BY created_at ASC LIMIT 1`
    );
    if (existing.rows.length > 0) {
      return {
        staffId: existing.rows[0]!.id,
        name: existing.rows[0]!.name,
        role: existing.rows[0]!.role,
      };
    }
    const created = await query<{ id: string; name: string; role: 'STAFF' | 'ADMIN' }>(
      `INSERT INTO staff (name, role, pin_hash, active)
       VALUES ('Test Staff', 'STAFF', 'test-hash', true)
       RETURNING id, name, role`
    );
    const row = created.rows[0]!;
    return { staffId: row.id, name: row.name, role: row.role };
  }
  return {
    requireAuth: async (request: any, reply: any) => {
      const authHeader = request.headers.authorization || request.headers.Authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        // For tests without auth header, use a real staff row (uuid) to satisfy FK constraints.
        const staff = await ensureDefaultStaff();
        request.staff = { staffId: staff.staffId, name: staff.name, role: staff.role };
        return;
      }

      const token = authHeader.substring(7);
      // Validate token against database
      try {
        const sessionResult = await query<{ staff_id: string; name: string; role: string }>(
          `SELECT s.staff_id, st.name, st.role
           FROM staff_sessions s
           JOIN staff st ON s.staff_id = st.id
           WHERE s.session_token = $1 AND s.revoked_at IS NULL AND st.active = true`,
          [token]
        );

        if (sessionResult.rows.length > 0) {
          const session = sessionResult.rows[0]!;
          request.staff = {
            staffId: session.staff_id,
            name: session.name,
            role: session.role as 'STAFF' | 'ADMIN',
          };
          return;
        }
      } catch (error) {
        // Fall through to default
      }

      // Default for tests
      const staff = await ensureDefaultStaff();
      request.staff = { staffId: staff.staffId, name: staff.name, role: staff.role };
    },
    requireAdmin: async (_request: any, _reply: any) => {
      // No-op for tests
    },
    requireReauth: async (request: any, _reply: any) => {
      const staff = await ensureDefaultStaff();
      request.staff = { staffId: staff.staffId, name: staff.name, role: staff.role };
    },
    requireReauthForAdmin: async (request: any, _reply: any) => {
      const staff = await ensureDefaultStaff();
      request.staff = { staffId: staff.staffId, name: staff.name, role: 'ADMIN' };
    },
  };
});

// Augment FastifyInstance with broadcaster
declare module 'fastify' {
  interface FastifyInstance {
    broadcaster: Broadcaster;
  }
}

describe('Checkout Flow', () => {
  let fastify: FastifyInstance;
  let pool: pg.Pool;
  let testCustomerId: string;
  let testRoomId: string;
  let testLockerId: string;
  let testKeyTagId: string;
  let testVisitId: string;
  let testBlockId: string;
  let testStaffId: string;
  let testStaffToken: string;

  beforeAll(async () => {
    // Initialize database connection
    const config = {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5433', 10),
      database: process.env.DB_NAME || 'club_operations',
      user: process.env.DB_USER || 'clubops',
      password: process.env.DB_PASSWORD || 'clubops_dev',
    };

    pool = new pg.Pool(config);

    await truncateAllTables(pool.query.bind(pool));

    // Create test data - create customer instead of member
    const customerResult = await pool.query(
      `INSERT INTO customers (name, membership_number)
       VALUES ('Test Customer', '12345')
       RETURNING id`
    );
    testCustomerId = customerResult.rows[0]!.id;

    const roomResult = await pool.query(
      `INSERT INTO rooms (number, type, status, floor)
       VALUES ('101', 'STANDARD', 'CLEAN', 1)
       RETURNING id`
    );
    testRoomId = roomResult.rows[0]!.id;

    const lockerResult = await pool.query(
      `INSERT INTO lockers (number, status)
       VALUES ('L01', 'CLEAN')
       RETURNING id`
    );
    testLockerId = lockerResult.rows[0]!.id;

    const keyTagResult = await pool.query(
      `INSERT INTO key_tags (room_id, tag_code, tag_type, is_active)
       VALUES ($1, 'TEST-KEY-001', 'QR', true)
       RETURNING id`,
      [testRoomId]
    );
    testKeyTagId = keyTagResult.rows[0]!.id;

    const staffResult = await pool.query(
      `INSERT INTO staff (name, role, active)
       VALUES ('Test Staff', 'STAFF', true)
       RETURNING id`
    );
    testStaffId = staffResult.rows[0]!.id;

    const sessionToken = `test-token-${Date.now()}`;
    await pool.query(
      `INSERT INTO staff_sessions (staff_id, device_id, device_type, session_token, expires_at)
       VALUES ($1, 'test-device', 'tablet', $2, NOW() + INTERVAL '1 hour')`,
      [testStaffId, sessionToken]
    );
    testStaffToken = sessionToken;

    // Create a visit and block - ensure visit is active (ended_at IS NULL)
    const visitResult = await pool.query(
      `INSERT INTO visits (customer_id, started_at, ended_at)
       VALUES ($1, NOW() - INTERVAL '7 hours', NULL)
       RETURNING id`,
      [testCustomerId]
    );
    testVisitId = visitResult.rows[0]!.id;

    const blockResult = await pool.query(
      `INSERT INTO checkin_blocks (visit_id, block_type, starts_at, ends_at, rental_type, room_id, has_tv_remote)
       VALUES ($1, 'INITIAL', NOW() - INTERVAL '7 hours', NOW() - INTERVAL '1 hour', 'STANDARD', $2, true)
       RETURNING id`,
      [testVisitId, testRoomId]
    );
    testBlockId = blockResult.rows[0]!.id;

    await pool.query(`UPDATE rooms SET assigned_to_customer_id = $1 WHERE id = $2`, [
      testCustomerId,
      testRoomId,
    ]);
  });

  afterAll(async () => {
    // Clean up test data
    await pool.query('DELETE FROM checkout_requests WHERE customer_id = $1', [testCustomerId]);
    await pool.query('DELETE FROM late_checkout_events WHERE customer_id = $1', [testCustomerId]);
    await pool.query('DELETE FROM checkin_blocks WHERE visit_id = $1', [testVisitId]);
    await pool.query('DELETE FROM visits WHERE id = $1', [testVisitId]);
    await pool.query('DELETE FROM key_tags WHERE id = $1', [testKeyTagId]);
    await pool.query('DELETE FROM rooms WHERE id = $1', [testRoomId]);
    await pool.query('DELETE FROM lockers WHERE id = $1', [testLockerId]);
    await pool.query('DELETE FROM staff_sessions WHERE staff_id = $1', [testStaffId]);
    await pool.query('DELETE FROM staff WHERE id = $1', [testStaffId]);
    await pool.query('DELETE FROM customers WHERE id = $1', [testCustomerId]);
    await pool.end();
  });

  beforeEach(async () => {
    // Ensure visit is active for each test
    await pool.query('UPDATE visits SET ended_at = NULL WHERE id = $1', [testVisitId]);

    fastify = Fastify();
    const broadcaster = createBroadcaster();
    fastify.decorate('broadcaster', broadcaster);
    // Register routes (auth is mocked via vi.mock)
    await fastify.register(checkoutRoutes);
    await fastify.register(visitRoutes);
    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
  });

  describe('Late fee calculations', () => {
    it('should calculate $0 fee for < 30 minutes late', async () => {
      // Update existing block to end 15 minutes ago
      await pool.query(
        `UPDATE checkin_blocks 
         SET starts_at = NOW() - INTERVAL '6 hours 15 minutes', 
             ends_at = NOW() - INTERVAL '15 minutes'
         WHERE id = $1`,
        [testBlockId]
      );

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/checkout/resolve-key',
        headers: {
          Authorization: `Bearer ${testStaffToken}`,
        },
        payload: {
          token: 'TEST-KEY-001',
          kioskDeviceId: 'test-kiosk',
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data.lateMinutes).toBeGreaterThanOrEqual(0);
      expect(data.lateMinutes).toBeLessThan(30);
      expect(data.lateFeeAmount).toBe(0);
      expect(data.banApplied).toBe(false);
    });

    it('should calculate $15 fee for 30-59 minutes late', async () => {
      const blockResult = await pool.query(
        `UPDATE checkin_blocks SET ends_at = NOW() - INTERVAL '45 minutes' WHERE id = $1 RETURNING id`,
        [testBlockId]
      );

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/checkout/resolve-key',
        headers: {
          Authorization: `Bearer ${testStaffToken}`,
        },
        payload: {
          token: 'TEST-KEY-001',
          kioskDeviceId: 'test-kiosk',
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data.lateMinutes).toBeGreaterThanOrEqual(30);
      expect(data.lateMinutes).toBeLessThan(60);
      expect(data.lateFeeAmount).toBe(15);
      expect(data.banApplied).toBe(false);
    });

    it('should calculate $35 fee for 60-89 minutes late', async () => {
      await pool.query(
        `UPDATE checkin_blocks SET ends_at = NOW() - INTERVAL '75 minutes' WHERE id = $1`,
        [testBlockId]
      );

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/checkout/resolve-key',
        headers: {
          Authorization: `Bearer ${testStaffToken}`,
        },
        payload: {
          token: 'TEST-KEY-001',
          kioskDeviceId: 'test-kiosk',
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data.lateMinutes).toBeGreaterThanOrEqual(60);
      expect(data.lateMinutes).toBeLessThan(90);
      expect(data.lateFeeAmount).toBe(35);
      expect(data.banApplied).toBe(false);
    });

    it('should calculate $35 fee and apply ban for 90+ minutes late', async () => {
      await pool.query(
        `UPDATE checkin_blocks SET ends_at = NOW() - INTERVAL '95 minutes' WHERE id = $1`,
        [testBlockId]
      );

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/checkout/resolve-key',
        headers: {
          Authorization: `Bearer ${testStaffToken}`,
        },
        payload: {
          token: 'TEST-KEY-001',
          kioskDeviceId: 'test-kiosk',
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data.lateMinutes).toBeGreaterThanOrEqual(90);
      expect(data.lateFeeAmount).toBe(35);
      expect(data.banApplied).toBe(true);
    });
  });

  describe('Ban enforcement', () => {
    it('should prevent check-in for banned customer', async () => {
      // Ban the customer
      const banUntil = new Date();
      banUntil.setDate(banUntil.getDate() + 30);
      await pool.query(`UPDATE customers SET banned_until = $1 WHERE id = $2`, [
        banUntil,
        testCustomerId,
      ]);

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/visits',
        payload: {
          customerId: testCustomerId,
          rentalType: 'STANDARD',
          roomId: testRoomId,
        },
      });

      expect(response.statusCode).toBe(403);
      const data = JSON.parse(response.body);
      expect(data.error).toContain('banned');

      // Clean up
      await pool.query(`UPDATE customers SET banned_until = NULL WHERE id = $1`, [testCustomerId]);
    });
  });

  describe('Checkout request flow', () => {
    it('should create checkout request', async () => {
      await pool.query(
        `UPDATE checkin_blocks SET ends_at = NOW() - INTERVAL '45 minutes' WHERE id = $1`,
        [testBlockId]
      );

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/checkout/request',
        // Note: checkout/request is customer-facing and may not require auth
        payload: {
          occupancyId: testBlockId,
          kioskDeviceId: 'test-kiosk',
          checklist: {
            roomKey: true,
            bedSheets: true,
            tvRemote: true,
          },
        },
      });

      expect(response.statusCode).toBe(201);
      const data = JSON.parse(response.body);
      expect(data.requestId).toBeDefined();

      // Verify request was created
      const requestResult = await pool.query('SELECT * FROM checkout_requests WHERE id = $1', [
        data.requestId,
      ]);
      expect(requestResult.rows.length).toBe(1);
      expect(requestResult.rows[0]!.late_minutes).toBeGreaterThanOrEqual(30);
      // late_fee_amount is DECIMAL in DB, returned as string, so parse it
      expect(parseFloat(requestResult.rows[0]!.late_fee_amount as string)).toBe(15);

      // Clean up
      await pool.query('DELETE FROM checkout_requests WHERE id = $1', [data.requestId]);
    });

    it('should allow staff to claim checkout request', async () => {
      // Create a checkout request
      const requestResult = await pool.query(
        `INSERT INTO checkout_requests (occupancy_id, customer_id, kiosk_device_id, customer_checklist_json, late_minutes, late_fee_amount)
         VALUES ($1, $2, 'test-kiosk', '{}', 45, 15)
         RETURNING id`,
        [testBlockId, testCustomerId]
      );
      const requestId = requestResult.rows[0]!.id;

      const response = await fastify.inject({
        method: 'POST',
        url: `/v1/checkout/${requestId}/claim`,
        headers: {
          authorization: `Bearer ${testStaffToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data.requestId).toBe(requestId);
      expect(data.claimedBy).toBe(testStaffId);

      // Clean up
      await pool.query('DELETE FROM checkout_requests WHERE id = $1', [requestId]);
    });

    it('should complete checkout and update room status', async () => {
      // Create a checkout request
      const requestResult = await pool.query(
        `INSERT INTO checkout_requests (occupancy_id, customer_id, kiosk_device_id, customer_checklist_json, late_minutes, late_fee_amount, claimed_by_staff_id, status, items_confirmed, fee_paid)
         VALUES ($1, $2, 'test-kiosk', '{}', 0, 0, $3, 'CLAIMED', true, true)
         RETURNING id`,
        [testBlockId, testCustomerId, testStaffId]
      );
      const requestId = requestResult.rows[0]!.id;

      const response = await fastify.inject({
        method: 'POST',
        url: `/v1/checkout/${requestId}/complete`,
        headers: {
          authorization: `Bearer ${testStaffToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data.completed).toBe(true);

      // Verify room status was updated
      const roomResult = await pool.query('SELECT status FROM rooms WHERE id = $1', [testRoomId]);
      expect(roomResult.rows[0]!.status).toBe(RoomStatus.DIRTY);

      // Verify visit was ended
      const visitResult = await pool.query('SELECT ended_at FROM visits WHERE id = $1', [
        testVisitId,
      ]);
      expect(visitResult.rows[0]!.ended_at).not.toBeNull();

      // Clean up
      await pool.query('DELETE FROM checkout_requests WHERE id = $1', [requestId]);
      await pool.query(
        'UPDATE rooms SET status = $1, assigned_to_customer_id = NULL WHERE id = $2',
        [RoomStatus.CLEAN, testRoomId]
      );
      await pool.query('UPDATE visits SET ended_at = NULL WHERE id = $1', [testVisitId]);
    });
  });
});
