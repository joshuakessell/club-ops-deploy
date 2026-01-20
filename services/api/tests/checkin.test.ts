import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { query, initializeDatabase, closeDatabase } from '../src/db/index.js';
import { createBroadcaster, type Broadcaster } from '../src/websocket/broadcaster.js';
import { checkinRoutes } from '../src/routes/checkin.js';
import { customerRoutes } from '../src/routes/customers.js';
import { inventoryRoutes } from '../src/routes/inventory.js';
import { sessionDocumentsRoutes } from '../src/routes/session-documents.js';
import { hashPin, generateSessionToken } from '../src/auth/utils.js';
import type { SessionUpdatedPayload, CustomerConfirmedPayload } from '@club-ops/shared';
import { truncateAllTables } from './testDb.js';

// Augment FastifyInstance with broadcaster
declare module 'fastify' {
  interface FastifyInstance {
    broadcaster: Broadcaster;
  }
}

describe('Check-in Flow', () => {
  const TEST_KIOSK_TOKEN = 'test-kiosk-token';
  let app: FastifyInstance;
  let staffToken: string;
  let staffId: string;
  let laneId: string;
  let customerId: string;
  let dbAvailable = false;
  let sessionUpdatedEvents: Array<{ lane: string; payload: SessionUpdatedPayload }> = [];
  let customerConfirmedEvents: Array<{ lane: string; payload: CustomerConfirmedPayload }> = [];

  beforeAll(async () => {
    process.env.KIOSK_TOKEN = TEST_KIOSK_TOKEN;
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
    // Capture SESSION_UPDATED payloads for assertions (without requiring a websocket client)
    const originalBroadcastSessionUpdated = broadcaster.broadcastSessionUpdated.bind(broadcaster);
    broadcaster.broadcastSessionUpdated = (payload, lane) => {
      sessionUpdatedEvents.push({ lane, payload });
      return originalBroadcastSessionUpdated(payload, lane);
    };
    // Capture CUSTOMER_CONFIRMED payloads for assertions.
    const originalBroadcastCustomerConfirmed = broadcaster.broadcastCustomerConfirmed.bind(broadcaster);
    broadcaster.broadcastCustomerConfirmed = (payload, lane) => {
      customerConfirmedEvents.push({ lane, payload });
      return originalBroadcastCustomerConfirmed(payload, lane);
    };
    app.decorate('broadcaster', broadcaster);

    // Register check-in routes
    // Note: Tests will need to properly authenticate or we'll mock requireAuth
    await app.register(checkinRoutes);
    await app.register(customerRoutes);
    await app.register(inventoryRoutes);
    await app.register(sessionDocumentsRoutes);

    await app.ready();
  });

  beforeEach(async () => {
    if (!dbAvailable) return;
    sessionUpdatedEvents = [];
    customerConfirmedEvents = [];

    // Ensure each test starts from a clean DB state (integration tests share one DB).
    await truncateAllTables((text, params) => query(text, params));

    // Create test staff
    const pinHash = await hashPin('111111');
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
    await query(
      `DELETE FROM checkout_requests WHERE customer_id IN (SELECT id FROM customers WHERE membership_number = '12345')`
    );
    await query(
      `DELETE FROM agreement_signatures
       WHERE checkin_block_id IN (
         SELECT cb.id
         FROM checkin_blocks cb
         JOIN visits v ON v.id = cb.visit_id
         JOIN customers c ON c.id = v.customer_id
         WHERE c.membership_number = '12345'
       )
       OR membership_number = '12345'`
    );
    await query(
      `DELETE FROM checkin_blocks WHERE visit_id IN (SELECT id FROM visits WHERE customer_id IN (SELECT id FROM customers WHERE membership_number = '12345'))`
    );
    await query(
      `DELETE FROM charges WHERE visit_id IN (SELECT id FROM visits WHERE customer_id IN (SELECT id FROM customers WHERE membership_number = '12345'))`
    );
    await query(
      `DELETE FROM sessions WHERE customer_id IN (SELECT id FROM customers WHERE membership_number = '12345') OR visit_id IN (SELECT id FROM visits WHERE customer_id IN (SELECT id FROM customers WHERE membership_number = '12345'))`
    );
    await query(
      `DELETE FROM visits WHERE customer_id IN (SELECT id FROM customers WHERE membership_number = '12345')`
    );
    await query(
      `DELETE FROM lane_sessions WHERE customer_id IN (SELECT id FROM customers WHERE membership_number = '12345')`
    );
    await query(`DELETE FROM customers WHERE membership_number = '12345'`);

    // Create test customer
    const customerResult = await query<{ id: string }>(
      `INSERT INTO customers (name, membership_number)
       VALUES ('Test Customer', '12345')
       RETURNING id`
    );
    customerId = customerResult.rows[0]!.id;

    // Ensure an active agreement exists for signing flow
    await query(`UPDATE agreements SET active = false WHERE active = true`);
    await query(
      `INSERT INTO agreements (version, title, body_text, active)
       VALUES ('test-v1', 'Test Agreement', 'Test agreement text', true)`
    );

    laneId = 'LANE_1';
  });

  afterEach(async () => {
    if (!dbAvailable) return;

    // Clean up test data - delete in order to respect foreign key constraints
    await query(`DELETE FROM checkout_requests WHERE customer_id = $1`, [customerId]);
    await query(
      `DELETE FROM agreement_signatures
       WHERE checkin_block_id IN (
         SELECT cb.id
         FROM checkin_blocks cb
         JOIN visits v ON v.id = cb.visit_id
         WHERE v.customer_id = $1
       )`,
      [customerId]
    );
    await query(
      `DELETE FROM checkin_blocks WHERE visit_id IN (SELECT id FROM visits WHERE customer_id = $1)`,
      [customerId]
    );
    await query(
      `DELETE FROM charges WHERE visit_id IN (SELECT id FROM visits WHERE customer_id = $1)`,
      [customerId]
    );
    await query(
      `DELETE FROM sessions WHERE customer_id = $1 OR visit_id IN (SELECT id FROM visits WHERE customer_id = $1)`,
      [customerId]
    );
    await query(`DELETE FROM visits WHERE customer_id = $1`, [customerId]);
    await query(`DELETE FROM lane_sessions WHERE lane_id = $1 OR lane_id = 'LANE_2'`, [laneId]);
    await query(`DELETE FROM payment_intents`);
    await query(`DELETE FROM staff_sessions WHERE staff_id = $1`, [staffId]);
    await query(`DELETE FROM customers WHERE id = $1 OR membership_number = '12345'`, [customerId]);
    await query(`DELETE FROM staff WHERE id = $1`, [staffId]);
    await query(`DELETE FROM rooms WHERE number IN ('200', '202', '203', '204')`);
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
    it(
      'should create a new lane session with ID scan',
      runIfDbAvailable(async () => {
        const response = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/start`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
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
      })
    );

    it(
      'should start a lane session for an existing customerId (no ID scan required)',
      runIfDbAvailable(async () => {
        const response = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/start`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: {
            customerId,
          },
        });

        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.body);
        expect(data.sessionId).toBeDefined();
        expect(data.customerName).toBe('Test Customer');
        expect(data.membershipNumber).toBe('12345');
      })
    );

    it(
      'should update existing session with membership scan',
      runIfDbAvailable(async () => {
        // Create initial session
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/start`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
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
            Authorization: `Bearer ${staffToken}`,
          },
          payload: {
            idScanValue: 'ID123456',
            membershipScanValue: '12345',
          },
        });

        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.body);
        expect(data.membershipNumber).toBe('12345');
      })
    );
  });

  describe('POST /v1/checkin/lane/:laneId/customer-confirm', () => {
    it(
      'should unassign the selected resource when customer declines (regression for assigned_to column mismatch)',
      runIfDbAvailable(async () => {
        // Create a clean room and assign it to the customer to simulate a pending cross-type assignment.
        const roomResult = await query<{ id: string }>(
          `INSERT INTO rooms (number, type, status, floor, assigned_to_customer_id)
           VALUES ('204', 'STANDARD', 'CLEAN', 1, $1)
           RETURNING id`,
          [customerId]
        );
        const roomId = roomResult.rows[0]!.id;

        // Start a lane session (authenticated) and then mark it as having a selected resource.
        const startRes = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/start`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: {
            customerId,
          },
        });
        expect(startRes.statusCode).toBe(200);
        const startJson = JSON.parse(startRes.body) as { sessionId: string };

        await query(
          `UPDATE lane_sessions
           SET desired_rental_type = 'LOCKER',
               assigned_resource_type = 'room',
               assigned_resource_id = $1,
               updated_at = NOW()
           WHERE id = $2`,
          [roomId, startJson.sessionId]
        );

        // Customer declines.
        const declineRes = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/customer-confirm`,
          headers: {
            'x-kiosk-token': TEST_KIOSK_TOKEN,
          },
          payload: {
            sessionId: startJson.sessionId,
            confirmed: false,
          },
        });

        expect(declineRes.statusCode).toBe(200);

        // Resource should be unassigned using the canonical DB column name assigned_to_customer_id.
        const roomAfter = await query<{ assigned_to_customer_id: string | null }>(
          `SELECT assigned_to_customer_id FROM rooms WHERE id = $1`,
          [roomId]
        );
        expect(roomAfter.rows[0]!.assigned_to_customer_id).toBeNull();

        const sessionAfter = await query<{ assigned_resource_id: string | null; assigned_resource_type: string | null }>(
          `SELECT assigned_resource_id, assigned_resource_type FROM lane_sessions WHERE id = $1`,
          [startJson.sessionId]
        );
        expect(sessionAfter.rows[0]!.assigned_resource_id).toBeNull();
        expect(sessionAfter.rows[0]!.assigned_resource_type).toBeNull();
      })
    );

    it(
      'should broadcast confirmedType/confirmedNumber using the assigned resource number (not UUID)',
      runIfDbAvailable(async () => {
        // Create a SPECIAL room and assign it to the customer to simulate a pending cross-type assignment.
        const roomResult = await query<{ id: string }>(
          `INSERT INTO rooms (number, type, status, floor, assigned_to_customer_id)
           VALUES ('201', 'SPECIAL', 'CLEAN', 1, $1)
           RETURNING id`,
          [customerId]
        );
        const roomId = roomResult.rows[0]!.id;

        // Start a lane session (authenticated) for the customer.
        const startRes = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/start`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: {
            customerId,
          },
        });
        expect(startRes.statusCode).toBe(200);
        const startJson = JSON.parse(startRes.body) as { sessionId: string };

        // Mark the session as having a selected room (cross-type selection simulation).
        await query(
          `UPDATE lane_sessions
           SET desired_rental_type = 'LOCKER',
               assigned_resource_type = 'room',
               assigned_resource_id = $1,
               updated_at = NOW()
           WHERE id = $2`,
          [roomId, startJson.sessionId]
        );

        // Customer confirms.
        const confirmRes = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/customer-confirm`,
          headers: {
            'x-kiosk-token': TEST_KIOSK_TOKEN,
          },
          payload: {
            sessionId: startJson.sessionId,
            confirmed: true,
          },
        });
        expect(confirmRes.statusCode).toBe(200);

        // Should broadcast CUSTOMER_CONFIRMED with tier+number (not UUID).
        expect(customerConfirmedEvents.length).toBeGreaterThanOrEqual(1);
        const last = customerConfirmedEvents[customerConfirmedEvents.length - 1]!;
        expect(last.lane).toBe(laneId);
        expect(last.payload.sessionId).toBe(startJson.sessionId);
        expect(last.payload.confirmedType).toBe('SPECIAL');
        expect(last.payload.confirmedNumber).toBe('201');
      })
    );
  });

  describe('POST /v1/checkin/lane/:laneId/select-rental', () => {
    it(
      'should update session with rental selection',
      runIfDbAvailable(async () => {
        // Start session first
        const startResponse = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/start`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
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
            Authorization: `Bearer ${staffToken}`,
          },
          payload: {
            rentalType: 'STANDARD',
          },
        });

        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.body);
        expect(data.desiredRentalType).toBe('STANDARD');
      })
    );

    it(
      'should handle waitlist with backup selection',
      runIfDbAvailable(async () => {
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/start`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
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
            Authorization: `Bearer ${staffToken}`,
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
      })
    );
  });

  describe('POST /v1/checkin/lane/:laneId/assign', () => {
    it(
      'should record selected resource on the lane session (inventory assignment happens after signing)',
      runIfDbAvailable(async () => {
        // Create a clean room
        const roomResult = await query<{ id: string; number: string }>(
          `INSERT INTO rooms (number, type, status, floor)
         VALUES ('200', 'STANDARD', 'CLEAN', 1)
         RETURNING id, number`
        );
        const roomId = roomResult.rows[0]!.id;

        // Start session and select rental
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/start`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: {
            idScanValue: 'ID123456',
            membershipScanValue: '12345',
          },
        });

        // Lock selection (required for payment/signing; assignment selection itself can happen any time)
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/propose-selection`,
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { rentalType: 'STANDARD', proposedBy: 'EMPLOYEE' },
        });
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/confirm-selection`,
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { confirmedBy: 'EMPLOYEE' },
        });

        // Assign room
        const response = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/assign`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
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
        expect(data.roomNumber).toBe('200');

        // Verify room is NOT yet assigned/occupied (that happens after agreement signing)
        const roomCheck = await query<{ assigned_to_customer_id: string | null; status: string }>(
          `SELECT assigned_to_customer_id, status FROM rooms WHERE id = $1`,
          [roomId]
        );
        expect(roomCheck.rows[0]!.assigned_to_customer_id).toBeNull();
        expect(roomCheck.rows[0]!.status).toBe('CLEAN');

        // Verify lane session snapshot points at this room
        const sessionCheck = await query<{
          assigned_resource_id: string | null;
          assigned_resource_type: string | null;
        }>(
          `SELECT assigned_resource_id, assigned_resource_type
         FROM lane_sessions
         WHERE lane_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
          [laneId]
        );
        expect(sessionCheck.rows[0]!.assigned_resource_id).toBe(roomId);
        expect(sessionCheck.rows[0]!.assigned_resource_type).toBe('room');
      })
    );
  });

  describe('POST /v1/checkin/lane/:laneId/create-payment-intent', () => {
    it(
      'should create payment intent from locked desired_rental_type (no assignment required) and enforce <=1 DUE intent per session',
      runIfDbAvailable(async () => {
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/start`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: {
            idScanValue: 'ID123456',
            membershipScanValue: '12345',
          },
        });

        // Lock selection
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/propose-selection`,
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { rentalType: 'STANDARD', proposedBy: 'EMPLOYEE' },
        });
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/confirm-selection`,
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { confirmedBy: 'EMPLOYEE' },
        });

        // Create payment intent
        const response1 = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/create-payment-intent`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
        });

        expect(response1.statusCode).toBe(200);
        const data1 = JSON.parse(response1.body);
        expect(data1.paymentIntentId).toBeDefined();
        // Amount might be returned as string from database, convert to number
        const amount = typeof data1.amount === 'string' ? parseFloat(data1.amount) : data1.amount;
        expect(amount).toBeGreaterThan(0);
        expect(data1.quote).toBeDefined();
        expect(data1.quote.total).toBe(amount);

        // Idempotent-ish: calling again should not create an additional DUE intent
        const response2 = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/create-payment-intent`,
          headers: { Authorization: `Bearer ${staffToken}` },
        });
        expect(response2.statusCode).toBe(200);

        const laneSession = await query<{ id: string }>(
          `SELECT id FROM lane_sessions WHERE lane_id = $1 ORDER BY created_at DESC LIMIT 1`,
          [laneId]
        );
        const dueCount = await query<{ count: string }>(
          `SELECT COUNT(*)::text as count FROM payment_intents WHERE lane_session_id = $1 AND status = 'DUE'`,
          [laneSession.rows[0]!.id]
        );
        expect(parseInt(dueCount.rows[0]!.count, 10)).toBe(1);
      })
    );

    it(
      'should broadcast a full, stable SessionUpdated payload including customer + payment fields',
      runIfDbAvailable(async () => {
        // Seed DOB so the payload can include customerDobMonthDay
        await query(`UPDATE customers SET dob = '1980-01-15'::date WHERE id = $1`, [customerId]);

        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/start`,
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { idScanValue: 'ID123456', membershipScanValue: '12345' },
        });

        // Language selection should persist on customer and be present in subsequent payloads
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/set-language`,
          headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
          payload: { language: 'ES' },
        });

        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/propose-selection`,
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { rentalType: 'STANDARD', proposedBy: 'EMPLOYEE' },
        });
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/confirm-selection`,
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { confirmedBy: 'EMPLOYEE' },
        });

        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/create-payment-intent`,
          headers: { Authorization: `Bearer ${staffToken}` },
        });

        const last = sessionUpdatedEvents.filter((e) => e.lane === laneId).at(-1)?.payload;
        expect(last).toBeTruthy();
        expect(last!.customerName).toBe('Test Customer');
        expect(last!.customerPrimaryLanguage).toBe('ES');
        expect(last!.customerDobMonthDay).toBe('01/15');
        expect(last!.paymentIntentId).toBeTruthy();
        expect(last!.paymentStatus).toBe('DUE');
        expect(typeof last!.paymentTotal).toBe('number');
      })
    );
  });

  describe('POST /v1/payments/:id/mark-paid', () => {
    it(
      'should mark payment intent as paid',
      runIfDbAvailable(async () => {
        // Create session first
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/start`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
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
            Authorization: `Bearer ${staffToken}`,
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
      })
    );
  });

  describe('POST /v1/checkin/lane/:laneId/membership-purchase-intent', () => {
    it(
      "should allow intent=NONE to clear a prior 6-month intent (stored as NULL) and recompute the DUE quote",
      runIfDbAvailable(async () => {
        // Start a lane session
        const startResponse = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/start`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: {
            customerId,
          },
        });
        expect(startResponse.statusCode).toBe(200);
        const startData = JSON.parse(startResponse.body) as { sessionId: string };
        expect(startData.sessionId).toBeTruthy();

        // Confirm a selection + create a DUE payment intent (required for immediate quote updates).
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/propose-selection`,
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { rentalType: 'STANDARD', proposedBy: 'EMPLOYEE' },
        });
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/confirm-selection`,
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { confirmedBy: 'EMPLOYEE' },
        });
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/create-payment-intent`,
          headers: { Authorization: `Bearer ${staffToken}` },
        });

        const piIdResult = await query<{ payment_intent_id: string | null }>(
          `SELECT payment_intent_id FROM lane_sessions WHERE id = $1`,
          [startData.sessionId]
        );
        const paymentIntentId = piIdResult.rows[0]!.payment_intent_id;
        expect(paymentIntentId).toBeTruthy();

        const getQuote = async () => {
          const r = await query<{ quote_json: unknown }>(
            `SELECT quote_json FROM payment_intents WHERE id = $1`,
            [paymentIntentId]
          );
          const raw = r.rows[0]!.quote_json;
          return typeof raw === 'string' ? (JSON.parse(raw) as any) : (raw as any);
        };

        // Baseline quote should include daily membership fee (customer has no valid membership on file).
        const baseQuote = await getQuote();
        const baseItems: Array<{ description: string; amount: number }> = baseQuote.lineItems ?? [];
        expect(baseItems.some((li) => li.description === 'Membership Fee')).toBe(true);
        expect(baseItems.some((li) => li.description === '6 Month Membership')).toBe(false);

        // Set PURCHASE intent; quote should include 6 Month Membership and omit Membership Fee.
        const purchaseResp = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/membership-purchase-intent`,
          headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
          payload: { intent: 'PURCHASE', sessionId: startData.sessionId },
        });
        expect(purchaseResp.statusCode).toBe(200);

        const intentRow = await query<{
          membership_purchase_intent: string | null;
          membership_purchase_requested_at: string | null;
        }>(
          `SELECT membership_purchase_intent, membership_purchase_requested_at
           FROM lane_sessions
           WHERE id = $1`,
          [startData.sessionId]
        );
        expect(intentRow.rows[0]!.membership_purchase_intent).toBe('PURCHASE');
        expect(intentRow.rows[0]!.membership_purchase_requested_at).toBeTruthy();

        const purchasedQuote = await getQuote();
        const purchasedItems: Array<{ description: string; amount: number }> =
          purchasedQuote.lineItems ?? [];
        expect(purchasedItems.some((li) => li.description === '6 Month Membership')).toBe(true);
        expect(purchasedItems.some((li) => li.description === 'Membership Fee')).toBe(false);

        // Clear it with NONE; should persist NULLs and restore Membership Fee in the quote.
        const clearResp = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/membership-purchase-intent`,
          headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
          payload: { intent: 'NONE', sessionId: startData.sessionId },
        });
        expect(clearResp.statusCode).toBe(200);

        const clearedRow = await query<{
          membership_purchase_intent: string | null;
          membership_purchase_requested_at: string | null;
        }>(
          `SELECT membership_purchase_intent, membership_purchase_requested_at
           FROM lane_sessions
           WHERE id = $1`,
          [startData.sessionId]
        );
        expect(clearedRow.rows[0]!.membership_purchase_intent).toBeNull();
        expect(clearedRow.rows[0]!.membership_purchase_requested_at).toBeNull();

        const clearedQuote = await getQuote();
        const clearedItems: Array<{ description: string; amount: number }> = clearedQuote.lineItems ?? [];
        expect(clearedItems.some((li) => li.description === 'Membership Fee')).toBe(true);
        expect(clearedItems.some((li) => li.description === '6 Month Membership')).toBe(false);
      })
    );
  });

  describe('POST /v1/checkin/lane/:laneId/propose-selection', () => {
    it(
      'should allow customer to propose a rental type',
      runIfDbAvailable(async () => {
        // Start a lane session
        const startResponse = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/start`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: {
            idScanValue: 'ID123456',
            membershipScanValue: '12345',
          },
        });
        expect(startResponse.statusCode).toBe(200);

        // Customer proposes selection
        const proposeResponse = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/propose-selection`,
          headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
          payload: {
            rentalType: 'STANDARD',
            proposedBy: 'CUSTOMER',
          },
        });
        expect(proposeResponse.statusCode).toBe(200);
        const proposeData = JSON.parse(proposeResponse.body);
        expect(proposeData.proposedRentalType).toBe('STANDARD');
        expect(proposeData.proposedBy).toBe('CUSTOMER');
      })
    );

    it(
      'should allow employee to propose a rental type',
      runIfDbAvailable(async () => {
        // Start a lane session
        const startResponse = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/start`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: {
            idScanValue: 'ID123456',
            membershipScanValue: '12345',
          },
        });
        expect(startResponse.statusCode).toBe(200);

        // Employee proposes selection
        const proposeResponse = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/propose-selection`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: {
            rentalType: 'DOUBLE',
            proposedBy: 'EMPLOYEE',
          },
        });
        expect(proposeResponse.statusCode).toBe(200);
        const proposeData = JSON.parse(proposeResponse.body);
        expect(proposeData.proposedRentalType).toBe('DOUBLE');
        expect(proposeData.proposedBy).toBe('EMPLOYEE');
      })
    );
  });

  describe('POST /v1/checkin/lane/:laneId/confirm-selection', () => {
    it(
      'should lock selection on first confirmation (first-wins)',
      runIfDbAvailable(async () => {
        // Start a lane session
        const startResponse = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/start`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: {
            idScanValue: 'ID123456',
            membershipScanValue: '12345',
          },
        });
        expect(startResponse.statusCode).toBe(200);

        // Customer proposes
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/propose-selection`,
          headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
          payload: {
            rentalType: 'STANDARD',
            proposedBy: 'CUSTOMER',
          },
        });

        // Employee confirms first (locks it)
        const confirmResponse = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/confirm-selection`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: {
            confirmedBy: 'EMPLOYEE',
          },
        });
        expect(confirmResponse.statusCode).toBe(200);
        const confirmData = JSON.parse(confirmResponse.body);
        expect(confirmData.confirmedBy).toBe('EMPLOYEE');
        expect(confirmData.rentalType).toBe('STANDARD');

        const sessionRow = await query<{
          selection_confirmed: boolean;
          selection_confirmed_by: string | null;
          selection_locked_at: Date | null;
        }>(
          `SELECT selection_confirmed, selection_confirmed_by, selection_locked_at
         FROM lane_sessions
         WHERE lane_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
          [laneId]
        );
        expect(sessionRow.rows[0]!.selection_confirmed).toBe(true);
        expect(sessionRow.rows[0]!.selection_confirmed_by).toBe('EMPLOYEE');
        expect(sessionRow.rows[0]!.selection_locked_at).toBeTruthy();

        // Customer tries to confirm (should be idempotent)
        const customerConfirmResponse = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/confirm-selection`,
          payload: {
            confirmedBy: 'CUSTOMER',
          },
        });
        expect(customerConfirmResponse.statusCode).toBe(200);
        const customerConfirmData = JSON.parse(customerConfirmResponse.body);
        expect(customerConfirmData.confirmedBy).toBe('EMPLOYEE'); // Still employee
      })
    );

    it(
      'should require acknowledgement from non-confirming party',
      runIfDbAvailable(async () => {
        // Start a lane session
        const startResponse = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/start`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: {
            idScanValue: 'ID123456',
            membershipScanValue: '12345',
          },
        });
        expect(startResponse.statusCode).toBe(200);

        // Employee proposes and confirms
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/propose-selection`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: {
            rentalType: 'DOUBLE',
            proposedBy: 'EMPLOYEE',
          },
        });

        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/confirm-selection`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: {
            confirmedBy: 'EMPLOYEE',
          },
        });

        // Customer acknowledges
        const ackResponse = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/acknowledge-selection`,
          payload: {
            acknowledgedBy: 'CUSTOMER',
          },
        });
        expect(ackResponse.statusCode).toBe(200);
      })
    );
  });

  describe('GET /v1/checkin/lane/:laneId/waitlist-info', () => {
    it(
      'should compute waitlist position and ETA',
      runIfDbAvailable(async () => {
        // Start a lane session
        const startResponse = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/start`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: {
            idScanValue: 'ID123456',
            membershipScanValue: '12345',
          },
        });
        expect(startResponse.statusCode).toBe(200);

        // Seed two occupied room blocks with different tiers and different end times:
        // - STANDARD ends sooner
        // - SPECIAL ends later
        //
        // The waitlist ETA for desiredTier=SPECIAL must be based on the SPECIAL block,
        // not the earliest-ending block overall.
        const standardRoomId = (
          await query<{ id: string }>(
            `INSERT INTO rooms (number, type, status, floor)
             VALUES ('200', 'STANDARD', 'OCCUPIED', 1)
             RETURNING id`
          )
        ).rows[0]!.id;
        const specialRoomId = (
          await query<{ id: string }>(
            `INSERT INTO rooms (number, type, status, floor)
             VALUES ('201', 'SPECIAL', 'OCCUPIED', 1)
             RETURNING id`
          )
        ).rows[0]!.id;

        const visitStandardId = (
          await query<{ id: string }>(
            `INSERT INTO visits (customer_id, started_at)
             VALUES ($1, NOW())
             RETURNING id`,
            [customerId]
          )
        ).rows[0]!.id;
        const visitSpecialId = (
          await query<{ id: string }>(
            `INSERT INTO visits (customer_id, started_at)
             VALUES ($1, NOW())
             RETURNING id`,
            [customerId]
          )
        ).rows[0]!.id;

        const now = new Date();
        const standardEndsAt = new Date(now.getTime() + 30 * 60 * 1000);
        const specialEndsAt = new Date(now.getTime() + 90 * 60 * 1000);

        await query(
          `INSERT INTO checkin_blocks (visit_id, block_type, starts_at, ends_at, room_id, rental_type)
           VALUES ($1, 'INITIAL', $2, $3, $4, 'STANDARD')`,
          [visitStandardId, now, standardEndsAt, standardRoomId]
        );
        await query(
          `INSERT INTO checkin_blocks (visit_id, block_type, starts_at, ends_at, room_id, rental_type)
           VALUES ($1, 'INITIAL', $2, $3, $4, 'SPECIAL')`,
          [visitSpecialId, now, specialEndsAt, specialRoomId]
        );

        // Get waitlist info
        const waitlistResponse = await app.inject({
          method: 'GET',
          url: `/v1/checkin/lane/${laneId}/waitlist-info?desiredTier=SPECIAL&currentTier=LOCKER`,
        });
        expect(waitlistResponse.statusCode).toBe(200);
        const waitlistData = JSON.parse(waitlistResponse.body);
        expect(waitlistData.position).toBe(1);
        expect(waitlistData).toHaveProperty('upgradeFee');

        const expectedEta = new Date(specialEndsAt.getTime() + 15 * 60 * 1000).toISOString();
        expect(waitlistData.estimatedReadyAt).toBe(expectedEta);
      })
    );
  });

  describe('POST /v1/checkin/lane/:laneId/scan-id', () => {
    it(
      'should create a customer from ID scan and start lane session',
      runIfDbAvailable(async () => {
        const scanPayload = {
          raw: '@\nANSI 6360100102DL00390188ZV02290028DLDAQ123456789\nDCSDOE\nDACJOHN\nDBD19800115\nDCIUS\n',
          firstName: 'JOHN',
          lastName: 'DOE',
          fullName: 'JOHN DOE',
          dob: '1980-01-15',
          idNumber: '123456789',
          issuer: 'US',
        };

        const response = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/scan-id`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: scanPayload,
        });

        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.body);
        expect(data.sessionId).toBeTruthy();
        expect(data.customerId).toBeTruthy();
        expect(data.customerName).toBe('JOHN DOE');
        expect(data.allowedRentals).toBeDefined();
        expect(Array.isArray(data.allowedRentals)).toBe(true);
      })
    );

    it(
      'should reuse existing customer on same id_scan_hash',
      runIfDbAvailable(async () => {
        const scanPayload1 = {
          raw: '@\nANSI 6360100102DL00390188ZV02290028DLDAQ123456789\nDCSDOE\nDACJOHN\nDBD19800115\nDCIUS\n',
          firstName: 'JOHN',
          lastName: 'DOE',
          fullName: 'JOHN DOE',
          dob: '1980-01-15',
          idNumber: '123456789',
          issuer: 'US',
        };

        // First scan
        const response1 = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/scan-id`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: scanPayload1,
        });
        expect(response1.statusCode).toBe(200);
        const data1 = JSON.parse(response1.body);
        const customerId1 = data1.customerId;

        // Second scan with same raw barcode
        const response2 = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/scan-id`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: scanPayload1,
        });
        expect(response2.statusCode).toBe(200);
        const data2 = JSON.parse(response2.body);

        // Should reuse same customer
        expect(data2.customerId).toBe(customerId1);
      })
    );

    it(
      'should handle manual entry fallback (no raw barcode)',
      runIfDbAvailable(async () => {
        const scanPayload = {
          fullName: 'Jane Smith',
          idNumber: '987654321',
          dob: '1990-05-20',
        };

        const response = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/scan-id`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: scanPayload,
        });

        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.body);
        expect(data.customerName).toBe('Jane Smith');
        expect(data.sessionId).toBeTruthy();
      })
    );

    it(
      'should reject scan if customer is banned',
      runIfDbAvailable(async () => {
        // First create a customer and ban them
        const scanPayload = {
          raw: '@\nANSI 6360100102DL00390188ZV02290028DLDAQ999999999\nDCSBANNED\nDACUSER\nDBD19850101\nDCIUS\n',
          firstName: 'USER',
          lastName: 'BANNED',
          fullName: 'USER BANNED',
          dob: '1985-01-01',
          idNumber: '999999999',
          issuer: 'US',
        };

        // Create customer
        const createResponse = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/scan-id`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: scanPayload,
        });
        expect(createResponse.statusCode).toBe(200);
        const createData = JSON.parse(createResponse.body);

        // Ban the customer
        const banUntil = new Date();
        banUntil.setDate(banUntil.getDate() + 1); // Ban for 1 day
        await query(`UPDATE customers SET banned_until = $1 WHERE id = $2`, [
          banUntil,
          createData.customerId,
        ]);

        // Try to scan again
        const scanResponse = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/scan-id`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: scanPayload,
        });

        expect(scanResponse.statusCode).toBe(403);
        const error = JSON.parse(scanResponse.body);
        expect(error.error).toContain('banned');
      })
    );
  });

  describe('POST /v1/checkin/lane/:laneId/kiosk-ack', () => {
    it(
      'marks kiosk_acknowledged_at but does NOT clear/end the lane session',
      runIfDbAvailable(async () => {
        // Create a minimal active lane session with display fields set.
        const sessionResult = await query<{ id: string }>(
          `INSERT INTO lane_sessions (lane_id, status, customer_display_name, checkin_mode)
         VALUES ($1, 'ACTIVE', 'Done Customer', 'INITIAL')
         RETURNING id`,
          [laneId]
        );
        const sessionId = sessionResult.rows[0]!.id;

        const response = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/kiosk-ack`,
          headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
        });
        expect(response.statusCode).toBe(200);

        const cleared = await query<{
          customer_display_name: string | null;
          customer_id: string | null;
          kiosk_acknowledged_at: string | null;
          status: string;
        }>(`SELECT customer_display_name, customer_id, kiosk_acknowledged_at::text, status::text as status
            FROM lane_sessions WHERE id = $1`, [
          sessionId,
        ]);
        // Contract: kiosk-ack is UI-only and must not clear customer association.
        expect(cleared.rows[0]!.customer_display_name).toBe('Done Customer');
        expect(cleared.rows[0]!.status).not.toBe('COMPLETED');
        expect(cleared.rows[0]!.kiosk_acknowledged_at).toBeTruthy();
      })
    );
  });

  describe('POST /v1/checkin/scan', () => {
    it(
      'matches ID scans by id_scan_hash or id_scan_value',
      runIfDbAvailable(async () => {
        const raw = '@\nDCSDOE\nDACJOHN\nDBD19800115\nDAQ123456789\nDCITX\n';

        // Seed a customer with id_scan_value only (no hash), so scan matches by value and backfills hash.
        const normalized = raw
          .replace(/\r\n/g, '\n')
          .replace(/\r/g, '\n')
          .split('\n')
          .map((l) => l.replace(/[ \t]+/g, ' ').trimEnd())
          .join('\n')
          .trim();
        const customerResult = await query<{ id: string }>(
          `INSERT INTO customers (name, dob, id_scan_value, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         RETURNING id`,
          ['JOHN DOE', '1980-01-15', normalized]
        );
        const customerId = customerResult.rows[0]!.id;

        const response = await app.inject({
          method: 'POST',
          url: '/v1/checkin/scan',
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { laneId, rawScanText: raw },
        });

        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.body);
        expect(data.result).toBe('MATCHED');
        expect(data.scanType).toBe('STATE_ID');
        expect(data.customer.id).toBe(customerId);

        // Verify hash backfilled for future instant matches.
        const hashRow = await query<{ id_scan_hash: string | null }>(
          `SELECT id_scan_hash FROM customers WHERE id = $1`,
          [customerId]
        );
        expect(hashRow.rows[0]!.id_scan_hash).toBeTruthy();
      })
    );

    it(
      'falls back to name+DOB matching and enriches id_scan_hash/value',
      runIfDbAvailable(async () => {
        // Customer exists without scan identifiers.
        const customerResult = await query<{ id: string }>(
          `INSERT INTO customers (name, dob, created_at, updated_at)
         VALUES ($1, $2, NOW(), NOW())
         RETURNING id`,
          ['JOHN DOE', '1980-01-15']
        );
        const customerId = customerResult.rows[0]!.id;

        const raw = '@\nDCSDOE\nDACJOHN\nDBD19800115\nDAQ555555555\nDCITX\n';
        const response = await app.inject({
          method: 'POST',
          url: '/v1/checkin/scan',
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { laneId, rawScanText: raw },
        });

        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.body);
        expect(data.result).toBe('MATCHED');
        expect(data.enriched).toBe(true);
        expect(data.customer.id).toBe(customerId);

        const row = await query<{ id_scan_hash: string | null; id_scan_value: string | null }>(
          `SELECT id_scan_hash, id_scan_value FROM customers WHERE id = $1`,
          [customerId]
        );
        expect(row.rows[0]!.id_scan_hash).toBeTruthy();
        expect(row.rows[0]!.id_scan_value).toBeTruthy();
      })
    );

    it(
      'fuzzy-matches by exact DOB + similar name when exact token match fails, and enriches id_scan_hash/value',
      runIfDbAvailable(async () => {
        const customerResult = await query<{ id: string }>(
          `INSERT INTO customers (name, dob, created_at, updated_at)
           VALUES ($1, $2, NOW(), NOW())
           RETURNING id`,
          ['JOHN DOE', '1980-01-15']
        );
        const customerId = customerResult.rows[0]!.id;

        // Scanned first name slightly off so exact token match fails, but fuzzy should pass.
        const raw = '@\nDCSDOE\nDACJON\nDBD19800115\nDAQ555555555\nDCITX\n';
        const response = await app.inject({
          method: 'POST',
          url: '/v1/checkin/scan',
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { laneId, rawScanText: raw },
        });

        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.body);
        expect(data.result).toBe('MATCHED');
        expect(data.scanType).toBe('STATE_ID');
        expect(data.customer.id).toBe(customerId);
        expect(data.enriched).toBe(true);

        const row = await query<{ id_scan_hash: string | null; id_scan_value: string | null }>(
          `SELECT id_scan_hash, id_scan_value FROM customers WHERE id = $1`,
          [customerId]
        );
        expect(row.rows[0]!.id_scan_hash).toBeTruthy();
        expect(row.rows[0]!.id_scan_value).toBeTruthy();
      })
    );

    it(
      'returns MULTIPLE_MATCHES when more than one fuzzy candidate passes thresholds',
      runIfDbAvailable(async () => {
        const c1 = await query<{ id: string }>(
          `INSERT INTO customers (name, dob, created_at, updated_at)
           VALUES ($1, $2, NOW(), NOW())
           RETURNING id`,
          ['JOHN DOE', '1980-01-15']
        );
        const c2 = await query<{ id: string }>(
          `INSERT INTO customers (name, dob, created_at, updated_at)
           VALUES ($1, $2, NOW(), NOW())
           RETURNING id`,
          ['JONN DOE', '1980-01-15']
        );
        const id1 = c1.rows[0]!.id;
        const id2 = c2.rows[0]!.id;

        const raw = '@\nDCSDOE\nDACJON\nDBD19800115\nDAQ777777777\nDCITX\n';
        const response = await app.inject({
          method: 'POST',
          url: '/v1/checkin/scan',
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { laneId, rawScanText: raw },
        });

        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.body);
        expect(data.result).toBe('MULTIPLE_MATCHES');
        expect(data.scanType).toBe('STATE_ID');
        expect(Array.isArray(data.candidates)).toBe(true);
        expect(data.candidates.length).toBeGreaterThanOrEqual(2);
        const ids = data.candidates.map((c: { id: string }) => c.id);
        expect(ids).toContain(id1);
        expect(ids).toContain(id2);
        // Sorted by descending matchScore
        for (let i = 1; i < data.candidates.length; i++) {
          expect(data.candidates[i - 1].matchScore).toBeGreaterThanOrEqual(data.candidates[i].matchScore);
        }
      })
    );

    it(
      'resolves MULTIPLE_MATCHES by selectedCustomerId and enriches id_scan_hash/value',
      runIfDbAvailable(async () => {
        const c1 = await query<{ id: string }>(
          `INSERT INTO customers (name, dob, created_at, updated_at)
           VALUES ($1, $2, NOW(), NOW())
           RETURNING id`,
          ['JOHN DOE', '1980-01-15']
        );
        await query(
          `INSERT INTO customers (name, dob, created_at, updated_at)
           VALUES ($1, $2, NOW(), NOW())`,
          ['JONN DOE', '1980-01-15']
        );
        const selectedId = c1.rows[0]!.id;

        const raw = '@\nDCSDOE\nDACJON\nDBD19800115\nDAQ888888888\nDCITX\n';
        const initial = await app.inject({
          method: 'POST',
          url: '/v1/checkin/scan',
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { laneId, rawScanText: raw },
        });
        expect(initial.statusCode).toBe(200);
        const initialData = JSON.parse(initial.body);
        expect(initialData.result).toBe('MULTIPLE_MATCHES');

        const resolved = await app.inject({
          method: 'POST',
          url: '/v1/checkin/scan',
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { laneId, rawScanText: raw, selectedCustomerId: selectedId },
        });
        expect(resolved.statusCode).toBe(200);
        const resolvedData = JSON.parse(resolved.body);
        expect(resolvedData.result).toBe('MATCHED');
        expect(resolvedData.customer.id).toBe(selectedId);

        const row = await query<{ id_scan_hash: string | null; id_scan_value: string | null }>(
          `SELECT id_scan_hash, id_scan_value FROM customers WHERE id = $1`,
          [selectedId]
        );
        expect(row.rows[0]!.id_scan_hash).toBeTruthy();
        expect(row.rows[0]!.id_scan_value).toBeTruthy();
      })
    );

    it(
      'rejects selectedCustomerId resolution when DOB does not match extracted scan (INVALID_SELECTION)',
      runIfDbAvailable(async () => {
        const customerResult = await query<{ id: string }>(
          `INSERT INTO customers (name, dob, created_at, updated_at)
           VALUES ($1, $2, NOW(), NOW())
           RETURNING id`,
          ['JOHN DOE', '1980-01-16']
        );
        const customerId = customerResult.rows[0]!.id;

        const raw = '@\nDCSDOE\nDACJON\nDBD19800115\nDAQ999999999\nDCITX\n';
        const response = await app.inject({
          method: 'POST',
          url: '/v1/checkin/scan',
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { laneId, rawScanText: raw, selectedCustomerId: customerId },
        });

        expect(response.statusCode).toBe(400);
        const data = JSON.parse(response.body);
        expect(data.result).toBe('ERROR');
        expect(data.error.code).toBe('INVALID_SELECTION');
      })
    );

    it(
      'matches non-ID scans as membership/general barcode',
      runIfDbAvailable(async () => {
        const customerResult = await query<{ id: string }>(
          `INSERT INTO customers (name, membership_number, created_at, updated_at)
         VALUES ($1, $2, NOW(), NOW())
         RETURNING id`,
          ['Member One', '700001']
        );
        const customerId = customerResult.rows[0]!.id;

        const response = await app.inject({
          method: 'POST',
          url: '/v1/checkin/scan',
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { laneId, rawScanText: '700001' },
        });

        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.body);
        expect(data.result).toBe('MATCHED');
        expect(data.scanType).toBe('MEMBERSHIP');
        expect(data.customer.id).toBe(customerId);
      })
    );

    it(
      'returns NO_MATCH with extracted identity for unknown ID scans',
      runIfDbAvailable(async () => {
        const raw = '@\nDCSDOE\nDACJANE\nDBD19920102\nDAQ000000000\nDCITX\n';
        const response = await app.inject({
          method: 'POST',
          url: '/v1/checkin/scan',
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { laneId, rawScanText: raw },
        });

        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.body);
        expect(data.result).toBe('NO_MATCH');
        expect(data.scanType).toBe('STATE_ID');
        expect(data.extracted).toBeDefined();
        expect(data.extracted.firstName).toBe('JANE');
        expect(data.extracted.lastName).toBe('DOE');
        expect(data.extracted.dob).toBe('1992-01-02');
      })
    );

    it(
      'extracts identity fields from concatenated AAMVA payloads (field boundary parsing regression)',
      runIfDbAvailable(async () => {
        const raw =
          '@\nANSI 636015090002DL00410289DLDCACDCBNONEDCDNONEDBA01012030DCSDOEDDENDACJOHNDDFNDBB07151988DAQ123456789DAJTX\n';
        const response = await app.inject({
          method: 'POST',
          url: '/v1/checkin/scan',
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { laneId, rawScanText: raw },
        });

        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.body);
        expect(data.result).toBe('NO_MATCH');
        expect(data.scanType).toBe('STATE_ID');
        expect(data.extracted).toBeDefined();
        expect(data.extracted.firstName).toBe('JOHN');
        expect(data.extracted.lastName).toBe('DOE');
        expect(data.extracted.dob).toBe('1988-07-15');
        expect(data.extracted.idNumber).toBe('123456789');
        expect(data.extracted.jurisdiction).toBe('TX');
      })
    );

    it(
      'rejects scan when matched customer is banned',
      runIfDbAvailable(async () => {
        const raw = '@\nDCSDOE\nDACBANNED\nDBD19800115\nDAQBAN123\nDCITX\n';
        const normalized = raw
          .replace(/\r\n/g, '\n')
          .replace(/\r/g, '\n')
          .split('\n')
          .map((l) => l.replace(/[ \t]+/g, ' ').trimEnd())
          .join('\n')
          .trim();
        const customerResult = await query<{ id: string }>(
          `INSERT INTO customers (name, dob, id_scan_value, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         RETURNING id`,
          ['BANNED DOE', '1980-01-15', normalized]
        );
        const customerId = customerResult.rows[0]!.id;
        const banUntil = new Date();
        banUntil.setDate(banUntil.getDate() + 1);
        await query(`UPDATE customers SET banned_until = $1 WHERE id = $2`, [banUntil, customerId]);

        const response = await app.inject({
          method: 'POST',
          url: '/v1/checkin/scan',
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { laneId, rawScanText: raw },
        });

        expect(response.statusCode).toBe(403);
        const data = JSON.parse(response.body);
        expect(data.result).toBe('ERROR');
        expect(data.error.code).toBe('BANNED');
      })
    );

    it(
      'create-from-scan creates a customer and subsequent scan matches instantly',
      runIfDbAvailable(async () => {
        const raw = '@\nDCSDOE\nDACNEW\nDBD19920102\nDAQNEW999\nDCITX\n';

        // First lookup yields NO_MATCH
        const lookup = await app.inject({
          method: 'POST',
          url: '/v1/checkin/scan',
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { laneId, rawScanText: raw },
        });
        expect(lookup.statusCode).toBe(200);
        const lookupData = JSON.parse(lookup.body);
        expect(lookupData.result).toBe('NO_MATCH');
        expect(lookupData.scanType).toBe('STATE_ID');
        expect(lookupData.extracted.firstName).toBe('NEW');
        expect(lookupData.extracted.lastName).toBe('DOE');
        expect(lookupData.extracted.dob).toBe('1992-01-02');

        // Create customer from extracted payload
        const create = await app.inject({
          method: 'POST',
          url: '/v1/customers/create-from-scan',
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: {
            idScanValue: lookupData.normalizedRawScanText,
            idScanHash: lookupData.idScanHash,
            firstName: lookupData.extracted.firstName,
            lastName: lookupData.extracted.lastName,
            dob: lookupData.extracted.dob,
            fullName: lookupData.extracted.fullName,
          },
        });
        expect(create.statusCode).toBe(200);
        const createData = JSON.parse(create.body);
        expect(createData.customer?.id).toBeTruthy();

        // Verify stored identifiers
        const row = await query<{ id_scan_hash: string | null; id_scan_value: string | null }>(
          `SELECT id_scan_hash, id_scan_value FROM customers WHERE id = $1`,
          [createData.customer.id]
        );
        expect(row.rows[0]!.id_scan_hash).toBeTruthy();
        expect(row.rows[0]!.id_scan_value).toBeTruthy();

        // Re-scan should match
        const lookup2 = await app.inject({
          method: 'POST',
          url: '/v1/checkin/scan',
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { laneId, rawScanText: raw },
        });
        expect(lookup2.statusCode).toBe(200);
        const lookup2Data = JSON.parse(lookup2.body);
        expect(lookup2Data.result).toBe('MATCHED');
        expect(lookup2Data.customer.id).toBe(createData.customer.id);
      })
    );
  });

  describe('POST /v1/checkin/lane/:laneId/sign-agreement', () => {
    it(
      'should require INITIAL or RENEWAL mode for agreement signing',
      runIfDbAvailable(async () => {
        // Start a lane session in INITIAL mode
        const startResponse = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/start`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: {
            idScanValue: 'ID123456',
            membershipScanValue: '12345',
            checkinMode: 'INITIAL',
          },
        });
        expect(startResponse.statusCode).toBe(200);
        const session = JSON.parse(startResponse.body);

        // Sign agreement should work for INITIAL
        const signResponse = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/sign-agreement`,
          headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
          payload: {
            signaturePayload: 'data:image/png;base64,test',
            sessionId: session.sessionId,
          },
        });
        // Should succeed (or fail on payment requirement, but not on mode)
        expect([200, 400, 404]).toContain(signResponse.statusCode);
      })
    );

    it(
      'should store signature, create checkin_block, and assign inventory ONLY after signing',
      runIfDbAvailable(async () => {
        // Setup: create session, lock selection, create payment intent, demo-take-payment, then sign agreement
        const roomResult = await query<{ id: string }>(
          `INSERT INTO rooms (number, type, status, floor)
         VALUES ('200', 'STANDARD', 'CLEAN', 2)
         RETURNING id`
        );
        const roomId = roomResult.rows[0]!.id;

        // Sanity: room 200 is available before check-in completion
        const beforeAvail = await app.inject({ method: 'GET', url: '/v1/inventory/available' });
        expect(beforeAvail.statusCode).toBe(200);
        const beforeAvailBody = JSON.parse(beforeAvail.body);
        expect(beforeAvailBody.rawRooms?.STANDARD).toBe(1);

        const startResponse = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/start`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: {
            idScanValue: 'ID123456',
            membershipScanValue: '12345',
          },
        });
        const startData = JSON.parse(startResponse.body);

        // Lock selection
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/propose-selection`,
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { rentalType: 'STANDARD', proposedBy: 'EMPLOYEE' },
        });
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/confirm-selection`,
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { confirmedBy: 'EMPLOYEE' },
        });

        // Preselect a specific room on the session (actual inventory assignment happens later)
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/assign`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: {
            resourceType: 'room',
            resourceId: roomId,
          },
        });

        // Verify not assigned yet
        const roomPreCheck = await query<{
          status: string;
          assigned_to_customer_id: string | null;
        }>(`SELECT status, assigned_to_customer_id FROM rooms WHERE id = $1`, [roomId]);
        expect(roomPreCheck.rows[0]!.status).toBe('CLEAN');
        expect(roomPreCheck.rows[0]!.assigned_to_customer_id).toBeNull();

        const intentResponse = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/create-payment-intent`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
        });
        const intentData = JSON.parse(intentResponse.body);

        // Demo payment success -> sets payment PAID + session AWAITING_SIGNATURE
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/demo-take-payment`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: { outcome: 'CASH_SUCCESS' },
        });

        // Sign agreement
        const response = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/sign-agreement`,
          headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
          payload: {
            signaturePayload:
              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
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

        const blockResult = await query<{
          id: string;
          session_id: string | null;
          agreement_signed: boolean;
        }>(
          `SELECT id, session_id, agreement_signed
         FROM checkin_blocks
         WHERE visit_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
          [visitResult.rows[0]!.id]
        );
        expect(blockResult.rows[0]!.session_id).toBe(startData.sessionId);
        expect(blockResult.rows[0]!.agreement_signed).toBe(true);

        // Agreement completion sync: ensure the server broadcast SESSION_UPDATED includes agreementSigned=true
        const matchingEvents = sessionUpdatedEvents.filter(
          (e) => e.payload.sessionId === startData.sessionId
        );
        expect(matchingEvents.length).toBeGreaterThan(0);
        const last = matchingEvents[matchingEvents.length - 1]!;
        expect(last.payload.agreementSigned).toBe(true);

        // Verify room status changed to OCCUPIED
        const roomStatusResult = await query<{ status: string }>(
          `SELECT status FROM rooms WHERE id = $1`,
          [roomId]
        );
        expect(roomStatusResult.rows[0]!.status).toBe('OCCUPIED');

        // Verify room is assigned to the customer
        const roomAssignedResult = await query<{ assigned_to_customer_id: string | null }>(
          `SELECT assigned_to_customer_id FROM rooms WHERE id = $1`,
          [roomId]
        );
        expect(roomAssignedResult.rows[0]!.assigned_to_customer_id).toBe(customerId);

        // Expected outcome: /v1/inventory/available must no longer count room 200 immediately after completion
        const afterAvail = await app.inject({ method: 'GET', url: '/v1/inventory/available' });
        expect(afterAvail.statusCode).toBe(200);
        const afterAvailBody = JSON.parse(afterAvail.body);
        expect(afterAvailBody.rawRooms?.STANDARD).toBe(0);

        // Document verification: employee/office can prove agreement PDF + signature artifacts exist
        const docsRes = await app.inject({
          method: 'GET',
          url: `/v1/documents/by-session/${startData.sessionId}`,
          headers: { Authorization: `Bearer ${staffToken}` },
        });
        expect(docsRes.statusCode).toBe(200);
        const docsBody = JSON.parse(docsRes.body) as { documents?: any[] };
        expect(Array.isArray(docsBody.documents)).toBe(true);
        expect(docsBody.documents!.length).toBeGreaterThan(0);
        expect(docsBody.documents![0]!.has_signature).toBe(true);
        expect(docsBody.documents![0]!.has_pdf).toBe(true);

        const downloadRes = await app.inject({
          method: 'GET',
          url: `/v1/documents/${docsBody.documents![0]!.id}/download`,
          headers: { Authorization: `Bearer ${staffToken}` },
        });
        expect(downloadRes.statusCode).toBe(200);
        expect(downloadRes.headers['content-type']).toContain('application/pdf');
        expect(downloadRes.body.length).toBeGreaterThan(100);
      })
    );

    it(
      'should not assign rooms reserved to satisfy ACTIVE upgrade waitlist demand (new check-in fails when demand consumes supply)',
      runIfDbAvailable(async () => {
        // Supply: 2 CLEAN STANDARD rooms
        await query(
          `INSERT INTO rooms (number, type, status, floor)
           VALUES ('200', 'STANDARD', 'CLEAN', 1), ('202', 'STANDARD', 'CLEAN', 1)`
        );

        // Demand: 2 ACTIVE STANDARD waitlist entries on an active visit + active block
        const wlCustomer = await query<{ id: string }>(
          `INSERT INTO customers (name) VALUES ('Waitlist Demand Customer') RETURNING id`
        );
        const wlVisit = await query<{ id: string }>(
          `INSERT INTO visits (customer_id, started_at) VALUES ($1, NOW() - INTERVAL '1 hour') RETURNING id`,
          [wlCustomer.rows[0]!.id]
        );
        const wlBlock = await query<{ id: string }>(
          `INSERT INTO checkin_blocks (visit_id, block_type, starts_at, ends_at, rental_type)
           VALUES ($1, 'INITIAL', NOW() - INTERVAL '1 hour', NOW() + INTERVAL '2 hours', 'STANDARD')
           RETURNING id`,
          [wlVisit.rows[0]!.id]
        );
        await query(
          `INSERT INTO waitlist (visit_id, checkin_block_id, desired_tier, backup_tier, status)
           VALUES
             ($1, $2, 'STANDARD', 'STANDARD', 'ACTIVE'),
             ($1, $2, 'STANDARD', 'STANDARD', 'ACTIVE')`,
          [wlVisit.rows[0]!.id, wlBlock.rows[0]!.id]
        );

        // Create session, lock selection, create payment intent, demo-take-payment, then sign agreement (no preselected room)
        const startResponse = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/start`,
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { idScanValue: 'ID123456', membershipScanValue: '12345' },
        });
        expect(startResponse.statusCode).toBe(200);
        const startData = JSON.parse(startResponse.body);

        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/propose-selection`,
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { rentalType: 'STANDARD', proposedBy: 'EMPLOYEE' },
        });
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/confirm-selection`,
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { confirmedBy: 'EMPLOYEE' },
        });
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/create-payment-intent`,
          headers: { Authorization: `Bearer ${staffToken}` },
        });
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/demo-take-payment`,
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { outcome: 'CASH_SUCCESS' },
        });

        const response = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/sign-agreement`,
          headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
          payload: {
            signaturePayload:
              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            sessionId: startData.sessionId,
          },
        });

        expect(response.statusCode).toBe(409);
        expect(JSON.parse(response.body).error).toMatch(/No available rooms/i);
      })
    );

    it(
      'should not assign a room that is reserved by an OFFERED waitlist (explicit room_id reservation)',
      runIfDbAvailable(async () => {
        // Supply: 2 CLEAN STANDARD rooms
        const r1 = await query<{ id: string; number: string }>(
          `INSERT INTO rooms (number, type, status, floor)
           VALUES ('200', 'STANDARD', 'CLEAN', 1)
           RETURNING id, number`
        );
        const offeredRoomId = r1.rows[0]!.id;
        await query(
          `INSERT INTO rooms (number, type, status, floor)
           VALUES ('202', 'STANDARD', 'CLEAN', 1)`
        );

        // OFFERED waitlist entry reserves room 101 (valid active visit + active block)
        const wlCustomer = await query<{ id: string }>(
          `INSERT INTO customers (name) VALUES ('Waitlist Offered Customer') RETURNING id`
        );
        const wlVisit = await query<{ id: string }>(
          `INSERT INTO visits (customer_id, started_at) VALUES ($1, NOW() - INTERVAL '1 hour') RETURNING id`,
          [wlCustomer.rows[0]!.id]
        );
        const wlBlock = await query<{ id: string }>(
          `INSERT INTO checkin_blocks (visit_id, block_type, starts_at, ends_at, rental_type)
           VALUES ($1, 'INITIAL', NOW() - INTERVAL '1 hour', NOW() + INTERVAL '2 hours', 'STANDARD')
           RETURNING id`,
          [wlVisit.rows[0]!.id]
        );
        await query(
          `INSERT INTO waitlist (visit_id, checkin_block_id, desired_tier, backup_tier, status, offered_at, room_id)
           VALUES ($1, $2, 'STANDARD', 'STANDARD', 'OFFERED', NOW(), $3)`,
          [wlVisit.rows[0]!.id, wlBlock.rows[0]!.id, offeredRoomId]
        );

        // New check-in should skip offered room 101 and assign room 102
        const startResponse = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/start`,
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { idScanValue: 'ID123456', membershipScanValue: '12345' },
        });
        expect(startResponse.statusCode).toBe(200);
        const startData = JSON.parse(startResponse.body);

        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/propose-selection`,
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { rentalType: 'STANDARD', proposedBy: 'EMPLOYEE' },
        });
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/confirm-selection`,
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { confirmedBy: 'EMPLOYEE' },
        });
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/create-payment-intent`,
          headers: { Authorization: `Bearer ${staffToken}` },
        });
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/demo-take-payment`,
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { outcome: 'CASH_SUCCESS' },
        });

        const response = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/sign-agreement`,
          headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
          payload: {
            signaturePayload:
              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            sessionId: startData.sessionId,
          },
        });
        expect(response.statusCode).toBe(200);

        const assignedRoom = await query<{ number: string }>(
          `SELECT number
           FROM rooms
           WHERE assigned_to_customer_id = $1 AND status = 'OCCUPIED'
           ORDER BY number ASC
           LIMIT 1`,
          [customerId]
        );
        expect(assignedRoom.rows[0]!.number).toBe('202');

        const offeredRoom = await query<{ status: string; assigned_to_customer_id: string | null }>(
          `SELECT status, assigned_to_customer_id FROM rooms WHERE id = $1`,
          [offeredRoomId]
        );
        expect(offeredRoom.rows[0]!.status).toBe('CLEAN');
        expect(offeredRoom.rows[0]!.assigned_to_customer_id).toBeNull();
      })
    );

    it(
      'archives system late-fee notes after they are shown on the next visit (manual notes persist)',
      runIfDbAvailable(async () => {
        // Seed customer notes: one manual note + one system late-fee note
        const manual = `[2026-01-01T00:00:00.000Z] Staff: Manual note should persist`;
        const system = `[SYSTEM_LATE_FEE_PENDING] Late fee ($35.00): customer was 1h 0m late on last visit on 2026-01-12.`;
        await query(`UPDATE customers SET notes = $1, past_due_balance = 35 WHERE id = $2`, [
          `${manual}\n${system}`,
          customerId,
        ]);

        // Setup room for assignment
        const roomResult = await query<{ id: string }>(
          `INSERT INTO rooms (number, type, status, floor)
           VALUES ('201', 'STANDARD', 'CLEAN', 2)
           RETURNING id`
        );
        const roomId = roomResult.rows[0]!.id;

        // Start lane session
        const startResponse = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/start`,
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { idScanValue: 'ID123456', membershipScanValue: '12345' },
        });
        expect(startResponse.statusCode).toBe(200);
        const startData = JSON.parse(startResponse.body);

        // Ensure the note is visible on this next visit (via broadcasted SESSION_UPDATED payload)
        const startEvents = sessionUpdatedEvents.filter((e) => e.lane === laneId);
        expect(startEvents.length).toBeGreaterThan(0);
        const last = startEvents[startEvents.length - 1]!;
        expect(String(last.payload.customerNotes || '')).toContain('[SYSTEM_LATE_FEE_PENDING]');
        expect(String(last.payload.customerNotes || '')).toContain('Manual note should persist');

        // Complete flow through sign-agreement (successful check-in) which should auto-archive system note
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/propose-selection`,
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { rentalType: 'STANDARD', proposedBy: 'EMPLOYEE' },
        });
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/confirm-selection`,
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { confirmedBy: 'EMPLOYEE' },
        });
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/assign`,
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { resourceType: 'room', resourceId: roomId },
        });
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/create-payment-intent`,
          headers: { Authorization: `Bearer ${staffToken}` },
        });
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/demo-take-payment`,
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { outcome: 'CASH_SUCCESS' },
        });

        const sign = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/sign-agreement`,
          headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
          payload: {
            signaturePayload:
              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            sessionId: startData.sessionId,
          },
        });
        expect(sign.statusCode).toBe(200);

        const notesAfter = await query<{ notes: string | null }>(
          `SELECT notes FROM customers WHERE id = $1`,
          [customerId]
        );
        const finalNotes = String(notesAfter.rows[0]!.notes || '');
        expect(finalNotes).toContain('Manual note should persist');
        expect(finalNotes).not.toContain('[SYSTEM_LATE_FEE_PENDING]');
      })
    );
  });
});
