import { query } from './index.js';
import { randomUUID } from 'crypto';

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
    // Check if demo shifts already exist in the 28-day window
    const now = new Date();
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

    if (parseInt(existingShifts.rows[0]?.count || '0', 10) > 0) {
      console.log('⚠️  Demo shifts already exist. Skipping demo seed.');
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
    const adminStaff = staff.find(s => s.role === 'ADMIN') || staff[0]!;

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
        // Most sessions match shifts (realistic compliance)
        const scenarios = [
          { type: 'normal', probability: 0.7 },
          { type: 'late', probability: 0.15 },
          { type: 'early', probability: 0.1 },
          { type: 'missing', probability: 0.05 },
        ];

        // Shift A timeclock
        const scenarioA = Math.random();
        if (scenarioA < 0.95) { // 95% show up
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

