import { loadEnvFromDotEnvIfPresent } from '../env/loadEnv';
import { closeDatabase, query, transaction } from './index';
import { randomUUID } from 'crypto';
import { seedBusySaturdayDemo } from './seed-demo/busy-saturday';
import { SeedProgress } from './seed-demo/progress';
import { generateAgreementPdf } from '../utils/pdf-generator';

loadEnvFromDotEnvIfPresent();

const DEMO_STATE_KEY = 'busy_saturday_demo_v1';
const DEMO_SNAPSHOT_VERSION = 1;
const DEMO_FORCE_RESEED = process.env.DEMO_FORCE_RESEED === 'true';
const DEMO_SHIFT_REGENERATE_PDFS = process.env.DEMO_SHIFT_REGENERATE_PDFS !== 'false';
const DEMO_RESET_ON_STARTUP = process.env.DEMO_RESET_ON_STARTUP !== 'false';

const DEMO_SNAPSHOT_TABLES = [
  'agreements',
  'customers',
  'rooms',
  'lockers',
  'key_tags',
  'visits',
  'checkin_blocks',
  'agreement_signatures',
  'waitlist',
  'inventory_reservations',
  'checkout_requests',
  'late_checkout_events',
  'lane_sessions',
  'payment_intents',
  'charges',
  'register_sessions',
  'cash_drawer_sessions',
  'cash_drawer_events',
  'orders',
  'order_line_items',
  'receipts',
  'external_provider_refs',
  'employee_shifts',
  'timeclock_sessions',
  'staff_break_sessions',
  'employee_documents',
] as const;

const DEMO_TIMESTAMP_TABLES = [
  'agreements',
  'customers',
  'rooms',
  'lockers',
  'visits',
  'checkin_blocks',
  'agreement_signatures',
  'waitlist',
  'inventory_reservations',
  'checkout_requests',
  'late_checkout_events',
  'lane_sessions',
  'payment_intents',
  'charges',
  'register_sessions',
  'cash_drawer_sessions',
  'cash_drawer_events',
  'orders',
  'receipts',
  'external_provider_refs',
  'employee_shifts',
  'timeclock_sessions',
  'staff_break_sessions',
  'employee_documents',
] as const;

async function ensureDemoStateTable(): Promise<void> {
  await query(
    `CREATE TABLE IF NOT EXISTS demo_state (
      key text PRIMARY KEY,
      value_json jsonb NOT NULL,
      updated_at timestamptz DEFAULT now() NOT NULL
    )`
  );
}

async function loadDemoState(): Promise<{
  seedAnchorIso: string;
  snapshotVersion: number;
  lastShiftedIso?: string;
} | null> {
  const res = await query<{
    value_json: { seedAnchorIso?: string; snapshotVersion?: number; lastShiftedIso?: string };
  }>(
    `SELECT value_json FROM demo_state WHERE key = $1`,
    [DEMO_STATE_KEY]
  );
  if (res.rows.length === 0) return null;
  const value = res.rows[0]!.value_json || {};
  if (!value.seedAnchorIso || typeof value.snapshotVersion !== 'number') return null;
  return {
    seedAnchorIso: value.seedAnchorIso,
    snapshotVersion: value.snapshotVersion,
    lastShiftedIso: value.lastShiftedIso,
  };
}

async function saveDemoState(params: { seedAnchor: Date; lastShifted?: Date }): Promise<void> {
  const lastShifted = params.lastShifted ?? params.seedAnchor;
  await query(
    `INSERT INTO demo_state (key, value_json, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key)
     DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = NOW()`,
    [
      DEMO_STATE_KEY,
      {
        seedAnchorIso: params.seedAnchor.toISOString(),
        lastShiftedIso: lastShifted.toISOString(),
        snapshotVersion: DEMO_SNAPSHOT_VERSION,
      },
    ]
  );
}

type DbClient = {
  query: <T = unknown>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
};

async function ensureSnapshotSchema(client: DbClient) {
  await client.query(`CREATE SCHEMA IF NOT EXISTS demo_snapshot`);
  for (const table of DEMO_SNAPSHOT_TABLES) {
    await client.query(
      `CREATE TABLE IF NOT EXISTS demo_snapshot.${table}
       (LIKE public.${table} INCLUDING ALL)`
    );
  }
}

async function trySetReplicationRole(client: DbClient, role: 'replica' | 'origin'): Promise<boolean> {
  try {
    await client.query(`SET session_replication_role = ${role}`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `⚠️  Unable to set session_replication_role=${role}. Continuing without it. (${message})`
    );
    return false;
  }
}

async function createDemoSnapshot(client: DbClient): Promise<void> {
  await ensureSnapshotSchema(client);
  const replicationRoleSet = await trySetReplicationRole(client, 'replica');
  try {
    for (const table of DEMO_SNAPSHOT_TABLES) {
      await client.query(`TRUNCATE demo_snapshot.${table}`);
      await client.query(`INSERT INTO demo_snapshot.${table} SELECT * FROM public.${table}`);
    }
  } finally {
    if (replicationRoleSet) {
      await trySetReplicationRole(client, 'origin');
    }
  }
}

async function restoreDemoSnapshot(client: DbClient): Promise<void> {
  await ensureSnapshotSchema(client);
  const replicationRoleSet = await trySetReplicationRole(client, 'replica');
  try {
    await client.query(
      `TRUNCATE ${DEMO_SNAPSHOT_TABLES.map((t) => `public.${t}`).join(', ')} RESTART IDENTITY CASCADE`
    );
    for (const table of DEMO_SNAPSHOT_TABLES) {
      await client.query(`INSERT INTO public.${table} SELECT * FROM demo_snapshot.${table}`);
    }
  } finally {
    if (replicationRoleSet) {
      await trySetReplicationRole(client, 'origin');
    }
  }
}

async function shiftDemoTimestamps(client: DbClient, deltaMs: number): Promise<void> {
  if (deltaMs === 0) return;
  const interval = `${deltaMs} milliseconds`;
  for (const table of DEMO_TIMESTAMP_TABLES) {
    const cols = await client.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = $1
         AND data_type = 'timestamp with time zone'`,
      [table]
    );
    if (cols.rows.length === 0) continue;
    const assignments = cols.rows.map(
      (c) => `${c.column_name} = ${c.column_name} + $1::interval`
    );
    await client.query(`UPDATE public.${table} SET ${assignments.join(', ')}`, [interval]);
  }
}

async function regenerateAgreementPdfs(client: DbClient): Promise<void> {
  const rows = await client.query<{
    id: string;
    starts_at: Date;
    agreement_signed_at: Date | null;
    agreement_text_snapshot: string;
    agreement_version: string;
    customer_name: string;
    membership_number: string | null;
    dob: Date | null;
    agreement_title: string | null;
  }>(
    `SELECT
       cb.id,
       cb.starts_at,
       cb.agreement_signed_at,
       sig.agreement_text_snapshot,
       sig.agreement_version,
       COALESCE(sig.customer_name, c.name) as customer_name,
       COALESCE(sig.membership_number, c.membership_number) as membership_number,
       c.dob,
       a.title as agreement_title
     FROM checkin_blocks cb
     JOIN agreement_signatures sig ON sig.checkin_block_id = cb.id
     JOIN visits v ON v.id = cb.visit_id
     JOIN customers c ON c.id = v.customer_id
     LEFT JOIN agreements a ON a.id = sig.agreement_id`
  );

  for (const row of rows.rows) {
    const signedAt = row.agreement_signed_at ?? row.starts_at;
    const pdfBuffer = await generateAgreementPdf({
      agreementTitle: row.agreement_title || 'Club Agreement',
      agreementVersion: row.agreement_version,
      agreementText: row.agreement_text_snapshot,
      customerName: row.customer_name,
      customerDob: row.dob,
      membershipNumber: row.membership_number ?? undefined,
      checkinAt: row.starts_at,
      signedAt,
      signatureText: row.customer_name,
    });
    await client.query(`UPDATE checkin_blocks SET agreement_pdf = $1 WHERE id = $2`, [
      pdfBuffer,
      row.id,
    ]);
  }
}

/**
 * Demo mode seeding for shifts and timeclock sessions.
 * Seeds shifts for past 14 days and next 14 days (28-day window).
 * In DEMO_MODE, restores a snapshot + shifts timestamps forward on startup
 * to keep demo data current without regenerating PDFs every run.
 */
export async function seedDemoData(options: { forceReseed?: boolean } = {}): Promise<void> {
  if (process.env.DEMO_MODE !== 'true') {
    return;
  }

  try {
    const now = new Date();
    await ensureDemoStateTable();

    const forceReseed = options.forceReseed ?? DEMO_FORCE_RESEED;
    const existingState = await loadDemoState();
    const canRestore =
      DEMO_RESET_ON_STARTUP &&
      !forceReseed &&
      existingState?.snapshotVersion === DEMO_SNAPSHOT_VERSION;

    if (canRestore && existingState) {
      const seedAnchor = new Date(existingState.seedAnchorIso);
      const deltaMs = now.getTime() - seedAnchor.getTime();

      await transaction(async (client) => {
        await restoreDemoSnapshot(client);
        await shiftDemoTimestamps(client, deltaMs);
        if (DEMO_SHIFT_REGENERATE_PDFS) {
          await regenerateAgreementPdfs(client);
        }
      });

      await saveDemoState({ seedAnchor, lastShifted: now });
      console.log(
        `✅ Demo snapshot restored and shifted by ${Math.round(deltaMs / 60000)} minute(s).`
      );
      return;
    }

    if (forceReseed) {
      console.log('⚠️  DEMO_FORCE_RESEED enabled: rebuilding demo dataset from scratch.');
    }

    const progress = new SeedProgress({ title: 'Demo seed' });
    progress.setMessage('Seeding busy Saturday data');
    await seedBusySaturdayDemo(now, progress);

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
      progress.log('⚠️  Demo shifts already exist. Skipping shift/timeclock seed.');
      progress.done('Demo seed complete');
      return;
    }

    progress.setMessage('Seeding shifts/timeclock');
    progress.log('🌱 Seeding demo data (shifts, timeclock, documents)...');

    // Get all active staff
    const staffResult = await query<{ id: string; name: string; role: string }>(
      `SELECT id, name, role FROM staff WHERE active = true ORDER BY name`
    );

    if (staffResult.rows.length === 0) {
      progress.log('⚠️  No active staff found. Skipping demo seed.');
      progress.done('Demo seed complete');
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

    progress.addTotal(29);
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
      progress.tick();
    }

    // Seed break sessions for open timeclock sessions (if none exist yet)
    progress.setMessage('Seeding break sessions');
    progress.addTotal(1);
    const existingBreaks = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM staff_break_sessions`
    );
    if (parseInt(existingBreaks.rows[0]?.count || '0', 10) === 0) {
      const openTimeclockSessions = await query<{
        id: string;
        employee_id: string;
        clock_in_at: Date;
      }>(
        `SELECT id, employee_id, clock_in_at
         FROM timeclock_sessions
         WHERE clock_out_at IS NULL
         ORDER BY clock_in_at DESC
         LIMIT 2`
      );

      if (openTimeclockSessions.rows.length > 0) {
        const openBreakSession = openTimeclockSessions.rows[0]!;
        await query(
          `INSERT INTO staff_break_sessions
           (staff_id, timeclock_session_id, started_at, break_type, status, notes)
           VALUES ($1, $2, $3, 'MEAL', 'OPEN', $4)`,
          [
            openBreakSession.employee_id,
            openBreakSession.id,
            new Date(now.getTime() - 15 * 60 * 1000),
            'Demo open break',
          ]
        );

        const closedBreakSession = openTimeclockSessions.rows[1] ?? openBreakSession;
        const breakStart = new Date(now.getTime() - 120 * 60 * 1000);
        const breakEnd = new Date(now.getTime() - 90 * 60 * 1000);
        await query(
          `INSERT INTO staff_break_sessions
           (staff_id, timeclock_session_id, started_at, ended_at, break_type, status, notes)
           VALUES ($1, $2, $3, $4, 'REST', 'CLOSED', $5)`,
          [
            closedBreakSession.employee_id,
            closedBreakSession.id,
            breakStart,
            breakEnd,
            'Demo closed break',
          ]
        );
      } else {
        const recentClosedSession = await query<{
          id: string;
          employee_id: string;
          clock_in_at: Date;
        }>(
          `SELECT id, employee_id, clock_in_at
           FROM timeclock_sessions
           WHERE clock_out_at IS NOT NULL
           ORDER BY clock_out_at DESC
           LIMIT 1`
        );
        if (recentClosedSession.rows.length > 0) {
          const session = recentClosedSession.rows[0]!;
          const breakStart = new Date(session.clock_in_at.getTime() + 60 * 60 * 1000);
          const breakEnd = new Date(session.clock_in_at.getTime() + 90 * 60 * 1000);
          await query(
            `INSERT INTO staff_break_sessions
             (staff_id, timeclock_session_id, started_at, ended_at, break_type, status, notes)
             VALUES ($1, $2, $3, $4, 'OTHER', 'CLOSED', $5)`,
            [session.employee_id, session.id, breakStart, breakEnd, 'Demo closed break']
          );
        }
      }
    }
    progress.tick();

    // Seed employee documents (1-2 per employee)
    const docTypes = ['ID', 'W4', 'I9', 'OFFER_LETTER', 'NDA'];
    const documentsCreated: string[] = [];

    progress.setMessage('Seeding employee documents');
    for (const employee of staff) {
      const numDocs = Math.floor(Math.random() * 2) + 1; // 1 or 2 docs

      for (let i = 0; i < numDocs; i++) {
        const docType = docTypes[Math.floor(Math.random() * docTypes.length)]!;
        const filename = `${docType.toLowerCase()}_${employee.name.replace(/\s+/g, '_')}.pdf`;
        const storageKey = `${employee.id}/${randomUUID()}/${filename}`;

        progress.addTotal(1);
        const docResult = await query<{ id: string }>(
          `INSERT INTO employee_documents 
           (employee_id, doc_type, filename, mime_type, storage_key, uploaded_by)
           VALUES ($1, $2, $3, 'application/pdf', $4, $5)
           RETURNING id`,
          [employee.id, docType, filename, storageKey, adminStaff.id]
        );
        documentsCreated.push(docResult.rows[0]!.id);
        progress.tick();
      }
    }

    progress.setMessage('Saving demo snapshot');
    progress.addTotal(1);
    await transaction(async (client) => {
      await createDemoSnapshot(client);
    });
    await saveDemoState({ seedAnchor: now, lastShifted: now });
    progress.tick();

    progress.done('Demo seed complete');
    console.log(`✅ Demo data seeded successfully:`);
    console.log(`   - ${shiftsCreated.length} shifts created`);
    console.log(`   - ${timeclockSessionsCreated.length} timeclock sessions created`);
    console.log(`   - ${documentsCreated.length} employee documents created`);
    console.log(`   - snapshot stored for fast restore on next demo start`);
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
