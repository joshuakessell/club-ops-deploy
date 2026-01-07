import { query, initializeDatabase, closeDatabase } from '../src/db/index.js';
import { hashPin } from '../src/auth/utils.js';

async function createStaff() {
  await initializeDatabase();

  const existing = await query<{ count: string }>('SELECT COUNT(*) as count FROM staff');
  if (parseInt(existing.rows[0]?.count || '0', 10) > 0) {
    console.log('Staff already exists');
    await closeDatabase();
    return;
  }

  const adminPin = await hashPin('5678');
  await query('INSERT INTO staff (name, role, pin_hash, active) VALUES ($1, $2, $3, true)', [
    'Cruz Martinez',
    'ADMIN',
    adminPin,
  ]);

  const staffPin = await hashPin('1234');
  await query('INSERT INTO staff (name, role, pin_hash, active) VALUES ($1, $2, $3, true)', [
    'John Erikson',
    'STAFF',
    staffPin,
  ]);

  console.log('✓ Created staff members');
  await closeDatabase();
}

createStaff().catch(console.error);
