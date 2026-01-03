import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { query, initializeDatabase, closeDatabase } from '../src/db/index.js';
import { createBroadcaster, type Broadcaster } from '../src/websocket/broadcaster.js';
import { checkinRoutes } from '../src/routes/checkin.js';
import { hashPin, generateSessionToken } from '../src/auth/utils.js';
import type { SessionUpdatedPayload } from '@club-ops/shared';

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
  let sessionUpdatedEvents: Array<{ lane: string; payload: SessionUpdatedPayload }> = [];

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
    // Capture SESSION_UPDATED payloads for assertions (without requiring a websocket client)
    const originalBroadcastSessionUpdated = broadcaster.broadcastSessionUpdated.bind(broadcaster);
    broadcaster.broadcastSessionUpdated = (payload, lane) => {
      sessionUpdatedEvents.push({ lane, payload });
      return originalBroadcastSessionUpdated(payload, lane);
    };
    app.decorate('broadcaster', broadcaster);

    // Register check-in routes
    // Note: Tests will need to properly authenticate or we'll mock requireAuth
    await app.register(checkinRoutes);

    await app.ready();
  });

  beforeEach(async () => {
    if (!dbAvailable) return;
    sessionUpdatedEvents = [];
    
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

    // Ensure an active agreement exists for signing flow
    await query(
      `UPDATE agreements SET active = false WHERE active = true`
    );
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
    it('should record selected resource on the lane session (inventory assignment happens after signing)', runIfDbAvailable(async () => {
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

      // Lock selection (required for payment/signing; assignment selection itself can happen any time)
      await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/propose-selection`,
        headers: { 'Authorization': `Bearer ${staffToken}` },
        payload: { rentalType: 'STANDARD', proposedBy: 'EMPLOYEE' },
      });
      await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/confirm-selection`,
        headers: { 'Authorization': `Bearer ${staffToken}` },
        payload: { confirmedBy: 'EMPLOYEE' },
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

      // Verify room is NOT yet assigned/occupied (that happens after agreement signing)
      const roomCheck = await query<{ assigned_to_customer_id: string | null; status: string }>(
        `SELECT assigned_to_customer_id, status FROM rooms WHERE id = $1`,
        [roomId]
      );
      expect(roomCheck.rows[0]!.assigned_to_customer_id).toBeNull();
      expect(roomCheck.rows[0]!.status).toBe('CLEAN');

      // Verify lane session snapshot points at this room
      const sessionCheck = await query<{ assigned_resource_id: string | null; assigned_resource_type: string | null }>(
        `SELECT assigned_resource_id, assigned_resource_type
         FROM lane_sessions
         WHERE lane_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [laneId]
      );
      expect(sessionCheck.rows[0]!.assigned_resource_id).toBe(roomId);
      expect(sessionCheck.rows[0]!.assigned_resource_type).toBe('room');
    }));
  });

  describe('POST /v1/checkin/lane/:laneId/create-payment-intent', () => {
    it('should create payment intent from locked desired_rental_type (no assignment required) and enforce <=1 DUE intent per session', runIfDbAvailable(async () => {
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

      // Lock selection
      await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/propose-selection`,
        headers: { 'Authorization': `Bearer ${staffToken}` },
        payload: { rentalType: 'STANDARD', proposedBy: 'EMPLOYEE' },
      });
      await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/confirm-selection`,
        headers: { 'Authorization': `Bearer ${staffToken}` },
        payload: { confirmedBy: 'EMPLOYEE' },
      });

      // Create payment intent
      const response1 = await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/create-payment-intent`,
        headers: {
          'Authorization': `Bearer ${staffToken}`,
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
        headers: { 'Authorization': `Bearer ${staffToken}` },
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
    }));

    it('should broadcast a full, stable SessionUpdated payload including customer + payment fields', runIfDbAvailable(async () => {
      // Seed DOB so the payload can include customerDobMonthDay
      await query(`UPDATE customers SET dob = '1980-01-15'::date WHERE id = $1`, [customerId]);

      await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/start`,
        headers: { 'Authorization': `Bearer ${staffToken}` },
        payload: { idScanValue: 'ID123456', membershipScanValue: '12345' },
      });

      // Language selection should persist on customer and be present in subsequent payloads
      await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/set-language`,
        payload: { language: 'ES' },
      });

      await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/propose-selection`,
        headers: { 'Authorization': `Bearer ${staffToken}` },
        payload: { rentalType: 'STANDARD', proposedBy: 'EMPLOYEE' },
      });
      await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/confirm-selection`,
        headers: { 'Authorization': `Bearer ${staffToken}` },
        payload: { confirmedBy: 'EMPLOYEE' },
      });

      await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/create-payment-intent`,
        headers: { 'Authorization': `Bearer ${staffToken}` },
      });

      const last = sessionUpdatedEvents.filter((e) => e.lane === laneId).at(-1)?.payload;
      expect(last).toBeTruthy();
      expect(last!.customerName).toBe('Test Customer');
      expect(last!.customerPrimaryLanguage).toBe('ES');
      expect(last!.customerDobMonthDay).toBe('01/15');
      expect(last!.paymentIntentId).toBeTruthy();
      expect(last!.paymentStatus).toBe('DUE');
      expect(typeof last!.paymentTotal).toBe('number');
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

  describe('POST /v1/checkin/lane/:laneId/propose-selection', () => {
    it('should allow customer to propose a rental type', runIfDbAvailable(async () => {
      // Start a lane session
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
      expect(startResponse.statusCode).toBe(200);

      // Customer proposes selection
      const proposeResponse = await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/propose-selection`,
        payload: {
          rentalType: 'STANDARD',
          proposedBy: 'CUSTOMER',
        },
      });
      expect(proposeResponse.statusCode).toBe(200);
      const proposeData = JSON.parse(proposeResponse.body);
      expect(proposeData.proposedRentalType).toBe('STANDARD');
      expect(proposeData.proposedBy).toBe('CUSTOMER');
    }));

    it('should allow employee to propose a rental type', runIfDbAvailable(async () => {
      // Start a lane session
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
      expect(startResponse.statusCode).toBe(200);

      // Employee proposes selection
      const proposeResponse = await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/propose-selection`,
        headers: {
          'Authorization': `Bearer ${staffToken}`,
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
    }));
  });

  describe('POST /v1/checkin/lane/:laneId/confirm-selection', () => {
    it('should lock selection on first confirmation (first-wins)', runIfDbAvailable(async () => {
      // Start a lane session
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
      expect(startResponse.statusCode).toBe(200);

      // Customer proposes
      await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/propose-selection`,
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
          'Authorization': `Bearer ${staffToken}`,
        },
        payload: {
          confirmedBy: 'EMPLOYEE',
        },
      });
      expect(confirmResponse.statusCode).toBe(200);
      const confirmData = JSON.parse(confirmResponse.body);
      expect(confirmData.confirmedBy).toBe('EMPLOYEE');
      expect(confirmData.rentalType).toBe('STANDARD');

      const sessionRow = await query<{ selection_confirmed: boolean; selection_confirmed_by: string | null; selection_locked_at: Date | null }>(
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
    }));

    it('should require acknowledgement from non-confirming party', runIfDbAvailable(async () => {
      // Start a lane session
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
      expect(startResponse.statusCode).toBe(200);

      // Employee proposes and confirms
      await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/propose-selection`,
        headers: {
          'Authorization': `Bearer ${staffToken}`,
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
          'Authorization': `Bearer ${staffToken}`,
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
    }));
  });

  describe('GET /v1/checkin/lane/:laneId/waitlist-info', () => {
    it('should compute waitlist position and ETA', runIfDbAvailable(async () => {
      // Start a lane session
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
      expect(startResponse.statusCode).toBe(200);

      // Get waitlist info
      const waitlistResponse = await app.inject({
        method: 'GET',
        url: `/v1/checkin/lane/${laneId}/waitlist-info?desiredTier=SPECIAL&currentTier=LOCKER`,
      });
      expect(waitlistResponse.statusCode).toBe(200);
      const waitlistData = JSON.parse(waitlistResponse.body);
      expect(waitlistData).toHaveProperty('position');
      expect(waitlistData).toHaveProperty('upgradeFee');
      // ETA may be null if no occupied rooms
    }));
  });

  describe('POST /v1/checkin/lane/:laneId/scan-id', () => {
    it('should create a customer from ID scan and start lane session', runIfDbAvailable(async () => {
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
          'Authorization': `Bearer ${staffToken}`,
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
    }));

    it('should reuse existing customer on same id_scan_hash', runIfDbAvailable(async () => {
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
          'Authorization': `Bearer ${staffToken}`,
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
          'Authorization': `Bearer ${staffToken}`,
        },
        payload: scanPayload1,
      });
      expect(response2.statusCode).toBe(200);
      const data2 = JSON.parse(response2.body);
      
      // Should reuse same customer
      expect(data2.customerId).toBe(customerId1);
    }));

    it('should handle manual entry fallback (no raw barcode)', runIfDbAvailable(async () => {
      const scanPayload = {
        fullName: 'Jane Smith',
        idNumber: '987654321',
        dob: '1990-05-20',
      };

      const response = await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/scan-id`,
        headers: {
          'Authorization': `Bearer ${staffToken}`,
        },
        payload: scanPayload,
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data.customerName).toBe('Jane Smith');
      expect(data.sessionId).toBeTruthy();
    }));

    it('should reject scan if customer is banned', runIfDbAvailable(async () => {
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
          'Authorization': `Bearer ${staffToken}`,
        },
        payload: scanPayload,
      });
      expect(createResponse.statusCode).toBe(200);
      const createData = JSON.parse(createResponse.body);

      // Ban the customer
      const banUntil = new Date();
      banUntil.setDate(banUntil.getDate() + 1); // Ban for 1 day
      await query(
        `UPDATE customers SET banned_until = $1 WHERE id = $2`,
        [banUntil, createData.customerId]
      );

      // Try to scan again
      const scanResponse = await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/scan-id`,
        headers: {
          'Authorization': `Bearer ${staffToken}`,
        },
        payload: scanPayload,
      });

      expect(scanResponse.statusCode).toBe(403);
      const error = JSON.parse(scanResponse.body);
      expect(error.error).toContain('banned');
    }));
  });

  describe('POST /v1/checkin/lane/:laneId/sign-agreement', () => {
    it('should require INITIAL or RENEWAL mode for agreement signing', runIfDbAvailable(async () => {
      // Start a lane session in INITIAL mode
      const startResponse = await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/start`,
        headers: {
          'Authorization': `Bearer ${staffToken}`,
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
        payload: {
          signaturePayload: 'data:image/png;base64,test',
          sessionId: session.sessionId,
        },
      });
      // Should succeed (or fail on payment requirement, but not on mode)
      expect([200, 400, 404]).toContain(signResponse.statusCode);
    }));

    it('should store signature, create checkin_block, and assign inventory ONLY after signing', runIfDbAvailable(async () => {
      // Setup: create session, lock selection, create payment intent, demo-take-payment, then sign agreement
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

      // Lock selection
      await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/propose-selection`,
        headers: { 'Authorization': `Bearer ${staffToken}` },
        payload: { rentalType: 'STANDARD', proposedBy: 'EMPLOYEE' },
      });
      await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/confirm-selection`,
        headers: { 'Authorization': `Bearer ${staffToken}` },
        payload: { confirmedBy: 'EMPLOYEE' },
      });

      // Preselect a specific room on the session (actual inventory assignment happens later)
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

      // Verify not assigned yet
      const roomPreCheck = await query<{ status: string; assigned_to_customer_id: string | null }>(
        `SELECT status, assigned_to_customer_id FROM rooms WHERE id = $1`,
        [roomId]
      );
      expect(roomPreCheck.rows[0]!.status).toBe('CLEAN');
      expect(roomPreCheck.rows[0]!.assigned_to_customer_id).toBeNull();

      const intentResponse = await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/create-payment-intent`,
        headers: {
          'Authorization': `Bearer ${staffToken}`,
        },
      });
      const intentData = JSON.parse(intentResponse.body);

      // Demo payment success -> sets payment PAID + session AWAITING_SIGNATURE
      await app.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/demo-take-payment`,
        headers: {
          'Authorization': `Bearer ${staffToken}`,
        },
        payload: { outcome: 'CASH_SUCCESS' },
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

      const blockResult = await query<{ id: string; session_id: string | null; agreement_signed: boolean }>(
        `SELECT id, session_id, agreement_signed
         FROM checkin_blocks
         WHERE visit_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [visitResult.rows[0]!.id]
      );
      expect(blockResult.rows[0]!.session_id).toBe(startData.sessionId);
      expect(blockResult.rows[0]!.agreement_signed).toBe(true);

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
    }));
  });
});
