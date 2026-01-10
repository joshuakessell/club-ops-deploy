import { query, transaction } from './index.js';
import { randomUUID } from 'crypto';
import { BlockType, LOCKER_NUMBERS, NONEXISTENT_ROOM_NUMBERS, ROOM_NUMBERS, ROOMS } from '@club-ops/shared';
import { RentalType, RoomStatus, RoomType, getRoomKind } from '@club-ops/shared';
import { pathToFileURL } from 'url';

/**
 * Demo mode seeding for shifts and timeclock sessions.
 * Seeds shifts for past 14 days and next 14 days (28-day window).
 * Only runs when DEMO_MODE=true and demo data is not already present.
 */
export async function seedDemoData(): Promise<void> {
  if (process.env.DEMO_MODE !== 'true') {
    return;
  }

  try {
    const now = new Date();

    // -----------------------------------------------------------------------
    // Busy Saturday Night demo seeding (stress-test-friendly dataset)
    // -----------------------------------------------------------------------
    {
      console.log('🌱 Seeding busy Saturday demo dataset (resetting member/customer data)...');

      // Keep employees unchanged
      const staffCountBefore = await query<{ count: string }>('SELECT COUNT(*)::text as count FROM staff');

      // Reference timestamps:
      // - now: actual seed run time
      // - peak: deterministic "busy Saturday night" moment within last 24 hours
      const peak = new Date(now.getTime() - 6 * 60 * 60 * 1000);

      // Deterministic PRNG so the dataset is stable across runs
      function seededRng(seed: number): () => number {
        // Mulberry32
        return () => {
          seed |= 0;
          seed = (seed + 0x6d2b79f5) | 0;
          let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      }

      const rng = seededRng(0x53415455); // 'SATU' (arbitrary fixed seed)

      function randInt(min: number, max: number): number {
        return Math.floor(rng() * (max - min + 1)) + min;
      }

      // Choose one STANDARD room to remain free at PEAK (not necessarily at NOW)
      const freeRoomNumber =
        ROOM_NUMBERS.find((n) => {
          try {
            return getRoomKind(n) === 'STANDARD';
          } catch {
            return false;
          }
        }) ?? 200;

      const occupiedRoomNumbers = ROOM_NUMBERS.filter((n) => n !== freeRoomNumber);
      const occupiedLockerNumbers = LOCKER_NUMBERS.slice(0, 88); // 88 occupied at PEAK, 20 free at PEAK

      const firstNames = [
        'James',
        'Michael',
        'Robert',
        'John',
        'David',
        'William',
        'Richard',
        'Joseph',
        'Thomas',
        'Charles',
        'Christopher',
        'Daniel',
        'Matthew',
        'Anthony',
        'Mark',
        'Steven',
        'Paul',
        'Andrew',
        'Joshua',
        'Kevin',
      ];
      const lastNames = [
        'Smith',
        'Johnson',
        'Williams',
        'Brown',
        'Jones',
        'Garcia',
        'Miller',
        'Davis',
        'Rodriguez',
        'Martinez',
        'Hernandez',
        'Lopez',
        'Gonzalez',
        'Wilson',
        'Anderson',
        'Thomas',
        'Taylor',
        'Moore',
        'Jackson',
        'Martin',
      ];

      const customerIds: string[] = [];

      await transaction(async (client) => {
        // -------------------------------------------------------------------
        // Inventory: enforce facility contract (permanent beyond demo)
        // -------------------------------------------------------------------
        // 1) Ensure non-existent rooms are not present
        const nonExistentRoomNumbers = NONEXISTENT_ROOM_NUMBERS.map(String);
        if (nonExistentRoomNumbers.length > 0) {
          await client.query(`DELETE FROM rooms WHERE number = ANY($1::text[])`, [nonExistentRoomNumbers]);
        }

        // 2) Remove any invalid legacy inventory rows not in the contract
        await client.query(`DELETE FROM rooms WHERE NOT (number = ANY($1::text[]))`, [
          ROOM_NUMBERS.map(String),
        ]);
        await client.query(`DELETE FROM lockers WHERE NOT (number = ANY($1::text[]))`, [LOCKER_NUMBERS]);

        // 3) Upsert rooms + lockers (idempotent)
        for (const r of ROOMS) {
          const type: RoomType =
            r.kind === 'DELUXE' ? RoomType.DOUBLE : r.kind === 'SPECIAL' ? RoomType.SPECIAL : RoomType.STANDARD;
          await client.query(
            `INSERT INTO rooms (number, type, status, floor, last_status_change)
             VALUES ($1, $2, 'CLEAN', $3, NOW())
             ON CONFLICT (number) DO UPDATE
               SET type = EXCLUDED.type,
                   floor = EXCLUDED.floor,
                   updated_at = NOW()`,
            [String(r.number), type, Math.floor(r.number / 100)]
          );
        }

        for (const n of LOCKER_NUMBERS) {
          await client.query(
            `INSERT INTO lockers (number, status)
             VALUES ($1, 'CLEAN')
             ON CONFLICT (number) DO UPDATE
               SET updated_at = NOW()`,
            [n]
          );
        }

        // 4) Upsert key tags (needed for QR scans in checkout kiosk)
        const roomIdsForTags = await client.query<{ id: string; number: string }>(
          `SELECT id, number FROM rooms ORDER BY number`
        );
        for (const row of roomIdsForTags.rows) {
          await client.query(
            `INSERT INTO key_tags (room_id, tag_type, tag_code, is_active)
             VALUES ($1, 'QR', $2, true)
             ON CONFLICT (tag_code) DO UPDATE
               SET room_id = EXCLUDED.room_id,
                   locker_id = NULL,
                   is_active = true,
                   updated_at = NOW()`,
            [row.id, `ROOM-${row.number}`]
          );
        }

        const lockerIdsForTags = await client.query<{ id: string; number: string }>(
          `SELECT id, number FROM lockers ORDER BY number`
        );
        for (const row of lockerIdsForTags.rows) {
          await client.query(
            `INSERT INTO key_tags (locker_id, tag_type, tag_code, is_active)
             VALUES ($1, 'QR', $2, true)
             ON CONFLICT (tag_code) DO UPDATE
               SET locker_id = EXCLUDED.locker_id,
                   room_id = NULL,
                   is_active = true,
                   updated_at = NOW()`,
            [row.id, `LOCKER-${row.number}`]
          );
        }

        // Reset assignments/statuses on inventory
        await client.query(
          `UPDATE rooms
           SET assigned_to_customer_id = NULL,
               status = 'CLEAN',
               last_status_change = NOW(),
               updated_at = NOW()`
        );
        await client.query(
          `UPDATE lockers
           SET assigned_to_customer_id = NULL,
               status = 'CLEAN',
               updated_at = NOW()`
        );

        // Wipe member/customer-related data (keep staff/employees)
        await client.query('DELETE FROM checkout_requests');
        await client.query('DELETE FROM late_checkout_events');
        await client.query('DELETE FROM waitlist');
        await client.query('DELETE FROM agreement_signatures');
        await client.query('DELETE FROM charges');
        await client.query('DELETE FROM checkin_blocks');
        await client.query('DELETE FROM sessions');
        await client.query('DELETE FROM payment_intents');
        await client.query('DELETE FROM lane_sessions');
        await client.query('DELETE FROM visits');
        await client.query('DELETE FROM customers');
        await client.query('DELETE FROM members');

        // Inventory maps (after any deletes)
        const roomsRes = await client.query<{ id: string; number: string; type: string }>(
          `SELECT id, number, type::text as type FROM rooms ORDER BY number`
        );
        const lockersRes = await client.query<{ id: string; number: string }>(
          `SELECT id, number FROM lockers ORDER BY number`
        );

        const roomIdByNumber = new Map<string, { id: string; type: string }>();
        for (const r of roomsRes.rows) roomIdByNumber.set(r.number, { id: r.id, type: r.type });
        const lockerIdByNumber = new Map<string, string>();
        for (const l of lockersRes.rows) lockerIdByNumber.set(l.number, l.id);

        // -------------------------------------------------------------------
        // Customers: seed 100 members + extra guests to satisfy PEAK overlap
        // -------------------------------------------------------------------
        const MEMBER_COUNT = 100;
        const EXTRA_GUEST_COUNT = 60; // gives total customers 160 (>= 142 needed at peak)

        // Create exactly 100 members (also mirrored into legacy members table)
        for (let i = 1; i <= 100; i++) {
          const idx = i - 1;
          const id = randomUUID();
          const membershipNumber = String(i).padStart(6, '0');
          const name = `${firstNames[idx % firstNames.length]} ${lastNames[(idx * 7) % lastNames.length]}`;
          const email = `member${membershipNumber}@demo.local`;
          const phone = `555${String(i).padStart(7, '0')}`; // 10-digit-ish, deterministic
          const dob = new Date(1980 + (idx % 25), (idx * 3) % 12, ((idx * 5) % 27) + 1);

          await client.query(
            `INSERT INTO customers
             (id, name, dob, membership_number, membership_card_type, membership_valid_until, primary_language, past_due_balance, created_at, updated_at)
             VALUES ($1, $2, $3, $4, NULL, NULL, 'EN', 0, NOW(), NOW())`,
            [id, name, dob, membershipNumber]
          );

          await client.query(
            `INSERT INTO members (id, membership_number, name, email, phone, dob, is_active, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, true, NOW(), NOW())`,
            [randomUUID(), membershipNumber, name, email, phone, dob]
          );

          customerIds.push(id);
        }

        // Extra guests (customers only; membership_number is NULL)
        for (let i = 1; i <= EXTRA_GUEST_COUNT; i++) {
          const idx = MEMBER_COUNT + (i - 1);
          const id = randomUUID();
          const name = `${firstNames[idx % firstNames.length]} ${lastNames[(idx * 7) % lastNames.length]}`;
          const dob = new Date(1985 + (idx % 20), (idx * 5) % 12, ((idx * 7) % 27) + 1);
          await client.query(
            `INSERT INTO customers
             (id, name, dob, membership_number, membership_card_type, membership_valid_until, primary_language, past_due_balance, created_at, updated_at)
             VALUES ($1, $2, $3, NULL, NULL, NULL, 'EN', 0, NOW(), NOW())`,
            [id, name, dob]
          );
          customerIds.push(id);
        }

        // -------------------------------------------------------------------
        // Peak occupancy (computed from checkin_blocks overlap with PEAK)
        // - Rooms: 54 occupied, 1 free (must be STANDARD)
        // - Lockers: 88 occupied, 20 free
        // Exclusive assignment must hold: each stay is room OR locker.
        // At NOW: exactly one active late stay remains (scheduled checkout = now - 15m).
        // -------------------------------------------------------------------

        const PEAK_ROOM_OCCUPANCY = 54;
        const PEAK_LOCKER_OCCUPANCY = 88;

        const roomCustomerIds = customerIds.slice(0, PEAK_ROOM_OCCUPANCY);
        const lockerCustomerIds = customerIds.slice(PEAK_ROOM_OCCUPANCY, PEAK_ROOM_OCCUPANCY + PEAK_LOCKER_OCCUPANCY);
        const extraCustomerIds = customerIds.slice(PEAK_ROOM_OCCUPANCY + PEAK_LOCKER_OCCUPANCY);

        const lateActiveCustomerId = lockerCustomerIds[lockerCustomerIds.length - 1]!;
        const lateScheduledCheckoutAt = new Date(now.getTime() - 15 * 60 * 1000);
        const lateCheckInAt = new Date(now.getTime() - (6 * 60 + 15) * 60 * 1000); // 6h15m ago => overlaps peak

        function rentalTypeForRoomNumber(roomNumber: number): RentalType {
          const kind = getRoomKind(roomNumber);
          return kind === 'SPECIAL'
            ? RentalType.SPECIAL
            : kind === 'DELUXE'
              ? RentalType.DOUBLE
              : RentalType.STANDARD;
        }

        async function createVisitStay(params: {
          customerId: string;
          checkInAt: Date;
          scheduledCheckoutAt: Date;
          checkedOutAt: Date | null; // null => active
          roomId: string | null;
          lockerId: string | null;
          rentalType: RentalType;
        }): Promise<{ visitId: string; sessionId: string }> {
          const visitId = randomUUID();
          await client.query(
            `INSERT INTO visits (id, started_at, ended_at, created_at, updated_at, customer_id)
             VALUES ($1, $2, $3, NOW(), NOW(), $4)`,
            [visitId, params.checkInAt, params.checkedOutAt, params.customerId]
          );

          const customerRow = await client.query<{ name: string; membership_number: string | null }>(
            `SELECT name, membership_number FROM customers WHERE id = $1`,
            [params.customerId]
          );
          const memberName = customerRow.rows[0]!.name;
          const membershipNumber = customerRow.rows[0]!.membership_number;

          const sessionId = randomUUID();
          await client.query(
            `INSERT INTO sessions
             (id, customer_id, member_name, membership_number, room_id, locker_id, check_in_time, checkout_at, check_out_time, expected_duration, status, lane, checkin_type, visit_id, agreement_signed, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 360, $10, 'DEMO', 'INITIAL', $11, false, NOW(), NOW())`,
            [
              sessionId,
              params.customerId,
              memberName,
              membershipNumber,
              params.roomId,
              params.lockerId,
              params.checkInAt,
              params.scheduledCheckoutAt,
              params.checkedOutAt,
              params.checkedOutAt ? 'COMPLETED' : 'ACTIVE',
              visitId,
            ]
          );

          const blockId = randomUUID();
          await client.query(
            `INSERT INTO checkin_blocks
             (id, visit_id, block_type, starts_at, ends_at, rental_type, room_id, locker_id, session_id, agreement_signed, agreement_signed_at, created_at, updated_at, has_tv_remote, waitlist_id)
             VALUES ($1, $2, 'INITIAL', $3, $4, $5, $6, $7, NULL, false, NULL, NOW(), NOW(), false, NULL)`,
            [blockId, visitId, params.checkInAt, params.scheduledCheckoutAt, params.rentalType, params.roomId, params.lockerId]
          );

          return { visitId, sessionId };
        }

        function makeCheckoutDeltaMinutes(isMajorityGood: boolean): number {
          return isMajorityGood ? randInt(0, 15) : randInt(16, 90);
        }

        // 1) Room stays overlapping PEAK (all completed by NOW)
        for (let i = 0; i < PEAK_ROOM_OCCUPANCY; i++) {
          const customerId = roomCustomerIds[i]!;
          const roomNumber = occupiedRoomNumbers[i]!;
          const roomMeta = roomIdByNumber.get(String(roomNumber));
          if (!roomMeta) throw new Error(`Missing room inventory row for ${roomNumber}`);

          const minutesBeforePeak = randInt(15, 5 * 60); // between 15m and 5h before peak
          const checkInAt = new Date(peak.getTime() - minutesBeforePeak * 60 * 1000);
          const scheduledCheckoutAt = new Date(checkInAt.getTime() + 6 * 60 * 60 * 1000);

          const isGood = rng() < 0.88; // target >= 85% overall
          const checkedOutAt = new Date(scheduledCheckoutAt.getTime() - makeCheckoutDeltaMinutes(isGood) * 60 * 1000);

          await createVisitStay({
            customerId,
            checkInAt,
            scheduledCheckoutAt,
            checkedOutAt,
            roomId: roomMeta.id,
            lockerId: null,
            rentalType: rentalTypeForRoomNumber(roomNumber),
          });
        }

        // 2) Locker stays overlapping PEAK (87 completed + 1 late ACTIVE at NOW)
        for (let i = 0; i < PEAK_LOCKER_OCCUPANCY; i++) {
          const customerId = lockerCustomerIds[i]!;
          const lockerNumber = occupiedLockerNumbers[i]!;
          const lockerId = lockerIdByNumber.get(lockerNumber);
          if (!lockerId) throw new Error(`Missing locker inventory row for ${lockerNumber}`);

          const isLateActive = customerId === lateActiveCustomerId;

          if (isLateActive) {
            await createVisitStay({
              customerId,
              checkInAt: lateCheckInAt,
              scheduledCheckoutAt: lateScheduledCheckoutAt,
              checkedOutAt: null,
              roomId: null,
              lockerId,
              rentalType: RentalType.LOCKER,
            });
          } else {
            const minutesBeforePeak = randInt(15, 5 * 60);
            const checkInAt = new Date(peak.getTime() - minutesBeforePeak * 60 * 1000);
            const scheduledCheckoutAt = new Date(checkInAt.getTime() + 6 * 60 * 60 * 1000);

            const isGood = rng() < 0.88;
            const checkedOutAt = new Date(scheduledCheckoutAt.getTime() - makeCheckoutDeltaMinutes(isGood) * 60 * 1000);

            await createVisitStay({
              customerId,
              checkInAt,
              scheduledCheckoutAt,
              checkedOutAt,
              roomId: null,
              lockerId,
              rentalType: RentalType.LOCKER,
            });
          }
        }

        // 3) Extra completed stays spread across the last 24h (do NOT overlap PEAK)
        // These help make "last 24h" reporting look more natural while preserving PEAK counts.
        for (let i = 0; i < extraCustomerIds.length; i++) {
          const customerId = extraCustomerIds[i]!;
          const isRoom = i % 2 === 0;
          const minutesAgo = randInt(12 * 60, 23 * 60); // 12h..23h ago
          const checkInAt = new Date(now.getTime() - minutesAgo * 60 * 1000);
          const scheduledCheckoutAt = new Date(checkInAt.getTime() + 6 * 60 * 60 * 1000);

          // Ensure these are fully before peak (no overlap)
          if (scheduledCheckoutAt.getTime() >= peak.getTime() - 60 * 1000) {
            // shift earlier by 6 hours if needed
            checkInAt.setTime(checkInAt.getTime() - 6 * 60 * 60 * 1000);
            scheduledCheckoutAt.setTime(checkInAt.getTime() + 6 * 60 * 60 * 1000);
          }

          const isGood = rng() < 0.88;
          const checkedOutAt = new Date(scheduledCheckoutAt.getTime() - makeCheckoutDeltaMinutes(isGood) * 60 * 1000);

          if (isRoom) {
            // Use freeRoomNumber for some historical stays (fine since it's free at PEAK)
            const roomNumber = freeRoomNumber;
            const roomMeta = roomIdByNumber.get(String(roomNumber));
            if (!roomMeta) throw new Error(`Missing room inventory row for ${roomNumber}`);
            await createVisitStay({
              customerId,
              checkInAt,
              scheduledCheckoutAt,
              checkedOutAt,
              roomId: roomMeta.id,
              lockerId: null,
              rentalType: rentalTypeForRoomNumber(roomNumber),
            });
          } else {
            const lockerNumber = LOCKER_NUMBERS[PEAK_LOCKER_OCCUPANCY + (i % (LOCKER_NUMBERS.length - PEAK_LOCKER_OCCUPANCY))]!;
            const lockerId = lockerIdByNumber.get(lockerNumber);
            if (!lockerId) throw new Error(`Missing locker inventory row for ${lockerNumber}`);
            await createVisitStay({
              customerId,
              checkInAt,
              scheduledCheckoutAt,
              checkedOutAt,
              roomId: null,
              lockerId,
              rentalType: RentalType.LOCKER,
            });
          }
        }

        // Inventory at NOW should reflect the single active late stay only.
        // Everything else is checked out (clean + unassigned).
        const lateLockerId = lockerIdByNumber.get(occupiedLockerNumbers[PEAK_LOCKER_OCCUPANCY - 1]!);
        if (!lateLockerId) throw new Error('Missing late locker id');

        await client.query(
          `UPDATE lockers
           SET status = $1,
               assigned_to_customer_id = $2,
               updated_at = NOW()
           WHERE id = $3`,
          [RoomStatus.OCCUPIED, lateActiveCustomerId, lateLockerId]
        );
      });

      // Post-seed assertions + concise summary (throw on failure)
      const staffCountAfter = await query<{ count: string }>('SELECT COUNT(*)::text as count FROM staff');
      if (staffCountBefore.rows[0]!.count !== staffCountAfter.rows[0]!.count) {
        throw new Error(
          `Staff count changed unexpectedly (${staffCountBefore.rows[0]!.count} -> ${staffCountAfter.rows[0]!.count})`
        );
      }

      const customerCount = await query<{ count: string }>('SELECT COUNT(*)::text as count FROM customers');
      const memberCount = await query<{ count: string }>('SELECT COUNT(*)::text as count FROM members');
      const roomCount = await query<{ count: string }>('SELECT COUNT(*)::text as count FROM rooms');
      const lockerCount = await query<{ count: string }>('SELECT COUNT(*)::text as count FROM lockers');

      const nonExistentRoomsPresent = await query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM rooms WHERE number = ANY($1::text[])`,
        [NONEXISTENT_ROOM_NUMBERS.map(String)]
      );

      // XOR violations (must be zero)
      const bothInSessions = await query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM sessions WHERE room_id IS NOT NULL AND locker_id IS NOT NULL`
      );
      const bothInBlocks = await query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM checkin_blocks WHERE room_id IS NOT NULL AND locker_id IS NOT NULL`
      );

      // Peak occupancy computed from time overlap (not from current inventory status)
      const peakRoomOcc = await query<{ count: string }>(
        `SELECT COUNT(DISTINCT room_id)::text as count
         FROM checkin_blocks
         WHERE room_id IS NOT NULL
           AND starts_at <= $1
           AND ends_at > $1`,
        [peak]
      );
      const peakLockerOcc = await query<{ count: string }>(
        `SELECT COUNT(DISTINCT locker_id)::text as count
         FROM checkin_blocks
         WHERE locker_id IS NOT NULL
           AND starts_at <= $1
           AND ends_at > $1`,
        [peak]
      );

      const freeRoomsAtPeak = await query<{ number: string; type: string }>(
        `SELECT r.number, r.type::text as type
         FROM rooms r
         WHERE r.id NOT IN (
           SELECT cb.room_id
           FROM checkin_blocks cb
           WHERE cb.room_id IS NOT NULL
             AND cb.starts_at <= $1
             AND cb.ends_at > $1
         )
         ORDER BY r.number`,
        [peak]
      );

      // NOW: exactly one active late stay remains
      const activeSessionsNow = await query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM sessions WHERE status = 'ACTIVE' AND check_out_time IS NULL`
      );
      const activeSessionRow = await query<{
        id: string;
        checkout_at: Date | null;
        room_id: string | null;
        locker_id: string | null;
        customer_id: string;
      }>(
        `SELECT id, checkout_at, room_id, locker_id, customer_id
         FROM sessions
         WHERE status = 'ACTIVE'
         ORDER BY created_at DESC
         LIMIT 2`
      );

      // Checkout quality: >= 85% of completed stays have (checkout_at - check_out_time) in [0, 15m]
      const checkoutQuality = await query<{ total: string; good: string }>(
        `SELECT
           COUNT(*)::text as total,
           COUNT(*) FILTER (
             WHERE EXTRACT(EPOCH FROM (checkout_at - check_out_time)) BETWEEN 0 AND (15 * 60)
           )::text as good
         FROM sessions
         WHERE status = 'COMPLETED'
           AND checkout_at IS NOT NULL
           AND check_out_time IS NOT NULL`
      );

      function asInt(row: { count: string }): number {
        return parseInt(row.count, 10);
      }

      if (asInt(memberCount.rows[0]!) !== 100) throw new Error(`Expected 100 members, got ${memberCount.rows[0]!.count}`);
      if (asInt(customerCount.rows[0]!) < 142)
        throw new Error(`Expected at least 142 customers to satisfy peak overlap, got ${customerCount.rows[0]!.count}`);
      if (asInt(roomCount.rows[0]!) !== 55) throw new Error(`Expected 55 rooms, got ${roomCount.rows[0]!.count}`);
      if (asInt(nonExistentRoomsPresent.rows[0]!) !== 0)
        throw new Error(`Non-existent rooms present in DB (${nonExistentRoomsPresent.rows[0]!.count})`);
      if (asInt(lockerCount.rows[0]!) !== 108) throw new Error(`Expected 108 lockers, got ${lockerCount.rows[0]!.count}`);
      if (asInt(bothInSessions.rows[0]!) !== 0)
        throw new Error(`Exclusive assignment violated in sessions (${bothInSessions.rows[0]!.count})`);
      if (asInt(bothInBlocks.rows[0]!) !== 0)
        throw new Error(`Exclusive assignment violated in checkin_blocks (${bothInBlocks.rows[0]!.count})`);

      if (asInt(peakRoomOcc.rows[0]!) !== 54) throw new Error(`Expected 54 occupied rooms at peak, got ${peakRoomOcc.rows[0]!.count}`);
      if (asInt(peakLockerOcc.rows[0]!) !== 88)
        throw new Error(`Expected 88 occupied lockers at peak, got ${peakLockerOcc.rows[0]!.count}`);

      if (freeRoomsAtPeak.rows.length !== 1)
        throw new Error(`Expected 1 free room at peak, got ${freeRoomsAtPeak.rows.length}`);
      if (freeRoomsAtPeak.rows[0]!.type !== 'STANDARD')
        throw new Error(
          `Expected the free room at peak to be STANDARD, got ${freeRoomsAtPeak.rows[0]!.number} (${freeRoomsAtPeak.rows[0]!.type})`
        );

      if (asInt(activeSessionsNow.rows[0]!) !== 1)
        throw new Error(`Expected exactly 1 active stay at now, got ${activeSessionsNow.rows[0]!.count}`);
      if (activeSessionRow.rows.length !== 1) throw new Error(`Expected 1 active session row, got ${activeSessionRow.rows.length}`);
      const active = activeSessionRow.rows[0]!;
      const expectedLateMs = now.getTime() - 15 * 60 * 1000;
      if (!active.checkout_at) throw new Error('Active late session missing checkout_at');
      if (Math.abs(new Date(active.checkout_at).getTime() - expectedLateMs) > 2_000) {
        throw new Error(
          `Active late session scheduled checkout mismatch: got ${new Date(active.checkout_at).toISOString()} expected ~${new Date(expectedLateMs).toISOString()}`
        );
      }
      if (active.room_id && active.locker_id) throw new Error('Active late session has both room and locker set');
      if (!active.room_id && !active.locker_id) throw new Error('Active late session must have either room or locker');

      const totalCompleted = parseInt(checkoutQuality.rows[0]!.total, 10);
      const goodCompleted = parseInt(checkoutQuality.rows[0]!.good, 10);
      const ratio = totalCompleted === 0 ? 0 : goodCompleted / totalCompleted;
      if (ratio < 0.85) {
        throw new Error(
          `Checkout timing quality too low: ${goodCompleted}/${totalCompleted} (${Math.round(ratio * 100)}%) within 0..15m`
        );
      }

      const assignmentType = active.room_id ? 'room' : 'locker';
      console.log(
        `✅ Busy Saturday seed complete (peak=${peak.toISOString()}, now=${now.toISOString()}): members=100, customers=${customerCount.rows[0]!.count}, stays=${totalCompleted + 1}, peak rooms=54 (free STANDARD room: ${freeRoomsAtPeak.rows[0]!.number}), peak lockers=88, now active late stay=${active.id} (${assignmentType})`
      );
    }

    // -----------------------------------------------------------------------
    // Shifts / timeclock / documents (existing behavior)
    // -----------------------------------------------------------------------
    // Check if demo shifts already exist in the 28-day window
    const past14Days = new Date(now);
    past14Days.setDate(past14Days.getDate() - 14);
    const next14Days = new Date(now);
    next14Days.setDate(next14Days.getDate() + 14);

    const existingShifts = await query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM employee_shifts
       WHERE starts_at >= $1 AND starts_at <= $2`,
      [past14Days, next14Days]
    );

    const shouldSeedShifts = parseInt(existingShifts.rows[0]?.count || '0', 10) === 0;

    if (!shouldSeedShifts) {
      console.log('⚠️  Demo shifts already exist. Skipping shift/timeclock seed.');
      return;
    }

    console.log('🌱 Seeding demo data (shifts, timeclock, documents)...');

    // Get all active staff
    const staffResult = await query<{ id: string; name: string; role: string }>(
      `SELECT id, name, role FROM staff WHERE active = true ORDER BY name`
    );

    if (staffResult.rows.length === 0) {
      console.log('⚠️  No active staff found. Skipping demo seed.');
      return;
    }

    const staff = staffResult.rows;
    const adminStaff = staff.find((s) => s.role === 'ADMIN') || staff[0]!;

    // Define shift windows (America/Chicago timezone)
    // Shift A: 12:00 AM to 8:00 AM
    // Shift B: 7:45 AM to 4:00 PM
    // Shift C: 3:45 PM to 12:00 AM

    // Helper to create a date at specific time
    // For demo, we store times in UTC but treat them as Chicago time for display
    // Shift windows are defined in Chicago time (America/Chicago)
    function createShiftDate(date: Date, hour: number, minute: number): Date {
      // Create a date with the specified hour/minute
      // We'll store as UTC but the hour/minute values represent Chicago time
      // For demo simplicity, we'll just use the local server timezone
      // In production, use a proper timezone library
      const result = new Date(date);
      result.setHours(hour, minute, 0, 0);
      return result;
    }

    // Seed shifts for 28-day window
    const shiftsCreated: string[] = [];
    const timeclockSessionsCreated: string[] = [];

    for (let dayOffset = -14; dayOffset <= 14; dayOffset++) {
      const baseDate = new Date(now);
      baseDate.setDate(baseDate.getDate() + dayOffset);
      baseDate.setHours(0, 0, 0, 0);

      // Determine which employees work which shifts (rotate for variety)
      const shiftAEmployee = staff[Math.abs(dayOffset) % staff.length]!;
      const shiftBEmployee = staff[(Math.abs(dayOffset) + 1) % staff.length]!;
      const shiftCEmployee = staff[(Math.abs(dayOffset) + 2) % staff.length]!;

      // Shift A: 12:00 AM to 8:00 AM
      const shiftAStart = createShiftDate(baseDate, 0, 0);
      const shiftAEnd = createShiftDate(baseDate, 8, 0);

      const shiftAResult = await query<{ id: string }>(
        `INSERT INTO employee_shifts 
         (employee_id, starts_at, ends_at, shift_code, status, created_by)
         VALUES ($1, $2, $3, 'A', 'SCHEDULED', $4)
         RETURNING id`,
        [shiftAEmployee.id, shiftAStart, shiftAEnd, adminStaff.id]
      );
      const shiftAId = shiftAResult.rows[0]!.id;
      shiftsCreated.push(shiftAId);

      // Shift B: 7:45 AM to 4:00 PM
      const shiftBStart = createShiftDate(baseDate, 7, 45);
      const shiftBEnd = createShiftDate(baseDate, 16, 0);

      const shiftBResult = await query<{ id: string }>(
        `INSERT INTO employee_shifts 
         (employee_id, starts_at, ends_at, shift_code, status, created_by)
         VALUES ($1, $2, $3, 'B', 'SCHEDULED', $4)
         RETURNING id`,
        [shiftBEmployee.id, shiftBStart, shiftBEnd, adminStaff.id]
      );
      const shiftBId = shiftBResult.rows[0]!.id;
      shiftsCreated.push(shiftBId);

      // Shift C: 3:45 PM to 12:00 AM (next day)
      const shiftCStart = createShiftDate(baseDate, 15, 45);
      const nextDay = new Date(baseDate);
      nextDay.setDate(nextDay.getDate() + 1);
      const shiftCEnd = createShiftDate(nextDay, 0, 0);

      const shiftCResult = await query<{ id: string }>(
        `INSERT INTO employee_shifts 
         (employee_id, starts_at, ends_at, shift_code, status, created_by)
         VALUES ($1, $2, $3, 'C', 'SCHEDULED', $4)
         RETURNING id`,
        [shiftCEmployee.id, shiftCStart, shiftCEnd, adminStaff.id]
      );
      const shiftCId = shiftCResult.rows[0]!.id;
      shiftsCreated.push(shiftCId);

      // Seed timeclock sessions for past days only
      if (dayOffset < 0) {
        // Shift A timeclock
        const scenarioA = Math.random();
        if (scenarioA < 0.95) {
          // 95% show up
          let clockIn = new Date(shiftAStart);
          let clockOut = new Date(shiftAEnd);

          if (scenarioA < 0.15) {
            // Late clock-in (5-15 minutes late)
            clockIn = new Date(shiftAStart.getTime() + (5 + Math.random() * 10) * 60 * 1000);
          }

          if (scenarioA > 0.85 && scenarioA < 0.95) {
            // Early clock-out (5-15 minutes early)
            clockOut = new Date(shiftAEnd.getTime() - (5 + Math.random() * 10) * 60 * 1000);
          }

          const sessionAResult = await query<{ id: string }>(
            `INSERT INTO timeclock_sessions 
             (employee_id, shift_id, clock_in_at, clock_out_at, source)
             VALUES ($1, $2, $3, $4, 'OFFICE_DASHBOARD')
             RETURNING id`,
            [shiftAEmployee.id, shiftAId, clockIn, clockOut]
          );
          timeclockSessionsCreated.push(sessionAResult.rows[0]!.id);
        } else {
          // Past days never create open timeclock sessions (open sessions would violate the unique index
          // that enforces only one open session per employee). Use a closed session instead.
          const sessionAResult = await query<{ id: string }>(
            `INSERT INTO timeclock_sessions 
             (employee_id, shift_id, clock_in_at, clock_out_at, source)
             VALUES ($1, $2, $3, $4, 'OFFICE_DASHBOARD')
             RETURNING id`,
            [shiftAEmployee.id, shiftAId, shiftAStart, shiftAEnd]
          );
          timeclockSessionsCreated.push(sessionAResult.rows[0]!.id);
        }

        // Shift B timeclock
        const scenarioB = Math.random();
        if (scenarioB < 0.95) {
          let clockIn = new Date(shiftBStart);
          let clockOut = new Date(shiftBEnd);

          if (scenarioB < 0.15) {
            clockIn = new Date(shiftBStart.getTime() + (5 + Math.random() * 10) * 60 * 1000);
          }

          if (scenarioB > 0.85 && scenarioB < 0.95) {
            clockOut = new Date(shiftBEnd.getTime() - (5 + Math.random() * 10) * 60 * 1000);
          }

          const sessionBResult = await query<{ id: string }>(
            `INSERT INTO timeclock_sessions 
             (employee_id, shift_id, clock_in_at, clock_out_at, source)
             VALUES ($1, $2, $3, $4, 'OFFICE_DASHBOARD')
             RETURNING id`,
            [shiftBEmployee.id, shiftBId, clockIn, clockOut]
          );
          timeclockSessionsCreated.push(sessionBResult.rows[0]!.id);
        }

        // Shift C timeclock
        const scenarioC = Math.random();
        if (scenarioC < 0.95) {
          let clockIn = new Date(shiftCStart);
          let clockOut = new Date(shiftCEnd);

          if (scenarioC < 0.15) {
            clockIn = new Date(shiftCStart.getTime() + (5 + Math.random() * 10) * 60 * 1000);
          }

          if (scenarioC > 0.85 && scenarioC < 0.95) {
            clockOut = new Date(shiftCEnd.getTime() - (5 + Math.random() * 10) * 60 * 1000);
          }

          const sessionCResult = await query<{ id: string }>(
            `INSERT INTO timeclock_sessions 
             (employee_id, shift_id, clock_in_at, clock_out_at, source)
             VALUES ($1, $2, $3, $4, 'OFFICE_DASHBOARD')
             RETURNING id`,
            [shiftCEmployee.id, shiftCId, clockIn, clockOut]
          );
          timeclockSessionsCreated.push(sessionCResult.rows[0]!.id);
        }
      } else if (dayOffset === 0) {
        // TODAY: Ensure at least 2 employees are clocked in
        const todayStaff = [shiftBEmployee, shiftCEmployee].slice(0, 2);

        for (const employee of todayStaff) {
          // Check if already clocked in
          const existing = await query<{ count: string }>(
            `SELECT COUNT(*) as count
             FROM timeclock_sessions
             WHERE employee_id = $1 AND clock_out_at IS NULL`,
            [employee.id]
          );

          if (parseInt(existing.rows[0]?.count || '0', 10) === 0) {
            // Find their shift for today
            let shiftId: string | null = null;
            if (employee.id === shiftBEmployee.id) {
              shiftId = shiftBId;
            } else if (employee.id === shiftCEmployee.id) {
              shiftId = shiftCId;
            }

            const clockInTime = new Date();
            clockInTime.setMinutes(clockInTime.getMinutes() - Math.floor(Math.random() * 60)); // Clocked in 0-60 min ago

            const sessionResult = await query<{ id: string }>(
              `INSERT INTO timeclock_sessions 
               (employee_id, shift_id, clock_in_at, clock_out_at, source)
               VALUES ($1, $2, $3, NULL, 'OFFICE_DASHBOARD')
               RETURNING id`,
              [employee.id, shiftId, clockInTime]
            );
            timeclockSessionsCreated.push(sessionResult.rows[0]!.id);
          }
        }
      }
    }

    // Seed employee documents (1-2 per employee)
    const docTypes = ['ID', 'W4', 'I9', 'OFFER_LETTER', 'NDA'];
    const documentsCreated: string[] = [];

    for (const employee of staff) {
      const numDocs = Math.floor(Math.random() * 2) + 1; // 1 or 2 docs

      for (let i = 0; i < numDocs; i++) {
        const docType = docTypes[Math.floor(Math.random() * docTypes.length)]!;
        const filename = `${docType.toLowerCase()}_${employee.name.replace(/\s+/g, '_')}.pdf`;
        const storageKey = `${employee.id}/${randomUUID()}/${filename}`;

        const docResult = await query<{ id: string }>(
          `INSERT INTO employee_documents 
           (employee_id, doc_type, filename, mime_type, storage_key, uploaded_by)
           VALUES ($1, $2, $3, 'application/pdf', $4, $5)
           RETURNING id`,
          [employee.id, docType, filename, storageKey, adminStaff.id]
        );
        documentsCreated.push(docResult.rows[0]!.id);
      }
    }

    console.log(`✅ Demo data seeded successfully:`);
    console.log(`   - ${shiftsCreated.length} shifts created`);
    console.log(`   - ${timeclockSessionsCreated.length} timeclock sessions created`);
    console.log(`   - ${documentsCreated.length} employee documents created`);
  } catch (error) {
    console.error('❌ Demo seed failed:', error);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// Allows running: DEMO_MODE=true pnpm --filter @club-ops/api exec tsx src/db/seed-demo.ts
// ---------------------------------------------------------------------------
const isDirectRun =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  seedDemoData().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('❌ seed-demo CLI failed:', err);
    process.exitCode = 1;
  });
}
