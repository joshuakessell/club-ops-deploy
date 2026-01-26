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
      // initializeDatabase() creates the pool before attempting to connect; ensure we don't leak it.
      try {
        await closeDatabase();
      } catch {
        // ignore
      }
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
    const originalBroadcastCustomerConfirmed =
      broadcaster.broadcastCustomerConfirmed.bind(broadcaster);
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
    await query(`DELETE FROM visits WHERE customer_id = $1`, [customerId]);
    await query(`DELETE FROM lane_sessions WHERE lane_id = $1 OR lane_id = 'LANE_2'`, [laneId]);
    await query(`DELETE FROM payment_intents`);
    await query(`DELETE FROM staff_sessions WHERE staff_id = $1`, [staffId]);
    await query(`DELETE FROM customers WHERE id = $1 OR membership_number = '12345'`, [customerId]);
    await query(`DELETE FROM staff WHERE id = $1`, [staffId]);
    await query(`DELETE FROM rooms WHERE number IN ('200', '202', '203', '204')`);
  });

  afterAll(async () => {
    try {
      if (app) await app.close();
    } finally {
      await closeDatabase();
    }
  });

  // Helper to skip tests when DB is unavailable
  const runIfDbAvailable = (testFn: () => Promise<void>) => async () => {
    if (!dbAvailable) {
      console.log('    ↳ Skipped (database not available)');
      return;
    }
    await testFn();
  };

  describe('POST /v1/checkin/lane/:laneId/membership-purchase-intent', () => {
    it(
      'should allow intent=NONE to clear a prior 6-month intent (stored as NULL) and recompute the DUE quote',
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
        const clearedItems: Array<{ description: string; amount: number }> =
          clearedQuote.lineItems ?? [];
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


});
