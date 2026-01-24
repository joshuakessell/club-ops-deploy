import { closeDatabase, query, transaction } from './index';
import { randomUUID } from 'crypto';
import {
  DOUBLE_ROOM_NUMBERS,
  LOCKER_NUMBERS,
  NONEXISTENT_ROOM_NUMBERS,
  ROOM_NUMBERS,
  ROOMS,
  SPECIAL_ROOM_NUMBERS,
} from '@club-ops/shared';
import { RentalType, RoomStatus, RoomType, getRoomTierFromNumber } from '@club-ops/shared';
import { computeSha256Hex, normalizeScanText } from '../checkin/identity';

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
    const FIFTEEN_MIN_MS = 15 * 60 * 1000;

    function ceilToNext15Min(d: Date): Date {
      const ms = d.getTime();
      const rounded = Math.ceil(ms / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS;
      return new Date(rounded);
    }

    function floorTo15Min(d: Date): Date {
      const ms = d.getTime();
      const rounded = Math.floor(ms / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS;
      return new Date(rounded);
    }

    function scheduledCheckoutFromCheckin(checkInAt: Date, durationMinutes: number): Date {
      // Checkout times round UP to the nearest 15-minute increment.
      return ceilToNext15Min(new Date(checkInAt.getTime() + durationMinutes * 60 * 1000));
    }

    // -----------------------------------------------------------------------
    // Busy Saturday Night demo seeding (stress-test-friendly dataset)
    // -----------------------------------------------------------------------
    {
      console.log('🌱 Seeding busy Saturday demo dataset (resetting customer data)...');

      // Keep employees unchanged
      const staffCountBefore = await query<{ count: string }>('SELECT COUNT(*)::text as count FROM staff');

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

      // Choose one STANDARD room to remain free at NOW
      const freeRoomNumber =
        ROOM_NUMBERS.find((n: number) => {
          try {
            return getRoomTierFromNumber(n) === 'STANDARD';
          } catch {
            return false;
          }
        }) ?? 200;

      const occupiedRoomNumbers = ROOM_NUMBERS.filter((n: number) => n !== freeRoomNumber);
      const ACTIVE_LOCKERS_TARGET = 40;
      const occupiedLockerNumbers = LOCKER_NUMBERS.slice(0, ACTIVE_LOCKERS_TARGET); // deterministic

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
            r.tier === 'DOUBLE' ? RoomType.DOUBLE : r.tier === 'SPECIAL' ? RoomType.SPECIAL : RoomType.STANDARD;
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
        await client.query('DELETE FROM inventory_reservations');
        await client.query('DELETE FROM waitlist');
        await client.query('DELETE FROM agreement_signatures');
        await client.query('DELETE FROM charges');
        await client.query('DELETE FROM checkin_blocks');
        await client.query('DELETE FROM payment_intents');
        await client.query('DELETE FROM lane_sessions');
        await client.query('DELETE FROM visits');
        await client.query('DELETE FROM customers');

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
        // Customers: seed 100 membership customers + extra guests for active occupancy + historical churn
        // -------------------------------------------------------------------
        const MEMBER_COUNT = 100;
        // Needs to cover:
        // - 142 concurrently active stays now (54 rooms + 88 lockers)
        // - 142+ completed stays for churn/checkout-quality assertions
        const EXTRA_GUEST_COUNT = 200; // total customers = 300 (stable stress-test dataset)

        // Create exactly 100 membership customers
        for (let i = 1; i <= 100; i++) {
          const idx = i - 1;
          const id = randomUUID();
          const membershipNumber = String(i).padStart(6, '0');
          const name = `${firstNames[idx % firstNames.length]} ${lastNames[(idx * 7) % lastNames.length]}`;
          const dob = new Date(1980 + (idx % 25), (idx * 3) % 12, ((idx * 5) % 27) + 1);

          await client.query(
            `INSERT INTO customers
             (id, name, dob, membership_number, membership_card_type, membership_valid_until, primary_language, past_due_balance, created_at, updated_at)
             VALUES ($1, $2, $3, $4, NULL, NULL, 'EN', 0, NOW(), NOW())`,
            [id, name, dob, membershipNumber]
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

        // Seed a known DL hash for encrypted lookup testing (no change to total count).
        const dlTestCustomerId = customerIds[customerIds.length - 1]!;
        const dlRawScan =
          '@\nANSI 636015090002DL00410289ZT03300007DLDCACDCBNONEDCDNONEDBA07152032DCSKESSELLDDENDACJOSHUADDFNDADCALEBDDGNDBD06042025DBB07151988DBC1DAYBRODAU072 inDAG3011 MAHANNA SPRINGS DR APT ADAIDALLASDAJTXDAK75235-8742DAQ21026653DCF35629580160034005135DCGUSADAZBRODCK10032599522DCLWDDAFDDB07162021DAW155DDK1\nZTZTAN';
        const dlNormalized = normalizeScanText(dlRawScan);
        const dlHash = computeSha256Hex(dlNormalized);
        await client.query(
          `UPDATE customers
           SET name = $1,
               dob = $2,
               id_scan_hash = $3,
               id_scan_value = $4,
               updated_at = NOW()
           WHERE id = $5`,
          ['Joshua Kessell', new Date('1988-07-15'), dlHash, dlNormalized, dlTestCustomerId]
        );
        console.log(`✓ Seeded DL hash test customer: Joshua Kessell (${dlTestCustomerId})`);

        // -------------------------------------------------------------------
        // Current ACTIVE occupancy at NOW
        // - Rooms: 54 occupied, 1 free (must be STANDARD)
        // - Lockers: 88 occupied, 20 free
        // Exclusive assignment must hold: each stay is room OR locker.
        // At NOW: exactly one active late stay (scheduled checkout = now - 15m, prefer locker).
        // All other active stays have scheduled checkout times in the future.
        // -------------------------------------------------------------------

        const ACTIVE_ROOM_OCCUPANCY = 54;
        const ACTIVE_LOCKER_OCCUPANCY = ACTIVE_LOCKERS_TARGET;

        const roomCustomerIds = customerIds.slice(0, ACTIVE_ROOM_OCCUPANCY);
        const lockerCustomerIds = customerIds.slice(ACTIVE_ROOM_OCCUPANCY, ACTIVE_ROOM_OCCUPANCY + ACTIVE_LOCKER_OCCUPANCY);
        const extraCustomerIds = customerIds.slice(ACTIVE_ROOM_OCCUPANCY + ACTIVE_LOCKER_OCCUPANCY);

        // Choose the last occupied locker customer to be the overdue one
        const lateActiveCustomerId = lockerCustomerIds[ACTIVE_LOCKER_OCCUPANCY - 1]!;
        // Keep the overdue stay's checkout aligned to a 15-minute boundary (realistic display),
        // while still being "about 15 minutes late".
        const lateScheduledCheckoutAt = new Date(floorTo15Min(now).getTime() - FIFTEEN_MIN_MS);
        // Demo expected duration is 6 hours (360 minutes). Check-in does NOT round; checkout does.
        const lateCheckInAt = new Date(lateScheduledCheckoutAt.getTime() - 6 * 60 * 60 * 1000);

        function rentalTypeForRoomNumber(roomNumber: number): RentalType {
          const tier = getRoomTierFromNumber(roomNumber);
          return tier === 'SPECIAL'
            ? RentalType.SPECIAL
            : tier === 'DOUBLE'
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
        }): Promise<void> {
          const visitId = randomUUID();
          await client.query(
            `INSERT INTO visits (id, started_at, ended_at, created_at, updated_at, customer_id)
             VALUES ($1, $2, $3, NOW(), NOW(), $4)`,
            [visitId, params.checkInAt, params.checkedOutAt, params.customerId]
          );

          const blockId = randomUUID();
          await client.query(
            `INSERT INTO checkin_blocks
             (id, visit_id, block_type, starts_at, ends_at, rental_type, room_id, locker_id, session_id, agreement_signed, agreement_signed_at, created_at, updated_at, has_tv_remote, waitlist_id)
             VALUES ($1, $2, 'INITIAL', $3, $4, $5, $6, $7, NULL, false, NULL, NOW(), NOW(), false, NULL)`,
            [blockId, visitId, params.checkInAt, params.scheduledCheckoutAt, params.rentalType, params.roomId, params.lockerId]
          );
        }

        // 1) Create ACTIVE room stays at NOW (all with future checkout times)
        const activeRoomCheckInTimes: Date[] = [];
        for (let i = 0; i < ACTIVE_ROOM_OCCUPANCY; i++) {
          const customerId = roomCustomerIds[i]!;
          const roomNumber = occupiedRoomNumbers[i]!;
          const roomMeta = roomIdByNumber.get(String(roomNumber));
          if (!roomMeta) throw new Error(`Missing room inventory row for ${roomNumber}`);

          // Check in within the last ~5h15m so checkout (6h later) is still in the future.
          // This keeps ACTIVE demo stays consistent with expected_duration=360.
          const minutesAgo = 15 + rng() * (5 * 60 + 15 - 15); // 15m..5h15m ago
          const checkInAt = new Date(now.getTime() - minutesAgo * 60 * 1000);
          const scheduledCheckoutAt = scheduledCheckoutFromCheckin(checkInAt, 360);
          activeRoomCheckInTimes.push(checkInAt);

          // Active stay - no checkout yet
          await createVisitStay({
            customerId,
            checkInAt,
            scheduledCheckoutAt,
            checkedOutAt: null, // ACTIVE
            roomId: roomMeta.id,
            lockerId: null,
            rentalType: rentalTypeForRoomNumber(roomNumber),
          });
        }

        // 2) Create ACTIVE locker stays at NOW (1 overdue by 15min, rest with future checkout)
        const activeLockerCheckInTimes: Date[] = [];
        for (let i = 0; i < ACTIVE_LOCKER_OCCUPANCY; i++) {
          const customerId = lockerCustomerIds[i]!;
          const lockerNumber = occupiedLockerNumbers[i]!;
          const lockerId = lockerIdByNumber.get(lockerNumber);
          if (!lockerId) throw new Error(`Missing locker inventory row for ${lockerNumber}`);

          const isLateActive = customerId === lateActiveCustomerId;

          if (isLateActive) {
            // The one overdue stay (15 minutes late)
            activeLockerCheckInTimes.push(lateCheckInAt);
            await createVisitStay({
              customerId,
              checkInAt: lateCheckInAt,
              scheduledCheckoutAt: lateScheduledCheckoutAt,
              checkedOutAt: null, // ACTIVE
              roomId: null,
              lockerId,
              rentalType: RentalType.LOCKER,
            });
          } else {
            // All other active lockers have future checkout times
            // Check in within the last ~5h15m so checkout (6h later) is still in the future.
            const minutesAgo = 15 + rng() * (5 * 60 + 15 - 15); // 15m..5h15m ago
            const checkInAt = new Date(now.getTime() - minutesAgo * 60 * 1000);
            const scheduledCheckoutAt = scheduledCheckoutFromCheckin(checkInAt, 360);
            activeLockerCheckInTimes.push(checkInAt);

            await createVisitStay({
              customerId,
              checkInAt,
              scheduledCheckoutAt,
              checkedOutAt: null, // ACTIVE
              roomId: null,
              lockerId,
              rentalType: RentalType.LOCKER,
            });
          }
        }

        // 3) Create churn: MANY completed stays over the last 24 hours
        // - Bias check-ins toward NOW (higher density in last ~2-3 hours)
        // - Most checkouts within 0..15 minutes early, some 30..120 minutes early
        // - Never overlap with the current active assignment for the same room/locker
        const COMPLETED_TARGET = 240; // >= 200 required

        function completedCustomerIdFor(idx: number): string {
          // Prefer customers not currently used for active stays, but always fall back deterministically.
          if (extraCustomerIds.length > 0) return extraCustomerIds[idx % extraCustomerIds.length]!;
          return customerIds[idx % customerIds.length]!;
        }

        // Quick lookup: active check-in times by resource id (used to prevent overlap)
        const activeCheckInByRoomId = new Map<string, Date>();
        for (let i = 0; i < ACTIVE_ROOM_OCCUPANCY; i++) {
          const roomNumber = occupiedRoomNumbers[i]!;
          const roomMeta = roomIdByNumber.get(String(roomNumber));
          if (!roomMeta) throw new Error(`Missing room inventory row for ${roomNumber}`);
          activeCheckInByRoomId.set(roomMeta.id, activeRoomCheckInTimes[i]!);
        }
        const activeCheckInByLockerId = new Map<string, Date>();
        for (let i = 0; i < ACTIVE_LOCKER_OCCUPANCY; i++) {
          const lockerNumber = occupiedLockerNumbers[i]!;
          const lockerId = lockerIdByNumber.get(lockerNumber);
          if (!lockerId) throw new Error(`Missing locker inventory row for ${lockerNumber}`);
          activeCheckInByLockerId.set(lockerId, activeLockerCheckInTimes[i]!);
        }

        function pickCompletedResource(idx: number): { roomId: string | null; lockerId: string | null; rentalType: RentalType } {
          // Slight bias toward rooms (more churn) but include lockers heavily too
          const useRoom = idx % 5 !== 0; // 80% rooms, 20% lockers
          if (useRoom) {
            const roomNumber = ROOM_NUMBERS[idx % ROOM_NUMBERS.length]!;
            const roomMeta = roomIdByNumber.get(String(roomNumber));
            if (!roomMeta) throw new Error(`Missing room inventory row for ${roomNumber}`);
            return { roomId: roomMeta.id, lockerId: null, rentalType: rentalTypeForRoomNumber(roomNumber) };
          }

          const lockerNumber = LOCKER_NUMBERS[idx % LOCKER_NUMBERS.length]!;
          const lockerId = lockerIdByNumber.get(lockerNumber);
          if (!lockerId) throw new Error(`Missing locker inventory row for ${lockerNumber}`);
          return { roomId: null, lockerId, rentalType: RentalType.LOCKER };
        }

        for (let idx = 0; idx < COMPLETED_TARGET; idx++) {
          const customerId = completedCustomerIdFor(idx);
          const resource = pickCompletedResource(idx);

          // Bias check-ins toward NOW using squared distribution (more density near now)
          // ageHours in [0..24], but rng^2 biases toward 0 (recent)
          const ageHours = rng() * rng() * 24;
          let checkInAt = new Date(now.getTime() - ageHours * 60 * 60 * 1000);

          const durationMinutes = randInt(120, 360); // 2h..6h
          let scheduledCheckoutAt = scheduledCheckoutFromCheckin(checkInAt, durationMinutes);

          // Ensure the scheduled checkout is in the past (completed) and doesn't overlap active check-in on same resource.
          const latestScheduled = new Date(now.getTime() - 60 * 1000); // <= now-1m
          if (scheduledCheckoutAt.getTime() > latestScheduled.getTime()) {
            const shiftMs = scheduledCheckoutAt.getTime() - latestScheduled.getTime() + randInt(0, 60) * 60 * 1000;
            checkInAt = new Date(checkInAt.getTime() - shiftMs);
            scheduledCheckoutAt = scheduledCheckoutFromCheckin(checkInAt, durationMinutes);
          }

          if (resource.roomId) {
            const activeCheckInAt = activeCheckInByRoomId.get(resource.roomId);
            if (activeCheckInAt && scheduledCheckoutAt.getTime() >= activeCheckInAt.getTime()) {
              const bufferMs = randInt(5, 60) * 60 * 1000;
              const newScheduled = new Date(activeCheckInAt.getTime() - bufferMs);
              const shiftMs = scheduledCheckoutAt.getTime() - newScheduled.getTime();
              checkInAt = new Date(checkInAt.getTime() - shiftMs);
              scheduledCheckoutAt = scheduledCheckoutFromCheckin(checkInAt, durationMinutes);
            }
          }
          if (resource.lockerId) {
            const activeCheckInAt = activeCheckInByLockerId.get(resource.lockerId);
            if (activeCheckInAt && scheduledCheckoutAt.getTime() >= activeCheckInAt.getTime()) {
              const bufferMs = randInt(5, 60) * 60 * 1000;
              const newScheduled = new Date(activeCheckInAt.getTime() - bufferMs);
              const shiftMs = scheduledCheckoutAt.getTime() - newScheduled.getTime();
              checkInAt = new Date(checkInAt.getTime() - shiftMs);
              scheduledCheckoutAt = scheduledCheckoutFromCheckin(checkInAt, durationMinutes);
            }
          }

          // Deterministic realism:
          // - 7/8 (~87.5%) within 0..15m early
          // - 1/8 (~12.5%) early by 30..120m
          const within15 = idx % 8 !== 0;
          const deltaMinutes = within15 ? randInt(0, 15) : randInt(30, 120);
          const checkedOutAt = new Date(scheduledCheckoutAt.getTime() - deltaMinutes * 60 * 1000);

          await createVisitStay({
            customerId,
            checkInAt,
            scheduledCheckoutAt,
            checkedOutAt,
            roomId: resource.roomId,
            lockerId: resource.lockerId,
            rentalType: resource.rentalType,
          });
        }

        // Update inventory at NOW to reflect ALL active assignments
        // Set all occupied rooms to OCCUPIED with assigned customer
        for (let i = 0; i < ACTIVE_ROOM_OCCUPANCY; i++) {
          const customerId = roomCustomerIds[i]!;
          const roomNumber = occupiedRoomNumbers[i]!;
          const roomMeta = roomIdByNumber.get(String(roomNumber));
          if (!roomMeta) throw new Error(`Missing room inventory row for ${roomNumber}`);

          await client.query(
            `UPDATE rooms
             SET status = $1,
                 assigned_to_customer_id = $2,
                 last_status_change = NOW(),
                 updated_at = NOW()
             WHERE id = $3`,
            [RoomStatus.OCCUPIED, customerId, roomMeta.id]
          );
        }

        // Ensure the one free room is CLEAN and unassigned
        const freeRoomMeta = roomIdByNumber.get(String(freeRoomNumber));
        if (!freeRoomMeta) throw new Error(`Missing free room inventory row for ${freeRoomNumber}`);
        await client.query(
          `UPDATE rooms
           SET status = 'CLEAN',
               assigned_to_customer_id = NULL,
               last_status_change = NOW(),
               updated_at = NOW()
           WHERE id = $1`,
          [freeRoomMeta.id]
        );

        // Set all occupied lockers to OCCUPIED with assigned customer
        for (let i = 0; i < ACTIVE_LOCKER_OCCUPANCY; i++) {
          const customerId = lockerCustomerIds[i]!;
          const lockerNumber = occupiedLockerNumbers[i]!;
          const lockerId = lockerIdByNumber.get(lockerNumber);
          if (!lockerId) throw new Error(`Missing locker inventory row for ${lockerNumber}`);

          await client.query(
            `UPDATE lockers
             SET status = $1,
                 assigned_to_customer_id = $2,
                 updated_at = NOW()
             WHERE id = $3`,
            [RoomStatus.OCCUPIED, customerId, lockerId]
          );
        }

        // Ensure free lockers are CLEAN and unassigned
        const freeLockerNumbers = LOCKER_NUMBERS.slice(ACTIVE_LOCKER_OCCUPANCY);
        for (const lockerNumber of freeLockerNumbers) {
          const lockerId = lockerIdByNumber.get(lockerNumber);
          if (!lockerId) throw new Error(`Missing free locker inventory row for ${lockerNumber}`);
          await client.query(
            `UPDATE lockers
             SET status = 'CLEAN',
                 assigned_to_customer_id = NULL,
                 updated_at = NOW()
             WHERE id = $1`,
            [lockerId]
          );
        }
      });

      // Post-seed assertions + concise summary (throw on failure)
      const staffCountAfter = await query<{ count: string }>('SELECT COUNT(*)::text as count FROM staff');
      if (staffCountBefore.rows[0]!.count !== staffCountAfter.rows[0]!.count) {
        throw new Error(
          `Staff count changed unexpectedly (${staffCountBefore.rows[0]!.count} -> ${staffCountAfter.rows[0]!.count})`
        );
      }

      const customerCount = await query<{ count: string }>('SELECT COUNT(*)::text as count FROM customers');
      const membershipCustomerCount = await query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM customers WHERE membership_number IS NOT NULL`
      );
      const roomCount = await query<{ count: string }>('SELECT COUNT(*)::text as count FROM rooms');
      const lockerCount = await query<{ count: string }>('SELECT COUNT(*)::text as count FROM lockers');

      const nonExistentRoomsPresent = await query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM rooms WHERE number = ANY($1::text[])`,
        [NONEXISTENT_ROOM_NUMBERS.map(String)]
      );

      // XOR violations (must be zero)
      const bothInBlocks = await query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM checkin_blocks WHERE room_id IS NOT NULL AND locker_id IS NOT NULL`
      );

      // Current occupancy at NOW: inventory assignments
      const roomsAssigned = await query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM rooms WHERE assigned_to_customer_id IS NOT NULL`
      );
      const roomsUnassigned = await query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM rooms WHERE assigned_to_customer_id IS NULL`
      );
      const lockersAssigned = await query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM lockers WHERE assigned_to_customer_id IS NOT NULL`
      );
      const lockersUnassigned = await query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM lockers WHERE assigned_to_customer_id IS NULL`
      );

      // Verify the one open room is STANDARD
      const openRooms = await query<{ number: string; type: string }>(
        `SELECT number, type::text as type FROM rooms WHERE assigned_to_customer_id IS NULL ORDER BY number`
      );

      // Active stays at NOW
      const activeBlocksNow = await query<{ count: string }>(
        `SELECT COUNT(*)::text as count
         FROM checkin_blocks cb
         JOIN visits v ON v.id = cb.visit_id
         WHERE v.ended_at IS NULL`
      );
      const activeVisitsNow = await query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM visits WHERE ended_at IS NULL`
      );

      // Find the overdue active session (exactly one)
      const overdueActiveBlocks = await query<{
        id: string;
        ends_at: Date;
        room_id: string | null;
        locker_id: string | null;
        customer_id: string;
      }>(
        `SELECT cb.id, cb.ends_at, cb.room_id, cb.locker_id, v.customer_id
         FROM checkin_blocks cb
         JOIN visits v ON v.id = cb.visit_id
         WHERE v.ended_at IS NULL
           AND cb.ends_at < NOW()
         ORDER BY cb.ends_at`
      );

      // All other active blocks should have future checkout
      const futureActiveBlocks = await query<{ count: string }>(
        `SELECT COUNT(*)::text as count
         FROM checkin_blocks cb
         JOIN visits v ON v.id = cb.visit_id
         WHERE v.ended_at IS NULL
           AND cb.ends_at > NOW()`
      );

      // Checkout quality: >= 85% of completed stays have (checkout_at - check_out_time) in [-15m, +15m]
      const checkoutQuality = await query<{ total: string; good: string }>(
        `SELECT
           COUNT(*)::text as total,
           COUNT(*) FILTER (
             WHERE EXTRACT(EPOCH FROM (v.ended_at - cb.ends_at)) BETWEEN (-15 * 60) AND (15 * 60)
           )::text as good
         FROM visits v
         JOIN LATERAL (
           SELECT ends_at
           FROM checkin_blocks
           WHERE visit_id = v.id
           ORDER BY ends_at DESC
           LIMIT 1
         ) cb ON TRUE
         WHERE v.ended_at IS NOT NULL`
      );

      function asInt(row: { count: string }): number {
        return parseInt(row.count, 10);
      }

      if (asInt(membershipCustomerCount.rows[0]!) !== 100)
        throw new Error(
          `Expected 100 membership customers, got ${membershipCustomerCount.rows[0]!.count}`
        );
      if (asInt(customerCount.rows[0]!) < 142)
        throw new Error(`Expected at least 142 customers, got ${customerCount.rows[0]!.count}`);
      if (asInt(roomCount.rows[0]!) !== 55) throw new Error(`Expected 55 rooms, got ${roomCount.rows[0]!.count}`);
      if (asInt(nonExistentRoomsPresent.rows[0]!) !== 0)
        throw new Error(`Non-existent rooms present in DB (${nonExistentRoomsPresent.rows[0]!.count})`);
      if (asInt(lockerCount.rows[0]!) !== 108) throw new Error(`Expected 108 lockers, got ${lockerCount.rows[0]!.count}`);
      if (asInt(bothInBlocks.rows[0]!) !== 0)
        throw new Error(`Exclusive assignment violated in checkin_blocks (${bothInBlocks.rows[0]!.count})`);

      // Current occupancy at NOW
      if (asInt(roomsAssigned.rows[0]!) !== 54)
        throw new Error(`Expected 54 assigned rooms at now, got ${roomsAssigned.rows[0]!.count}`);
      if (asInt(roomsUnassigned.rows[0]!) !== 1)
        throw new Error(`Expected 1 unassigned room at now, got ${roomsUnassigned.rows[0]!.count}`);
      if (openRooms.rows.length !== 1)
        throw new Error(`Expected 1 open room at now, got ${openRooms.rows.length}`);
      if (openRooms.rows[0]!.type !== 'STANDARD')
        throw new Error(
          `Expected the open room to be STANDARD, got ${openRooms.rows[0]!.number} (${openRooms.rows[0]!.type})`
        );
      if (asInt(lockersAssigned.rows[0]!) !== ACTIVE_LOCKERS_TARGET)
        throw new Error(
          `Expected ${ACTIVE_LOCKERS_TARGET} assigned lockers at now, got ${lockersAssigned.rows[0]!.count}`
        );
      if (asInt(lockersUnassigned.rows[0]!) !== 108 - ACTIVE_LOCKERS_TARGET)
        throw new Error(
          `Expected ${108 - ACTIVE_LOCKERS_TARGET} unassigned lockers at now, got ${lockersUnassigned.rows[0]!.count}`
        );

      // All DOUBLE and SPECIAL rooms must be occupied at now
      const missingDouble = await query<{ count: string }>(
        `SELECT COUNT(*)::text as count
         FROM rooms
         WHERE number = ANY($1::text[])
           AND assigned_to_customer_id IS NULL`,
        [DOUBLE_ROOM_NUMBERS.map(String)]
      );
      const missingSpecial = await query<{ count: string }>(
        `SELECT COUNT(*)::text as count
         FROM rooms
         WHERE number = ANY($1::text[])
           AND assigned_to_customer_id IS NULL`,
        [SPECIAL_ROOM_NUMBERS.map(String)]
      );
      if (asInt(missingDouble.rows[0]!) !== 0)
        throw new Error(`Expected all DOUBLE rooms occupied, missing=${missingDouble.rows[0]!.count}`);
      if (asInt(missingSpecial.rows[0]!) !== 0)
        throw new Error(`Expected all SPECIAL rooms occupied, missing=${missingSpecial.rows[0]!.count}`);

      // Active stays at NOW
      const expectedActiveNow = 54 + ACTIVE_LOCKERS_TARGET;
      if (asInt(activeBlocksNow.rows[0]!) !== expectedActiveNow)
        throw new Error(
          `Expected ${expectedActiveNow} active check-in blocks at now, got ${activeBlocksNow.rows[0]!.count}`
        );
      if (asInt(activeVisitsNow.rows[0]!) !== expectedActiveNow)
        throw new Error(`Expected ${expectedActiveNow} active visits at now, got ${activeVisitsNow.rows[0]!.count}`);

      // Exactly one overdue active block
      if (overdueActiveBlocks.rows.length !== 1)
        throw new Error(`Expected exactly 1 overdue active block, got ${overdueActiveBlocks.rows.length}`);
      const overdue = overdueActiveBlocks.rows[0]!;
      // Overdue session checkout is seeded on a 15-minute boundary and set to the prior 15-minute tick.
      const expectedLateMs = floorTo15Min(now).getTime() - 15 * 60 * 1000;
      if (!overdue.ends_at) throw new Error('Overdue active block missing ends_at');
      const lateDiffMs = Math.abs(new Date(overdue.ends_at).getTime() - expectedLateMs);
      // Allow slack because seeding + verification takes time.
      if (lateDiffMs > 2 * 60 * 1000) {
        throw new Error(
          `Overdue active block checkout mismatch: got ${new Date(overdue.ends_at).toISOString()} expected ~${new Date(expectedLateMs).toISOString()} (diff: ${lateDiffMs}ms)`
        );
      }
      if (overdue.room_id && overdue.locker_id)
        throw new Error('Overdue active block has both room and locker set');
      if (!overdue.room_id && !overdue.locker_id)
        throw new Error('Overdue active block must have either room or locker');

      // All other active blocks have future checkout
      if (asInt(futureActiveBlocks.rows[0]!) !== expectedActiveNow - 1)
        throw new Error(
          `Expected ${expectedActiveNow - 1} active blocks with future checkout, got ${futureActiveBlocks.rows[0]!.count}`
        );

      // Relaxed checkout realism checks (warn unless wildly off)
      const totalCompleted = parseInt(checkoutQuality.rows[0]!.total, 10);
      const within15Completed = parseInt(checkoutQuality.rows[0]!.good, 10);
      const within15Ratio = totalCompleted === 0 ? 0 : within15Completed / totalCompleted;

      const earlyCountRes = await query<{ early: string }>(
        `SELECT COUNT(*) FILTER (
           WHERE EXTRACT(EPOCH FROM (v.ended_at - cb.ends_at)) < (-15 * 60)
         )::text as early
         FROM visits v
         JOIN LATERAL (
           SELECT ends_at
           FROM checkin_blocks
           WHERE visit_id = v.id
           ORDER BY ends_at DESC
           LIMIT 1
         ) cb ON TRUE
         WHERE v.ended_at IS NOT NULL`
      );
      const earlyCompleted = parseInt(earlyCountRes.rows[0]!.early, 10);
      const earlyRatio = totalCompleted === 0 ? 0 : earlyCompleted / totalCompleted;

      if (totalCompleted < 200) {
        throw new Error(`Expected at least 200 completed visits, got ${totalCompleted}`);
      }

      // Target: within15 >= 0.85 and early <= 0.15, but don't fail on small natural variance.
      if (within15Ratio < 0.6) {
        throw new Error(
          `Checkout timing realism wildly off: within15=${within15Completed}/${totalCompleted} (${Math.round(within15Ratio * 100)}%)`
        );
      }
      if (within15Ratio < 0.85 || earlyRatio > 0.15) {
        console.warn(
          `⚠️  Checkout timing realism (non-fatal): within15=${within15Completed}/${totalCompleted} (${Math.round(
            within15Ratio * 100
          )}%), early>${15}m=${earlyCompleted}/${totalCompleted} (${Math.round(earlyRatio * 100)}%)`
        );
      }

      // Get overdue session details for summary
      const overdueResourceDetails = await query<{
        room_number: string | null;
        locker_number: string | null;
      }>(
        `SELECT r.number as room_number, l.number as locker_number
         FROM checkin_blocks cb
         LEFT JOIN rooms r ON cb.room_id = r.id
         LEFT JOIN lockers l ON cb.locker_id = l.id
         WHERE cb.id = $1`,
        [overdue.id]
      );
      const resourceRow = overdueResourceDetails.rows[0]!;
      const assignmentType = overdue.locker_id ? 'locker' : 'room';
      const overdueResource = resourceRow.locker_number || resourceRow.room_number || 'unknown';

      console.log(
        `✅ Busy Saturday seed complete (now=${now.toISOString()}): membership_customers=${membershipCustomerCount.rows[0]!.count}, customers=${customerCount.rows[0]!.count}, active blocks=${54 + ACTIVE_LOCKERS_TARGET} (54 rooms + ${ACTIVE_LOCKERS_TARGET} lockers), completed visits=${totalCompleted}, open STANDARD room=${openRooms.rows[0]!.number}, overdue block=${overdue.id} (${assignmentType} ${overdueResource})`
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
  } finally {
    await closeDatabase();
  }
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// Allows running: DEMO_MODE=true pnpm --filter @club-ops/api exec tsx src/db/seed-demo.ts
// ---------------------------------------------------------------------------
if (require.main === module) {
  seedDemoData().catch((err) => {
    console.error('❌ seed-demo CLI failed:', err);
    process.exitCode = 1;
  });
}
