import { query, initializeDatabase, closeDatabase } from './index.js';
import { RoomStatus, RoomType } from '@club-ops/shared';
import { hashQrToken, hashPin } from '../auth/utils.js';

interface RoomSeed {
  number: string;
  type: RoomType;
  status: RoomStatus;
  floor: number;
  tagCode: string;
}

/**
 * Seed data for development and testing.
 * Inserts rooms with various statuses and key tags with QR scan tokens.
 */
const seedRooms: RoomSeed[] = [
  // DIRTY rooms
  { number: '101', type: RoomType.STANDARD, status: RoomStatus.DIRTY, floor: 1, tagCode: 'ROOM-101' },
  { number: '102', type: RoomType.STANDARD, status: RoomStatus.DIRTY, floor: 1, tagCode: 'ROOM-102' },
  { number: '201', type: RoomType.SPECIAL, status: RoomStatus.DIRTY, floor: 2, tagCode: 'ROOM-201' },
  
  // CLEANING rooms
  { number: '103', type: RoomType.STANDARD, status: RoomStatus.CLEANING, floor: 1, tagCode: 'ROOM-103' },
  { number: '202', type: RoomType.DOUBLE, status: RoomStatus.CLEANING, floor: 2, tagCode: 'ROOM-202' },
  
  // CLEAN rooms
  { number: '104', type: RoomType.STANDARD, status: RoomStatus.CLEAN, floor: 1, tagCode: 'ROOM-104' },
  { number: '105', type: RoomType.STANDARD, status: RoomStatus.CLEAN, floor: 1, tagCode: 'ROOM-105' },
  { number: '203', type: RoomType.DOUBLE, status: RoomStatus.CLEAN, floor: 2, tagCode: 'ROOM-203' },
  { number: '301', type: RoomType.SPECIAL, status: RoomStatus.CLEAN, floor: 3, tagCode: 'ROOM-301' },
  { number: 'L01', type: RoomType.LOCKER, status: RoomStatus.CLEAN, floor: 0, tagCode: 'LOCKER-01' },
];

async function seed() {
  try {
    console.log('Initializing database connection...');
    await initializeDatabase();

    console.log('Starting seed process...');

    // Check if rooms already exist
    const existingRooms = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM rooms'
    );
    
    if (parseInt(existingRooms.rows[0]?.count || '0', 10) > 0) {
      console.log('⚠️  Rooms already exist in database. Skipping seed.');
      console.log('   To reseed, clear the database first: pnpm db:reset && pnpm db:migrate');
      return;
    }

    // Insert rooms and key tags in a transaction
    for (const roomSeed of seedRooms) {
      // Insert room
      const roomResult = await query<{ id: string }>(
        `INSERT INTO rooms (number, type, status, floor, last_status_change)
         VALUES ($1, $2, $3, $4, NOW())
         RETURNING id`,
        [roomSeed.number, roomSeed.type, roomSeed.status, roomSeed.floor]
      );

      const roomId = roomResult.rows[0]!.id;

      // Insert key tag
      await query(
        `INSERT INTO key_tags (room_id, tag_type, tag_code, is_active)
         VALUES ($1, 'QR', $2, true)`,
        [roomId, roomSeed.tagCode]
      );

      console.log(`✓ Seeded room ${roomSeed.number} (${roomSeed.status}) with tag ${roomSeed.tagCode}`);
    }

    console.log(`\n✅ Successfully seeded ${seedRooms.length} rooms with key tags`);
    console.log('\nScan tokens for testing:');
    seedRooms.forEach(room => {
      console.log(`  - ${room.tagCode} → Room ${room.number} (${room.status})`);
    });

    // Seed staff users
    console.log('\nSeeding staff users...');
    
    const staffUsers = [
      {
        name: 'John Erikson',
        role: 'STAFF',
        qrToken: 'STAFF-001',
        pin: '1234',
      },
      {
        name: 'Cruz Martinez',
        role: 'ADMIN',
        qrToken: 'STAFF-002',
        pin: '1234',
      },
    ];

    // Check if staff already exist
    const existingStaff = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM staff'
    );
    
    if (parseInt(existingStaff.rows[0]?.count || '0', 10) > 0) {
      console.log('⚠️  Staff users already exist. Updating existing staff to match seed data...');
      
      // Update existing staff if they match old names or create new ones
      for (const staff of staffUsers) {
        const qrTokenHash = hashQrToken(staff.qrToken);
        const pinHash = await hashPin(staff.pin);

        // Check if staff with this name or matching old names exists
        const existing = await query<{ id: string; name: string }>(
          `SELECT id, name FROM staff 
           WHERE name = $1 
           OR (name = 'John Staff' AND $1 = 'John Erikson')
           OR (name = 'Jane Admin' AND $1 = 'Cruz Martinez')
           LIMIT 1`,
          [staff.name]
        );

        if (existing.rows.length > 0) {
          // Update existing staff
          await query(
            `UPDATE staff 
             SET name = $1, role = $2, qr_token_hash = $3, pin_hash = $4, active = true
             WHERE id = $5`,
            [staff.name, staff.role, qrTokenHash, pinHash, existing.rows[0]!.id]
          );
          console.log(`✓ Updated staff: ${existing.rows[0]!.name} → ${staff.name} (${staff.role})`);
        } else {
          // Create new staff if doesn't exist
          await query(
            `INSERT INTO staff (name, role, qr_token_hash, pin_hash, active)
             VALUES ($1, $2, $3, $4, true)`,
            [staff.name, staff.role, qrTokenHash, pinHash]
          );
          console.log(`✓ Seeded staff: ${staff.name} (${staff.role})`);
        }
      }

      console.log('\n✅ Staff users updated successfully');
    } else {
      // No existing staff, create new ones
      for (const staff of staffUsers) {
        const qrTokenHash = hashQrToken(staff.qrToken);
        const pinHash = await hashPin(staff.pin);

        await query(
          `INSERT INTO staff (name, role, qr_token_hash, pin_hash, active)
           VALUES ($1, $2, $3, $4, true)`,
          [staff.name, staff.role, qrTokenHash, pinHash]
        );

        console.log(`✓ Seeded staff: ${staff.name} (${staff.role})`);
      }

      console.log('\n✅ Staff users seeded successfully');
    }

    console.log('\nStaff login credentials for testing:');
    staffUsers.forEach(staff => {
      console.log(`  - ${staff.name} (${staff.role}):`);
      console.log(`    QR Token: ${staff.qrToken}`);
      console.log(`    PIN: ${staff.pin}`);
    });

    // Seed active agreement
    console.log('\nSeeding active agreement...');
    
    const existingAgreement = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM agreements WHERE active = true'
    );
    
    if (parseInt(existingAgreement.rows[0]?.count || '0', 10) > 0) {
      console.log('⚠️  Active agreement already exists. Skipping agreement seed.');
    } else {
      await query(
        `INSERT INTO agreements (version, title, body_text, active)
         VALUES ($1, $2, $3, true)`,
        ['placeholder-v1', 'Club Agreement', '']
      );
      console.log('✓ Seeded active agreement: placeholder-v1');
      console.log('✅ Agreement seeded successfully');
    }

  } catch (error) {
    console.error('❌ Seed failed:', error);
    throw error;
  } finally {
    await closeDatabase();
  }
}

// CLI entrypoint - run seed when executed directly
seed()
  .then(() => {
    console.log('\nSeed completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  });

export { seed };

