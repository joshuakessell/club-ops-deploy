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

      // Choose one STANDARD room to remain available
      const freeRoomNumber =
        ROOM_NUMBERS.find((n) => {
          try {
            return getRoomKind(n) === 'STANDARD';
          } catch {
            return false;
          }
        }) ?? 200;

      const occupiedRoomNumbers = ROOM_NUMBERS.filter((n) => n !== freeRoomNumber);
      const occupiedLockerNumbers = LOCKER_NUMBERS.slice(0, 88); // 88 occupied, 20 available

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
      const checkedInCustomerIds: string[] = [];
      const visitIdsByCustomer = new Map<string, string>();

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

        // Create exactly 100 customers ("members" in demo terms)
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

        // Create ~90 active check-ins (visits + sessions + checkin_blocks)
        const checkedInCount = 90;
        for (let i = 0; i < checkedInCount; i++) {
          const customerId = customerIds[i]!;
          checkedInCustomerIds.push(customerId);

          // Distribute check-in times across last 24h, biased toward recent but includes older ones
          const u = rng();
          const biasRecent = u * u; // bias toward 0
          const baseOffsetMs = biasRecent * 24 * 60 * 60 * 1000;
          const forcedOlder = i % 10 === 0 ? (18 + rng() * 6) * 60 * 60 * 1000 : 0;
          const offsetMs = Math.min(24 * 60 * 60 * 1000, baseOffsetMs + forcedOlder);
          const checkInAt = new Date(now.getTime() - offsetMs);

          const visitId = randomUUID();
          visitIdsByCustomer.set(customerId, visitId);

          await client.query(
            `INSERT INTO visits (id, started_at, ended_at, created_at, updated_at, customer_id)
             VALUES ($1, $2, NULL, NOW(), NOW(), $3)`,
            [visitId, checkInAt, customerId]
          );

          // Assign rooms (54/55) and lockers (88/108). Some customers will have both.
          const roomNumber = i < occupiedRoomNumbers.length ? String(occupiedRoomNumbers[i]!) : null;
          const lockerNumber = i < occupiedLockerNumbers.length ? occupiedLockerNumbers[i]! : null;
          const room = roomNumber ? roomIdByNumber.get(roomNumber) : undefined;
          const lockerId = lockerNumber ? lockerIdByNumber.get(lockerNumber) : undefined;

          // Determine rental type: room tier if present, else locker, else STANDARD (waitlist-like)
          let rentalType: RentalType = RentalType.STANDARD;
          if (roomNumber) {
            const kind = getRoomKind(parseInt(roomNumber, 10));
            rentalType =
              kind === 'SPECIAL'
                ? RentalType.SPECIAL
                : kind === 'DELUXE'
                  ? RentalType.DOUBLE
                  : RentalType.STANDARD;
          } else if (lockerNumber) {
            rentalType = RentalType.LOCKER;
          }

          // Ensure we only reference existing inventory rows
          const roomId = room?.id ?? null;
          const lockerIdFinal = lockerId ?? null;

          const sessionId = randomUUID();

          // Blocks are 6-hour multiples; choose enough blocks so the last one ends in the future.
          const hoursSinceCheckin = Math.max(0, (now.getTime() - checkInAt.getTime()) / (60 * 60 * 1000));
          const blocksNeeded = Math.floor(hoursSinceCheckin / 6) + 1; // ensures last ends after now
          const checkoutAt = new Date(checkInAt.getTime() + blocksNeeded * 6 * 60 * 60 * 1000);

          const customerRow = await client.query<{ name: string; membership_number: string | null }>(
            `SELECT name, membership_number FROM customers WHERE id = $1`,
            [customerId]
          );
          const memberName = customerRow.rows[0]!.name;
          const membershipNumber = customerRow.rows[0]!.membership_number;

          await client.query(
            `INSERT INTO sessions
             (id, customer_id, member_name, membership_number, room_id, locker_id, check_in_time, checkout_at, expected_duration, status, lane, checkin_type, visit_id, agreement_signed, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ACTIVE', 'DEMO', 'INITIAL', $10, false, NOW(), NOW())`,
            [
              sessionId,
              customerId,
              memberName,
              membershipNumber,
              roomId,
              lockerIdFinal,
              checkInAt,
              checkoutAt,
              blocksNeeded * 6 * 60, // minutes
              visitId,
            ]
          );

          // Create blocks (INITIAL + RENEWALs) and track first block id for optional waitlist linkage
          let firstBlockId: string | null = null;
          for (let b = 0; b < blocksNeeded; b++) {
            const blockId = randomUUID();
            if (b === 0) firstBlockId = blockId;
            const startsAt = new Date(checkInAt.getTime() + b * 6 * 60 * 60 * 1000);
            const endsAt = new Date(startsAt.getTime() + 6 * 60 * 60 * 1000);
            const blockType = b === 0 ? BlockType.INITIAL : BlockType.RENEWAL;

            await client.query(
              `INSERT INTO checkin_blocks
               (id, visit_id, block_type, starts_at, ends_at, room_id, locker_id, session_id, agreement_signed, agreement_signed_at, created_at, updated_at, has_tv_remote, waitlist_id, rental_type)
               VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, false, NULL, NOW(), NOW(), $8, NULL, $9)`,
              [blockId, visitId, blockType, startsAt, endsAt, roomId, lockerIdFinal, false, rentalType]
            );
          }

          // Optionally place a couple unassigned check-ins on waitlist to simulate busy conditions
          if (!roomId && !lockerIdFinal && firstBlockId) {
            const waitlistId = randomUUID();
            await client.query(
              `INSERT INTO waitlist
               (id, visit_id, checkin_block_id, desired_tier, backup_tier, locker_or_room_assigned_initially, room_id, status, created_at, updated_at)
               VALUES ($1, $2, $3, 'STANDARD', 'LOCKER', NULL, NULL, 'ACTIVE', $4, NOW())`,
              [waitlistId, visitId, firstBlockId, checkInAt]
            );
            await client.query(`UPDATE checkin_blocks SET waitlist_id = $1, updated_at = NOW() WHERE id = $2`, [
              waitlistId,
              firstBlockId,
            ]);
          }

          // Mark inventory assignments/statuses for occupied resources
          if (roomNumber && roomId) {
            await client.query(
              `UPDATE rooms
               SET status = $1,
                   assigned_to_customer_id = $2,
                   last_status_change = NOW(),
                   updated_at = NOW()
               WHERE id = $3`,
              [RoomStatus.OCCUPIED, customerId, roomId]
            );
          }
          if (lockerNumber && lockerIdFinal) {
            await client.query(
              `UPDATE lockers
               SET status = $1,
                   assigned_to_customer_id = $2,
                   updated_at = NOW()
               WHERE id = $3`,
              [RoomStatus.OCCUPIED, customerId, lockerIdFinal]
            );
          }
        }

        // Ensure the free room is available (clean + unassigned)
        await client.query(
          `UPDATE rooms
           SET status = 'CLEAN', assigned_to_customer_id = NULL, last_status_change = NOW(), updated_at = NOW()
           WHERE number = $1`,
          [String(freeRoomNumber)]
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

      const occupiedRooms = await query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM rooms WHERE status = 'OCCUPIED' AND assigned_to_customer_id IS NOT NULL`
      );
      const availableRooms = await query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM rooms WHERE status = 'CLEAN' AND assigned_to_customer_id IS NULL`
      );
      const freeRoom = await query<{ number: string; type: string }>(
        `SELECT number, type::text as type FROM rooms WHERE status = 'CLEAN' AND assigned_to_customer_id IS NULL ORDER BY number LIMIT 1`
      );

      const occupiedLockers = await query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM lockers WHERE status = 'OCCUPIED' AND assigned_to_customer_id IS NOT NULL`
      );
      const availableLockers = await query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM lockers WHERE status = 'CLEAN' AND assigned_to_customer_id IS NULL`
      );

      const checkinBounds = await query<{ min: Date | null; max: Date | null }>(
        `SELECT MIN(check_in_time) as min, MAX(check_in_time) as max FROM sessions WHERE status = 'ACTIVE'`
      );
      const minCheckin = checkinBounds.rows[0]!.min ? new Date(checkinBounds.rows[0]!.min) : null;
      const maxCheckin = checkinBounds.rows[0]!.max ? new Date(checkinBounds.rows[0]!.max) : null;

      function asInt(row: { count: string }): number {
        return parseInt(row.count, 10);
      }

      if (asInt(customerCount.rows[0]!) !== 100) throw new Error(`Expected 100 customers, got ${customerCount.rows[0]!.count}`);
      if (asInt(memberCount.rows[0]!) !== 100) throw new Error(`Expected 100 members, got ${memberCount.rows[0]!.count}`);
      if (asInt(roomCount.rows[0]!) !== 55) throw new Error(`Expected 55 rooms, got ${roomCount.rows[0]!.count}`);
      if (asInt(nonExistentRoomsPresent.rows[0]!) !== 0)
        throw new Error(`Non-existent rooms present in DB (${nonExistentRoomsPresent.rows[0]!.count})`);
      if (asInt(occupiedRooms.rows[0]!) !== 54) throw new Error(`Expected 54 occupied rooms, got ${occupiedRooms.rows[0]!.count}`);
      if (asInt(availableRooms.rows[0]!) !== 1) throw new Error(`Expected 1 available room, got ${availableRooms.rows[0]!.count}`);
      if (!freeRoom.rows[0] || freeRoom.rows[0]!.type !== 'STANDARD')
        throw new Error(`Expected the free room to be STANDARD, got ${freeRoom.rows[0]?.number ?? 'none'} (${freeRoom.rows[0]?.type ?? 'n/a'})`);
      if (asInt(lockerCount.rows[0]!) !== 108) throw new Error(`Expected 108 lockers, got ${lockerCount.rows[0]!.count}`);
      if (asInt(occupiedLockers.rows[0]!) !== 88) throw new Error(`Expected 88 occupied lockers, got ${occupiedLockers.rows[0]!.count}`);
      if (asInt(availableLockers.rows[0]!) !== 20) throw new Error(`Expected 20 available lockers, got ${availableLockers.rows[0]!.count}`);

      const lowerBound = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      if (!minCheckin || !maxCheckin) throw new Error('Expected active sessions with check_in_time bounds');
      if (minCheckin.getTime() < lowerBound.getTime() - 60_000) {
        throw new Error(`Oldest check-in is too old: ${minCheckin.toISOString()} (min allowed ~${lowerBound.toISOString()})`);
      }
      if (maxCheckin.getTime() > now.getTime() + 5_000) {
        throw new Error(`Newest check-in is in the future: ${maxCheckin.toISOString()} (now ${now.toISOString()})`);
      }

      console.log(
        `✅ Busy Saturday seed complete: 100 members/customers, ${checkedInCustomerIds.length} active check-ins, 54 rooms occupied (free room: ${freeRoom.rows[0]!.number}), 88 lockers occupied`
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
