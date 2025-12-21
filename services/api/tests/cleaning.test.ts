import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import pg from 'pg';
import { cleaningRoutes } from '../src/routes/cleaning.js';
import { createBroadcaster, type Broadcaster } from '../src/websocket/broadcaster.js';
import { RoomStatus, validateTransition } from '@club-ops/shared';

// Mock auth middleware to allow test requests
// Use a mutable object so the mock can access the updated value
const mockStaffConfig = { staffId: '00000000-0000-0000-0000-000000000000' };
vi.mock('../src/auth/middleware.js', () => ({
  requireAuth: async (request: any, _reply: any) => {
    request.staff = { staffId: mockStaffConfig.staffId, role: 'STAFF' };
  },
  requireAdmin: async (_request: any, _reply: any) => {
    // No-op for tests
  },
  requireReauth: async (request: any, _reply: any) => {
    request.staff = { staffId: mockStaffConfig.staffId, role: 'STAFF' };
  },
  requireReauthForAdmin: async (request: any, _reply: any) => {
    request.staff = { staffId: mockStaffConfig.staffId, role: 'ADMIN' };
  },
}));

// Augment FastifyInstance with broadcaster
declare module 'fastify' {
  interface FastifyInstance {
    broadcaster: Broadcaster;
  }
}

/**
 * Unit tests for transition validation from shared package.
 * These tests don't require a database connection.
 */
describe('Transition Validation (shared package)', () => {
  describe('Adjacent transitions (valid without override)', () => {
    it('should allow DIRTY → CLEANING', () => {
      const result = validateTransition(RoomStatus.DIRTY, RoomStatus.CLEANING);
      expect(result.ok).toBe(true);
      expect(result.needsOverride).toBeUndefined();
    });

    it('should allow CLEANING → CLEAN', () => {
      const result = validateTransition(RoomStatus.CLEANING, RoomStatus.CLEAN);
      expect(result.ok).toBe(true);
    });

    it('should allow CLEANING → DIRTY (rollback)', () => {
      const result = validateTransition(RoomStatus.CLEANING, RoomStatus.DIRTY);
      expect(result.ok).toBe(true);
    });

    it('should allow CLEAN → CLEANING', () => {
      const result = validateTransition(RoomStatus.CLEAN, RoomStatus.CLEANING);
      expect(result.ok).toBe(true);
    });

    it('should allow CLEAN → DIRTY', () => {
      const result = validateTransition(RoomStatus.CLEAN, RoomStatus.DIRTY);
      expect(result.ok).toBe(true);
    });

    it('should allow same status (no change)', () => {
      expect(validateTransition(RoomStatus.DIRTY, RoomStatus.DIRTY).ok).toBe(true);
      expect(validateTransition(RoomStatus.CLEANING, RoomStatus.CLEANING).ok).toBe(true);
      expect(validateTransition(RoomStatus.CLEAN, RoomStatus.CLEAN).ok).toBe(true);
    });
  });

  describe('Non-adjacent transitions (require override)', () => {
    it('should reject DIRTY → CLEAN without override', () => {
      const result = validateTransition(RoomStatus.DIRTY, RoomStatus.CLEAN);
      expect(result.ok).toBe(false);
      expect(result.needsOverride).toBe(true);
    });

    it('should allow DIRTY → CLEAN with override', () => {
      const result = validateTransition(RoomStatus.DIRTY, RoomStatus.CLEAN, true);
      expect(result.ok).toBe(true);
    });
  });
});

/**
 * Integration tests for /v1/cleaning/batch endpoint.
 * These tests require a PostgreSQL database connection.
 * 
 * To run these tests:
 * 1. Start the database: cd services/api && docker compose up -d
 * 2. Run migrations: pnpm db:migrate
 * 3. Run tests: pnpm test
 */
describe('Cleaning Batch Endpoint', () => {
  let fastify: FastifyInstance;
  let pool: pg.Pool;
  let broadcastedEvents: Array<{ type: string; payload: unknown }>;
  let dbAvailable = false;

  // Test data IDs
  let testStaffId: string;
  const testRoomIds = {
    dirty: '11111111-1111-1111-1111-111111111111',
    cleaning: '22222222-2222-2222-2222-222222222222',
    clean: '33333333-3333-3333-3333-333333333333',
  };

  beforeAll(async () => {
    // Connect to test database
    const dbConfig = {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5433', 10),
      database: process.env.DB_NAME || 'club_operations',
      user: process.env.DB_USER || 'clubops',
      password: process.env.DB_PASSWORD || 'clubops_dev',
      connectionTimeoutMillis: 3000,
    };

    pool = new pg.Pool(dbConfig);

    // Verify connection
    try {
      await pool.query('SELECT 1');
      dbAvailable = true;
    } catch {
      console.warn('\n⚠️  Database not available. Integration tests will be skipped.');
      console.warn('   To run integration tests:');
      console.warn('   1. Start Docker Desktop');
      console.warn('   2. cd services/api && docker compose up -d');
      console.warn('   3. pnpm db:migrate\n');
      return;
    }

    // Create test staff for cleaning operations
    // First try to get existing staff
    const existingStaff = await pool.query<{ id: string }>(
      `SELECT id FROM staff WHERE name = 'Test Cleaning Staff' LIMIT 1`
    );
    if (existingStaff.rows.length > 0) {
      testStaffId = existingStaff.rows[0]!.id;
    } else {
      // Create new staff
      const staffResult = await pool.query<{ id: string }>(
        `INSERT INTO staff (name, role, active)
         VALUES ('Test Cleaning Staff', 'STAFF', true)
         RETURNING id`
      );
      testStaffId = staffResult.rows[0]!.id;
    }
    // Update the mock to use the real staff ID
    mockStaffConfig.staffId = testStaffId;

    // Create Fastify instance
    fastify = Fastify();

    // Create broadcaster that captures events
    broadcastedEvents = [];
    const mockBroadcaster = {
      ...createBroadcaster(),
      broadcast: <T>(event: { type: string; payload: T }) => {
        broadcastedEvents.push({ type: event.type, payload: event.payload });
      },
    } as Broadcaster;

    fastify.decorate('broadcaster', mockBroadcaster);
    // Register routes (auth is mocked via vi.mock)
    await fastify.register(cleaningRoutes);
    await fastify.ready();
  });

  afterAll(async () => {
    if (dbAvailable) {
      // Clean up test staff (must delete dependent records first)
      if (testStaffId) {
        // Delete cleaning_events that reference this staff
        await pool.query('DELETE FROM cleaning_events WHERE staff_id = $1', [testStaffId]);
        // Delete cleaning_batches that reference this staff
        await pool.query('DELETE FROM cleaning_batches WHERE staff_id = $1', [testStaffId]);
        // Delete audit_log entries that reference this staff
        await pool.query('DELETE FROM audit_log WHERE staff_id = $1', [testStaffId]);
        // Now safe to delete staff
        await pool.query('DELETE FROM staff WHERE id = $1', [testStaffId]);
      }
      if (fastify) await fastify.close();
    }
    if (pool) await pool.end();
  });

  beforeEach(async () => {
    if (!dbAvailable) return;

    // Clear test data and reset
    broadcastedEvents = [];

    // Clean up test rooms (delete by both id and number to handle unique constraints)
    await pool.query('DELETE FROM cleaning_batch_rooms WHERE room_id = ANY($1)', [
      Object.values(testRoomIds),
    ]);
    // Clean up cleaning batches and audit logs for test staff (if testStaffId is set)
    if (testStaffId) {
      await pool.query('DELETE FROM cleaning_batches WHERE staff_id = $1', [testStaffId]);
      await pool.query('DELETE FROM audit_log WHERE staff_id = $1', [testStaffId]);
    }
    await pool.query('DELETE FROM rooms WHERE id = ANY($1) OR number IN ($2, $3, $4)', [
      Object.values(testRoomIds),
      'TEST-101',
      'TEST-102',
      'TEST-103',
    ]);

    // Insert test rooms with known statuses (with ON CONFLICT handling on number)
    await pool.query(`
      INSERT INTO rooms (id, number, type, status, floor)
      VALUES 
        ($1, 'TEST-101', 'STANDARD', 'DIRTY', 1),
        ($2, 'TEST-102', 'STANDARD', 'CLEANING', 1),
        ($3, 'TEST-103', 'STANDARD', 'CLEAN', 1)
      ON CONFLICT (number) DO UPDATE SET id = EXCLUDED.id, type = EXCLUDED.type, status = EXCLUDED.status, floor = EXCLUDED.floor
    `, [testRoomIds.dirty, testRoomIds.cleaning, testRoomIds.clean]);
  });

  // Helper to skip tests when DB is unavailable
  const runIfDbAvailable = (testFn: () => Promise<void>) => async () => {
    if (!dbAvailable) {
      console.log('    ↳ Skipped (database not available)');
      return;
    }
    await testFn();
  };

  // Helper to build cleaning batch payload
  const buildCleaningPayload = (roomId: string, fromStatus: string, toStatus: string, override = false, overrideReason?: string) => {
    return {
      deviceId: 'test-device',
      scanned: [{
        token: `token-${roomId}`,
        roomId,
        fromStatus,
        toStatus,
        override,
        overrideReason,
      }],
    };
  };

  // Helper to build batch payload for multiple rooms
  const buildBatchPayload = (rooms: Array<{ roomId: string; fromStatus: string; toStatus: string; override?: boolean; overrideReason?: string }>) => {
    return {
      deviceId: 'test-device',
      scanned: rooms.map((r, i) => ({
        token: `token-${r.roomId}-${i}`,
        roomId: r.roomId,
        fromStatus: r.fromStatus,
        toStatus: r.toStatus,
        override: r.override || false,
        overrideReason: r.overrideReason,
      })),
    };
  };

  describe('Valid transitions', () => {
    it('should transition DIRTY → CLEANING', runIfDbAvailable(async () => {
      // Get current room status from DB
      const roomResult = await pool.query('SELECT status FROM rooms WHERE id = $1', [testRoomIds.dirty]);
      const currentStatus = roomResult.rows[0]?.status || 'DIRTY';
      
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/cleaning/batch',
        payload: buildCleaningPayload(testRoomIds.dirty, currentStatus, 'CLEANING'),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.summary.success).toBe(1);
      expect(body.summary.failed).toBe(0);
      expect(body.rooms[0].success).toBe(true);
      expect(body.rooms[0].previousStatus).toBe('DIRTY');
      expect(body.rooms[0].newStatus).toBe('CLEANING');

      // Verify database state
      const result = await pool.query('SELECT status FROM rooms WHERE id = $1', [testRoomIds.dirty]);
      expect(result.rows[0].status).toBe('CLEANING');
    }));

    it('should transition CLEANING → CLEAN', runIfDbAvailable(async () => {
      // Get current room status from DB
      const roomResult = await pool.query('SELECT status FROM rooms WHERE id = $1', [testRoomIds.cleaning]);
      const currentStatus = roomResult.rows[0]?.status || 'CLEANING';
      
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/cleaning/batch',
        payload: buildCleaningPayload(testRoomIds.cleaning, currentStatus, 'CLEAN'),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.summary.success).toBe(1);
      expect(body.rooms[0].previousStatus).toBe('CLEANING');
      expect(body.rooms[0].newStatus).toBe('CLEAN');
    }));

    it('should handle batch operations with multiple rooms', runIfDbAvailable(async () => {
      // First update dirty room to cleaning
      await pool.query('UPDATE rooms SET status = $1 WHERE id = $2', ['CLEANING', testRoomIds.dirty]);

      // Get current statuses
      const dirtyResult = await pool.query('SELECT status FROM rooms WHERE id = $1', [testRoomIds.dirty]);
      const cleaningResult = await pool.query('SELECT status FROM rooms WHERE id = $1', [testRoomIds.cleaning]);
      
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/cleaning/batch',
        payload: buildBatchPayload([
          { roomId: testRoomIds.dirty, fromStatus: dirtyResult.rows[0]?.status || 'CLEANING', toStatus: 'CLEAN' },
          { roomId: testRoomIds.cleaning, fromStatus: cleaningResult.rows[0]?.status || 'CLEANING', toStatus: 'CLEAN' },
        ]),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.summary.success).toBe(2);
      expect(body.summary.total).toBe(2);
    }));
  });

  describe('Invalid transitions (without override)', () => {
    it('should reject DIRTY → CLEAN without override', runIfDbAvailable(async () => {
      // Get current room status from DB
      const roomResult = await pool.query('SELECT status FROM rooms WHERE id = $1', [testRoomIds.dirty]);
      const currentStatus = roomResult.rows[0]?.status || 'DIRTY';
      
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/cleaning/batch',
        payload: buildCleaningPayload(testRoomIds.dirty, currentStatus, 'CLEAN', false),
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.summary.success).toBe(0);
      expect(body.summary.failed).toBe(1);
      expect(body.rooms[0].success).toBe(false);
      expect(body.rooms[0].requiresOverride).toBe(true);

      // Verify room status unchanged
      const result = await pool.query('SELECT status FROM rooms WHERE id = $1', [testRoomIds.dirty]);
      expect(result.rows[0].status).toBe('DIRTY');
    }));
  });

  describe('Override transitions', () => {
    it('should allow DIRTY → CLEAN with override and reason', runIfDbAvailable(async () => {
      // Get current room status from DB
      const roomResult = await pool.query('SELECT status FROM rooms WHERE id = $1', [testRoomIds.dirty]);
      const currentStatus = roomResult.rows[0]?.status || 'DIRTY';
      
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/cleaning/batch',
        payload: buildCleaningPayload(testRoomIds.dirty, currentStatus, 'CLEAN', true, 'Manager inspection confirmed room is clean'),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.summary.success).toBe(1);
      expect(body.rooms[0].success).toBe(true);

      // Verify database state and override flag
      const result = await pool.query('SELECT status, override_flag FROM rooms WHERE id = $1', [
        testRoomIds.dirty,
      ]);
      expect(result.rows[0].status).toBe('CLEAN');
      expect(result.rows[0].override_flag).toBe(true);

      // Verify audit log entry
      const auditResult = await pool.query(
        `SELECT action, metadata FROM audit_log 
         WHERE entity_id = $1 AND action = 'ROOM_STATUS_CHANGE'`,
        [testRoomIds.dirty]
      );
      expect(auditResult.rows.length).toBe(1);
      const metadata = auditResult.rows[0].metadata as { override?: boolean; overrideReason?: string };
      expect(metadata.override).toBe(true);
      expect(metadata.overrideReason).toBe('Manager inspection confirmed room is clean');
    }));

    it('should reject override without reason', runIfDbAvailable(async () => {
      // Get current room status from DB
      const roomResult = await pool.query('SELECT status FROM rooms WHERE id = $1', [testRoomIds.dirty]);
      const currentStatus = roomResult.rows[0]?.status || 'DIRTY';
      
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/cleaning/batch',
        payload: buildCleaningPayload(testRoomIds.dirty, currentStatus, 'CLEAN', true),
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Override requires a reason');
    }));
  });

  describe('Mixed status batch operations', () => {
    it('should handle partial failures in batch', runIfDbAvailable(async () => {
      // Get current statuses
      const dirtyResult = await pool.query('SELECT status FROM rooms WHERE id = $1', [testRoomIds.dirty]);
      const cleaningResult = await pool.query('SELECT status FROM rooms WHERE id = $1', [testRoomIds.cleaning]);
      const cleanResult = await pool.query('SELECT status FROM rooms WHERE id = $1', [testRoomIds.clean]);
      
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/cleaning/batch',
        payload: buildBatchPayload([
          { roomId: testRoomIds.dirty, fromStatus: dirtyResult.rows[0]?.status || 'DIRTY', toStatus: 'CLEAN' },
          { roomId: testRoomIds.cleaning, fromStatus: cleaningResult.rows[0]?.status || 'CLEANING', toStatus: 'CLEAN' },
          { roomId: testRoomIds.clean, fromStatus: cleanResult.rows[0]?.status || 'CLEAN', toStatus: 'CLEAN' },
        ]),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.summary.success).toBe(2);
      expect(body.summary.failed).toBe(1);

      const dirtyRoom = body.rooms.find((r: { roomId: string }) => r.roomId === testRoomIds.dirty);
      const cleaningRoom = body.rooms.find((r: { roomId: string }) => r.roomId === testRoomIds.cleaning);
      const cleanRoom = body.rooms.find((r: { roomId: string }) => r.roomId === testRoomIds.clean);

      expect(dirtyRoom.success).toBe(false);
      expect(dirtyRoom.requiresOverride).toBe(true);
      expect(cleaningRoom.success).toBe(true);
      expect(cleanRoom.success).toBe(true);
    }));
  });

  describe('Validation errors', () => {
    it('should reject empty roomIds array', runIfDbAvailable(async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/cleaning/batch',
        payload: {
          deviceId: 'test-device',
          scanned: [],
        },
      });

      expect(response.statusCode).toBe(400);
    }));

    it('should reject invalid room UUIDs', runIfDbAvailable(async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/cleaning/batch',
        payload: {
          deviceId: 'test-device',
          scanned: [{
            token: 'token-invalid',
            roomId: 'not-a-uuid',
            fromStatus: 'DIRTY',
            toStatus: 'CLEAN',
          }],
        },
      });

      expect(response.statusCode).toBe(400);
    }));

    it('should reject invalid target status', runIfDbAvailable(async () => {
      // Get current room status from DB
      const roomResult = await pool.query('SELECT status FROM rooms WHERE id = $1', [testRoomIds.dirty]);
      const currentStatus = roomResult.rows[0]?.status || 'DIRTY';
      
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/cleaning/batch',
        payload: {
          deviceId: 'test-device',
          scanned: [{
            token: `token-${testRoomIds.dirty}`,
            roomId: testRoomIds.dirty,
            fromStatus: currentStatus,
            toStatus: 'INVALID_STATUS' as any,
          }],
        },
      });

      expect(response.statusCode).toBe(400);
    }));

    it('should handle non-existent rooms', runIfDbAvailable(async () => {
      const nonExistentId = '99999999-9999-9999-9999-999999999999';
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/cleaning/batch',
        payload: {
          deviceId: 'test-device',
          scanned: [{
            token: 'token-nonexistent',
            roomId: nonExistentId,
            fromStatus: 'DIRTY',
            toStatus: 'CLEANING',
          }],
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.rooms[0].success).toBe(false);
      expect(body.rooms[0].error).toBe('Room not found');
    }));
  });

  describe('Cleaning batch records', () => {
    it('should create cleaning batch record', runIfDbAvailable(async () => {
      // Get current room status from DB
      const roomResult = await pool.query('SELECT status FROM rooms WHERE id = $1', [testRoomIds.cleaning]);
      const currentStatus = roomResult.rows[0]?.status || 'CLEANING';
      
      await fastify.inject({
        method: 'POST',
        url: '/v1/cleaning/batch',
        payload: buildCleaningPayload(testRoomIds.cleaning, currentStatus, 'CLEAN'),
      });

      const result = await pool.query(
        'SELECT * FROM cleaning_batches WHERE staff_id = $1',
        [testStaffId]
      );
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].room_count).toBe(1);
    }));

    it('should create cleaning_batch_rooms records', runIfDbAvailable(async () => {
      // Get current room status from DB
      const roomResult = await pool.query('SELECT status FROM rooms WHERE id = $1', [testRoomIds.cleaning]);
      const currentStatus = roomResult.rows[0]?.status || 'CLEANING';
      
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/cleaning/batch',
        payload: buildCleaningPayload(testRoomIds.cleaning, currentStatus, 'CLEAN'),
      });

      const body = JSON.parse(response.body);
      const batchId = body.batchId;

      const result = await pool.query(
        'SELECT * FROM cleaning_batch_rooms WHERE batch_id = $1',
        [batchId]
      );
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].status_from).toBe('CLEANING');
      expect(result.rows[0].status_to).toBe('CLEAN');
    }));
  });
});
