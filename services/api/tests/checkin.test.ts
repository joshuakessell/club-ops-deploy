import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { query, initializeDatabase, closeDatabase } from '../src/db/index.js';
import { createBroadcaster, type Broadcaster } from '../src/websocket/broadcaster.js';
import { checkinRoutes } from '../src/routes/checkin.js';
import { hashPin, generateSessionToken } from '../src/auth/utils.js';

// Augment FastifyInstance with broadcaster
declare module 'fastify' {
  interface FastifyInstance {
    broadcaster: Broadcaster;
  }
}

describe('Check-in Flow', () => {
  let app: FastifyInstance;
  let staffToken: string;
  let staffId: string;
  let laneId: string;
  let customerId: string;
  let dbAvailable = false;

  beforeAll(async () => {
    // Check if database is available
    try {
      await initializeDatabase();
      dbAvailable = true;
    } catch (error) {
      console.warn('\n⚠️  Database not available. Integration tests will be skipped.');
      console.warn('   To run integration tests:');
      console.warn('   1. Start Docker Desktop');
      console.warn('   2. cd services/api && docker compose up -d');
      console.warn('   3. pnpm db:migrate\n');
      return;
    }

    app = Fastify({
      logger: false,
    });

    await app.register(cors);
    await app.register(websocket);

    const broadcaster = createBroadcaster();
    app.decorate('broadcaster', broadcaster);

    // Register check-in routes
    // Note: Tests will need to properly authenticate or we'll mock requireAuth
    await app.register(checkinRoutes);

    await app.ready();
  });

  beforeEach(async () => {
    if (!dbAvailable) return;
    
    // Create test staff
    const pinHash = await hashPin('1234');
    const staffResult = await query<{ id: string }>(
      `INSERT INTO staff (name, role, pin_hash, active)
       VALUES ('Test Staff', 'STAFF', $1, true)
       RETURNING id`,
      [pinHash]
    );
    staffId = staffResult.rows[0]!.id;
    staffToken = generateSessionToken();

    // Create staff session in database
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 8); // 8 hour session
    await query(
      `INSERT INTO staff_sessions (staff_id, device_id, device_type, session_token, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [staffId, 'test-device', 'tablet', staffToken, expiresAt]
    );

    // Clean up any existing test data first - delete in order to respect foreign key constraints
    await query(`DELETE FROM checkout_requests WHERE customer_id IN (SELECT id FROM customers WHERE membership_number = '12345')`);
    await query(`DELETE FROM agreement_signatures WHERE checkin_id IN (SELECT id FROM sessions WHERE customer_id IN (SELECT id FROM customers WHERE membership_number = '12345'))`);
    await query(`DELETE FROM checkin_blocks WHERE visit_id IN (SELECT id FROM visits WHERE customer_id IN (SELECT id FROM customers WHERE membership_number = '12345'))`);
    await query(`DELETE FROM charges WHERE visit_id IN (SELECT id FROM visits WHERE customer_id IN (SELECT id FROM customers WHERE membership_number = '12345'))`);
    await query(`DELETE FROM sessions WHERE customer_id IN (SELECT id FROM customers WHERE membership_number = '12345') OR visit_id IN (SELECT id FROM visits WHERE customer_id IN (SELECT id FROM customers WHERE membership_number = '12345'))`);
    await query(`DELETE FROM visits WHERE customer_id IN (SELECT id FROM customers WHERE membership_number = '12345')`);
    await query(`DELETE FROM lane_sessions WHERE customer_id IN (SELECT id FROM customers WHERE membership_number = '12345')`);
    await query(`DELETE FROM customers WHERE membership_number = '12345'`);
    
    // Create test customer
    const customerResult = await query<{ id: string }>(
      `INSERT INTO customers (name, membership_number)
       VALUES ('Test Customer', '12345')
       RETURNING id`
    );
    customerId = customerResult.rows[0]!.id;

    laneId = 'LANE_1';
  });

  afterEach(async () => {
    if (!dbAvailable) return;
    
    // Clean up test data - delete in order to respect foreign key constraints
    await query(`DELETE FROM checkout_requests WHERE customer_id = $1`, [customerId]);
    await query(`DELETE FROM agreement_signatures WHERE checkin_id IN (SELECT id FROM sessions WHERE customer_id = $1)`, [customerId]);
    await query(`DELETE FROM checkin_blocks WHERE visit_id IN (SELECT id FROM visits WHERE customer_id = $1)`, [customerId]);
    await query(`DELETE FROM charges WHERE visit_id IN (SELECT id FROM visits WHERE customer_id = $1)`, [customerId]);
    await query(`DELETE FROM sessions WHERE customer_id = $1 OR visit_id IN (SELECT id FROM visits WHERE customer_id = $1)`, [customerId]);
    await query(`DELETE FROM visits WHERE customer_id = $1`, [customerId]);
    await query(`DELETE FROM lane_sessions WHERE lane_id = $1 OR lane_id = 'LANE_2'`, [laneId]);
    await query(`DELETE FROM payment_intents`);
    await query(`DELETE FROM staff_sessions WHERE staff_id = $1`, [staffId]);
    await query(`DELETE FROM customers WHERE id = $1 OR membership_number = '12345'`, [customerId]);
    await query(`DELETE FROM staff WHERE id = $1`, [staffId]);
    await query(`DELETE FROM rooms WHERE number IN ('101', '102', '103', '104')`);
  });

  afterAll(async () => {
    await app.close();
    await closeDatabase();
  });

  // Helper to skip tests when DB is unavailable
  const runIfDbAvailable = (testFn: () => Promise<void>) => async () => {
    if (!dbAvailable) {
      console.log('    ↳ Skipped (database not available)');
      return;
    }
    await testFn();
  };

  describe('POST /v1/checkin/lane/:laneId/start', () => {
    it('should create a new lane session with ID scan', runIfDbAvailable(async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/start`,
        headers: {
          'Authorization': `Bearer ${staffToken}`,
        },
        payload: {
          idScanValue: 'ID123456',
          membershipScanValue: '12345',
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data.sessionId).toBeDefined();
      // When membership number is provided and member exists, uses member's name
      expect(data.customerName).toBe('Test Customer');
      expect(data.membershipNumber).toBe('12345');
      expect(data.allowedRentals).toContain('LOCKER');
      expect(data.allowedRentals).toContain('STANDARD');
    }));

    it('should update existing session with membership scan', runIfDbAvailable(async () => {
      // Create initial session
      await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/start`,
        headers: {
          'Authorization': `Bearer ${staffToken}`,
        },
        payload: {
          idScanValue: 'ID123456',
        },
      });

      // Update with membership
      const response = await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/start`,
        headers: {
          'Authorization': `Bearer ${staffToken}`,
        },
        payload: {
          idScanValue: 'ID123456',
          membershipScanValue: '12345',
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data.membershipNumber).toBe('12345');
    }));
  });

  describe('POST /v1/checkin/lane/:laneId/select-rental', () => {
    it('should update session with rental selection', runIfDbAvailable(async () => {
      // Start session first
      const startResponse = await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/start`,
        headers: {
          'Authorization': `Bearer ${staffToken}`,
        },
        payload: {
          idScanValue: 'ID123456',
          membershipScanValue: '12345',
        },
      });
      const startData = JSON.parse(startResponse.body);

      // Select rental
      const response = await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/select-rental`,
        headers: {
          'Authorization': `Bearer ${staffToken}`,
        },
        payload: {
          rentalType: 'STANDARD',
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data.desiredRentalType).toBe('STANDARD');
    }));

    it('should handle waitlist with backup selection', runIfDbAvailable(async () => {
      await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/start`,
        headers: {
          'Authorization': `Bearer ${staffToken}`,
        },
        payload: {
          idScanValue: 'ID123456',
          membershipScanValue: '12345',
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/select-rental`,
        headers: {
          'Authorization': `Bearer ${staffToken}`,
        },
        payload: {
          rentalType: 'LOCKER',
          waitlistDesiredType: 'STANDARD',
          backupRentalType: 'LOCKER',
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data.waitlistDesiredType).toBe('STANDARD');
      expect(data.backupRentalType).toBe('LOCKER');
    }));
  });

  describe('POST /v1/checkin/lane/:laneId/assign', () => {
    it('should assign a room with transactional locking', runIfDbAvailable(async () => {
      // Create a clean room
      const roomResult = await query<{ id: string; number: string }>(
        `INSERT INTO rooms (number, type, status, floor)
         VALUES ('101', 'STANDARD', 'CLEAN', 1)
         RETURNING id, number`
      );
      const roomId = roomResult.rows[0]!.id;

      // Start session and select rental
      await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/start`,
        headers: {
          'Authorization': `Bearer ${staffToken}`,
        },
        payload: {
          idScanValue: 'ID123456',
          membershipScanValue: '12345',
        },
      });

      await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/select-rental`,
        headers: {
          'Authorization': `Bearer ${staffToken}`,
        },
        payload: {
          rentalType: 'STANDARD',
        },
      });

      // Assign room
      const response = await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/assign`,
        headers: {
          'Authorization': `Bearer ${staffToken}`,
        },
        payload: {
          resourceType: 'room',
          resourceId: roomId,
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data.success).toBe(true);
      expect(data.resourceType).toBe('room');
      expect(data.roomNumber).toBe('101');

      // Verify room is assigned
      const roomCheck = await query<{ assigned_to_customer_id: string | null }>(
        `SELECT assigned_to_customer_id FROM rooms WHERE id = $1`,
        [roomId]
      );
      expect(roomCheck.rows[0]!.assigned_to_customer_id).toBeTruthy();
    }));

    it('should prevent double-booking with race condition', runIfDbAvailable(async () => {
      // Create a clean room
      const roomResult = await query<{ id: string }>(
        `INSERT INTO rooms (number, type, status, floor)
         VALUES ('102', 'STANDARD', 'CLEAN', 1)
         RETURNING id`
      );
      const roomId = roomResult.rows[0]!.id;

      // Create two customers for the race condition test
      const customer1Result = await query<{ id: string }>(
        `INSERT INTO customers (name, membership_number)
         VALUES ('Test Customer 1', '11111')
         RETURNING id`
      );
      const customer1Id = customer1Result.rows[0]!.id;

      const customer2Result = await query<{ id: string }>(
        `INSERT INTO customers (name, membership_number)
         VALUES ('Test Customer 2', '22222')
         RETURNING id`
      );
      const customer2Id = customer2Result.rows[0]!.id;

      // Start two sessions
      await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/LANE_1/start`,
        headers: {
          'Authorization': `Bearer ${staffToken}`,
        },
        payload: {
          idScanValue: 'ID111',
          membershipScanValue: '11111',
        },
      });

      await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/LANE_2/start`,
        headers: {
          'Authorization': `Bearer ${staffToken}`,
        },
        payload: {
          idScanValue: 'ID222',
          membershipScanValue: '22222',
        },
      });

      // Both select rental
      await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/LANE_1/select-rental`,
        headers: {
          'Authorization': `Bearer ${staffToken}`,
        },
        payload: { rentalType: 'STANDARD' },
      });

      await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/LANE_2/select-rental`,
        headers: {
          'Authorization': `Bearer ${staffToken}`,
        },
        payload: { rentalType: 'STANDARD' },
      });

      // Both try to assign the same room concurrently
      const [response1, response2] = await Promise.all([
        app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/LANE_1/assign`,
          headers: {
            'Authorization': `Bearer ${staffToken}`,
          },
          payload: {
            resourceType: 'room',
            resourceId: roomId,
          },
        }),
        app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/LANE_2/assign`,
          headers: {
            'Authorization': `Bearer ${staffToken}`,
          },
          payload: {
            resourceType: 'room',
            resourceId: roomId,
          },
        }),
      ]);

      // One should succeed, one should fail with race condition
      const successCount = [response1, response2].filter(r => r.statusCode === 200).length;
      const failureCount = [response1, response2].filter(r => r.statusCode === 409).length;

      expect(successCount).toBe(1);
      expect(failureCount).toBe(1);

      // Clean up test customers - delete in order to respect foreign key constraints
      await query(`DELETE FROM checkout_requests WHERE customer_id IN ($1, $2)`, [customer1Id, customer2Id]);
      await query(`DELETE FROM agreement_signatures WHERE checkin_id IN (SELECT id FROM sessions WHERE customer_id IN ($1, $2))`, [customer1Id, customer2Id]);
      await query(`DELETE FROM checkin_blocks WHERE visit_id IN (SELECT id FROM visits WHERE customer_id IN ($1, $2))`, [customer1Id, customer2Id]);
      await query(`DELETE FROM charges WHERE visit_id IN (SELECT id FROM visits WHERE customer_id IN ($1, $2))`, [customer1Id, customer2Id]);
      await query(`DELETE FROM sessions WHERE customer_id IN ($1, $2) OR visit_id IN (SELECT id FROM visits WHERE customer_id IN ($1, $2))`, [customer1Id, customer2Id]);
      await query(`DELETE FROM visits WHERE customer_id IN ($1, $2)`, [customer1Id, customer2Id]);
      await query(`DELETE FROM lane_sessions WHERE customer_id IN ($1, $2)`, [customer1Id, customer2Id]);
      await query(`DELETE FROM customers WHERE id IN ($1, $2) OR membership_number IN ('11111', '22222')`, [customer1Id, customer2Id]);
    }));
  });

  describe('POST /v1/checkin/lane/:laneId/create-payment-intent', () => {
    it('should create payment intent with correct quote', runIfDbAvailable(async () => {
      // Create room and assign
      const roomResult = await query<{ id: string }>(
        `INSERT INTO rooms (number, type, status, floor)
         VALUES ('103', 'STANDARD', 'CLEAN', 1)
         RETURNING id`
      );
      const roomId = roomResult.rows[0]!.id;

      await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/start`,
        headers: {
          'Authorization': `Bearer ${staffToken}`,
        },
        payload: {
          idScanValue: 'ID123456',
          membershipScanValue: '12345',
        },
      });

      await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/select-rental`,
        headers: {
          'Authorization': `Bearer ${staffToken}`,
        },
        payload: { rentalType: 'STANDARD' },
      });

      await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/assign`,
        headers: {
          'Authorization': `Bearer ${staffToken}`,
        },
        payload: {
          resourceType: 'room',
          resourceId: roomId,
        },
      });

      // Create payment intent
      const response = await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/create-payment-intent`,
        headers: {
          'Authorization': `Bearer ${staffToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data.paymentIntentId).toBeDefined();
      // Amount might be returned as string from database, convert to number
      const amount = typeof data.amount === 'string' ? parseFloat(data.amount) : data.amount;
      expect(amount).toBeGreaterThan(0);
      expect(data.quote).toBeDefined();
      expect(data.quote.total).toBe(amount);
    }));
  });

  describe('POST /v1/payments/:id/mark-paid', () => {
    it('should mark payment intent as paid', runIfDbAvailable(async () => {
      // Create session first
      await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/start`,
        headers: {
          'Authorization': `Bearer ${staffToken}`,
        },
        payload: {
          idScanValue: 'ID123456',
        },
      });

      const intentResult = await query<{ id: string }>(
        `INSERT INTO payment_intents (lane_session_id, amount, status, quote_json)
         VALUES (
           (SELECT id FROM lane_sessions WHERE lane_id = $1 ORDER BY created_at DESC LIMIT 1),
           50.00,
           'DUE',
           '{"total": 50, "lineItems": []}'
         )
         RETURNING id`,
        [laneId]
      );
      const intentId = intentResult.rows[0]!.id;

      const response = await app.inject({
        method: 'POST',
        url: `/v1/payments/${intentId}/mark-paid`,
        headers: {
          'Authorization': `Bearer ${staffToken}`,
        },
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data.status).toBe('PAID');

      // Verify in database
      const checkResult = await query<{ status: string }>(
        `SELECT status FROM payment_intents WHERE id = $1`,
        [intentId]
      );
      expect(checkResult.rows[0]!.status).toBe('PAID');
    }));
  });

  describe('POST /v1/checkin/lane/:laneId/sign-agreement', () => {
    it('should store signature and complete check-in', runIfDbAvailable(async () => {
      // Setup: create session, assign, create payment intent, mark paid
      const roomResult = await query<{ id: string }>(
        `INSERT INTO rooms (number, type, status, floor)
         VALUES ('104', 'STANDARD', 'CLEAN', 1)
         RETURNING id`
      );
      const roomId = roomResult.rows[0]!.id;

      const startResponse = await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/start`,
        headers: {
          'Authorization': `Bearer ${staffToken}`,
        },
        payload: {
          idScanValue: 'ID123456',
          membershipScanValue: '12345',
        },
      });
      const startData = JSON.parse(startResponse.body);

      await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/select-rental`,
        headers: {
          'Authorization': `Bearer ${staffToken}`,
        },
        payload: { rentalType: 'STANDARD' },
      });

      await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/assign`,
        headers: {
          'Authorization': `Bearer ${staffToken}`,
        },
        payload: {
          resourceType: 'room',
          resourceId: roomId,
        },
      });

      const intentResponse = await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/create-payment-intent`,
        headers: {
          'Authorization': `Bearer ${staffToken}`,
        },
      });
      const intentData = JSON.parse(intentResponse.body);

      await app.inject({
        method: 'POST',
        url: `/v1/payments/${intentData.paymentIntentId}/mark-paid`,
        headers: {
          'Authorization': `Bearer ${staffToken}`,
        },
        payload: {},
      });

      // Sign agreement
      const response = await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/sign-agreement`,
        payload: {
          signaturePayload: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          sessionId: startData.sessionId,
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data.success).toBe(true);

      // Verify visit and check-in block created
      const visitResult = await query<{ id: string }>(
        `SELECT id FROM visits WHERE customer_id = $1`,
        [customerId]
      );
      expect(visitResult.rows.length).toBeGreaterThan(0);

      // Verify room status changed to OCCUPIED
      const roomStatusResult = await query<{ status: string }>(
        `SELECT status FROM rooms WHERE id = $1`,
        [roomId]
      );
      expect(roomStatusResult.rows[0]!.status).toBe('OCCUPIED');
    }));
  });
});
