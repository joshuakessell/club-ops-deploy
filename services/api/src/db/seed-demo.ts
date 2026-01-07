import { query, transaction } from './index.js';
import { randomUUID } from 'crypto';
import { generateDemoData, type DemoRoom, type DemoLocker } from './demo-data.js';
import { RoomStatus } from '@club-ops/shared';
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
    // Customer / visit / waitlist demo seeding (rich dataset for kiosk/register)
    // -----------------------------------------------------------------------
    // Always reseed demo customers in DEMO_MODE to guarantee availability for searches
    {
      console.log('🌱 Seeding demo customers, visits, waitlist (resetting existing demo data)...');

      const roomRows = await query<DemoRoom>(
        `SELECT id, number, type::text as type, status::text as status FROM rooms ORDER BY number`
      );
      const lockerRows = await query<DemoLocker>(
        `SELECT id, number, status::text as status FROM lockers ORDER BY number`
      );

      const demoData = generateDemoData({
        now,
        rooms: roomRows.rows.map((r) => ({
          ...r,
          type: r.type as DemoRoom['type'],
          status: r.status as DemoRoom['status'],
        })),
        lockers: lockerRows.rows.map((l) => ({
          ...l,
          status: l.status as DemoLocker['status'],
        })),
      });

      await transaction(async (client) => {
        // Reset demo-related rows to ensure deterministic state.
        //
        // IMPORTANT:
        // - Do NOT use TRUNCATE ... CASCADE because rooms/lockers can be cascaded due to
        //   assigned_to_customer_id FKs, wiping inventory and causing FK insert failures.
        // - Do NOT use TRUNCATE without CASCADE because other tables reference checkin_blocks/visits
        //   (e.g., agreement_signatures, charges, sessions), which Postgres blocks on TRUNCATE.
        //
        // So we use ordered DELETEs which respect ON DELETE behaviors.
        await client.query(`UPDATE rooms SET assigned_to_customer_id = NULL, updated_at = NOW()`);
        await client.query(`UPDATE lockers SET assigned_to_customer_id = NULL, updated_at = NOW()`);
        await client.query('DELETE FROM waitlist');
        await client.query('DELETE FROM agreement_signatures');
        await client.query('DELETE FROM charges');
        await client.query('DELETE FROM checkin_blocks');
        await client.query('DELETE FROM visits');
        await client.query('DELETE FROM customers');

        // Customers
        for (const customer of demoData.customers) {
          await client.query(
            `INSERT INTO customers
             (id, name, dob, membership_number, membership_card_type, membership_valid_until, primary_language, past_due_balance, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
            [
              customer.id,
              customer.name,
              customer.dob || null,
              customer.membership_number || null,
              customer.membership_card_type || null,
              customer.membership_valid_until || null,
              customer.primary_language || null,
              customer.past_due_balance,
            ]
          );
        }

        // Visits and check-in blocks
        for (const visit of demoData.visits) {
          await client.query(
            `INSERT INTO visits (id, started_at, ended_at, created_at, updated_at, customer_id)
             VALUES ($1, $2, $3, NOW(), NOW(), $4)`,
            [visit.id, visit.started_at, visit.ended_at, visit.customer_id]
          );

          for (const block of visit.blocks) {
            await client.query(
              `INSERT INTO checkin_blocks
               (id, visit_id, block_type, starts_at, ends_at, room_id, locker_id, session_id, agreement_signed, agreement_signed_at, created_at, updated_at, has_tv_remote, waitlist_id, rental_type)
               VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8, $9, NOW(), NOW(), $10, $11, $12)`,
              [
                block.id,
                block.visit_id,
                block.block_type,
                block.starts_at,
                block.ends_at,
                block.room_id || null,
                block.locker_id || null,
                block.agreement_signed,
                block.agreement_signed ? block.ends_at : null,
                block.has_tv_remote,
                // Waitlist <-> checkin_blocks is a cycle:
                // - waitlist.checkin_block_id references checkin_blocks
                // - checkin_blocks.waitlist_id references waitlist
                // So insert blocks with NULL waitlist_id and backfill after inserting waitlist rows.
                null,
                block.rental_type,
              ]
            );
          }
        }

        // Waitlist entries (link back into blocks)
        for (const entry of demoData.waitlistEntries) {
          await client.query(
            `INSERT INTO waitlist
             (id, visit_id, checkin_block_id, desired_tier, backup_tier, locker_or_room_assigned_initially, room_id, status, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
            [
              entry.id,
              entry.visit_id,
              entry.checkin_block_id,
              entry.desired_tier,
              entry.backup_tier,
              entry.locker_or_room_assigned_initially,
              entry.room_id,
              entry.status,
              entry.created_at,
            ]
          );
        }

        // Backfill checkin_blocks.waitlist_id now that waitlist rows exist
        for (const entry of demoData.waitlistEntries) {
          await client.query(
            `UPDATE checkin_blocks SET waitlist_id = $1, updated_at = NOW() WHERE id = $2`,
            [entry.id, entry.checkin_block_id]
          );
        }
      });

      // Mark active assignments on inventory (rooms/lockers)
      const activeBlocks = demoData.visits
        .filter((v) => v.ended_at === null)
        .flatMap((v) => v.blocks.map((b) => ({ block: b, visit: v })));

      for (const { block, visit } of activeBlocks) {
        if (block.room_id) {
          await query(
            `UPDATE rooms SET status = $1, assigned_to_customer_id = $2, updated_at = NOW() WHERE id = $3`,
            [RoomStatus.OCCUPIED, visit.customer_id, block.room_id]
          );
        }
        if (block.locker_id) {
          await query(
            `UPDATE lockers SET status = $1, assigned_to_customer_id = $2, updated_at = NOW() WHERE id = $3`,
            [RoomStatus.OCCUPIED, visit.customer_id, block.locker_id]
          );
        }
      }

      console.log(
        `✅ Demo customers seeded (${demoData.customers.length}), visits: ${demoData.visits.length}, waitlist entries: ${demoData.waitlistEntries.length}`
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
          // Missing clock-out (create session but leave clock_out_at null)
          const sessionAResult = await query<{ id: string }>(
            `INSERT INTO timeclock_sessions 
             (employee_id, shift_id, clock_in_at, clock_out_at, source)
             VALUES ($1, $2, $3, NULL, 'OFFICE_DASHBOARD')
             RETURNING id`,
            [shiftAEmployee.id, shiftAId, shiftAStart]
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
    // Don't throw - allow server to start even if demo seed fails
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
