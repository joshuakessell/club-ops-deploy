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

interface LockerSeed {
  number: string; // 3-digit "001".."108"
  status: RoomStatus;
  tagCode: string;
}

/**
 * Seed data for development and testing.
 * Inserts rooms/lockers with various statuses and key tags with QR scan tokens.
 */
const seedRooms: RoomSeed[] = [
  // DIRTY rooms
  { number: '101', type: RoomType.STANDARD, status: RoomStatus.DIRTY, floor: 1, tagCode: 'ROOM-101' },
  { number: '102', type: RoomType.STANDARD, status: RoomStatus.DIRTY, floor: 1, tagCode: 'ROOM-102' },
  
  // CLEANING rooms
  { number: '103', type: RoomType.STANDARD, status: RoomStatus.CLEANING, floor: 1, tagCode: 'ROOM-103' },
  { number: '216', type: RoomType.DOUBLE, status: RoomStatus.CLEANING, floor: 2, tagCode: 'ROOM-216' },
  
  // CLEAN rooms - intentionally low counts for demo
  // STANDARD rooms
  { number: '104', type: RoomType.STANDARD, status: RoomStatus.CLEAN, floor: 1, tagCode: 'ROOM-104' },
  { number: '105', type: RoomType.STANDARD, status: RoomStatus.CLEAN, floor: 1, tagCode: 'ROOM-105' },
  { number: '106', type: RoomType.STANDARD, status: RoomStatus.CLEAN, floor: 1, tagCode: 'ROOM-106' },
  { number: '107', type: RoomType.STANDARD, status: RoomStatus.CLEAN, floor: 1, tagCode: 'ROOM-107' },
  
  // DOUBLE rooms - <5 available (only 2 clean)
  { number: '218', type: RoomType.DOUBLE, status: RoomStatus.CLEAN, floor: 2, tagCode: 'ROOM-218' },
  { number: '225', type: RoomType.DOUBLE, status: RoomStatus.CLEAN, floor: 2, tagCode: 'ROOM-225' },
  
  // SPECIAL rooms - 0 available (none seeded as CLEAN)
  // Note: Room 201, 232, 256 are SPECIAL but not seeded as CLEAN
];

// Seed lockers 001–108 (Club Dallas contract / employee register grid)
const seedLockers: LockerSeed[] = Array.from({ length: 108 }, (_, idx) => {
  const n = String(idx + 1).padStart(3, '0');
  return {
    number: n,
    status: RoomStatus.CLEAN,
    tagCode: `LOCKER-${n}`,
  };
});

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
      console.log('⚠️  Rooms already exist in database. Skipping room seed.');
      console.log('   To reseed rooms, clear the database first: pnpm db:reset && pnpm db:migrate');
    } else {
      for (const roomSeed of seedRooms) {
        const roomResult = await query<{ id: string }>(
          `INSERT INTO rooms (number, type, status, floor, last_status_change)
           VALUES ($1, $2, $3, $4, NOW())
           RETURNING id`,
          [roomSeed.number, roomSeed.type, roomSeed.status, roomSeed.floor]
        );

        const roomId = roomResult.rows[0]!.id;

        await query(
          `INSERT INTO key_tags (room_id, tag_type, tag_code, is_active)
           VALUES ($1, 'QR', $2, true)`,
          [roomId, roomSeed.tagCode]
        );

        console.log(`✓ Seeded room ${roomSeed.number} (${roomSeed.status}) with tag ${roomSeed.tagCode}`);
      }

      console.log(`\n✅ Successfully seeded ${seedRooms.length} rooms with key tags`);
    }

    // Seed lockers (001–108) and their key tags
    const existingLockers = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM lockers'
    );

    if (parseInt(existingLockers.rows[0]?.count || '0', 10) > 0) {
      console.log('⚠️  Lockers already exist in database. Skipping locker seed.');
    } else {
      for (const lockerSeed of seedLockers) {
        const lockerResult = await query<{ id: string }>(
          `INSERT INTO lockers (number, status)
           VALUES ($1, $2)
           RETURNING id`,
          [lockerSeed.number, lockerSeed.status]
        );

        const lockerId = lockerResult.rows[0]!.id;

        await query(
          `INSERT INTO key_tags (locker_id, tag_type, tag_code, is_active)
           VALUES ($1, 'QR', $2, true)`,
          [lockerId, lockerSeed.tagCode]
        );
      }

      console.log(`\n✅ Successfully seeded ${seedLockers.length} lockers with key tags (001–108)`);
    }

    console.log('\nScan tokens for testing (sample):');
    seedRooms.slice(0, 5).forEach((room) => {
      console.log(`  - ${room.tagCode} → Room ${room.number} (${room.status})`);
    });
    seedLockers.slice(0, 5).forEach((locker) => {
      console.log(`  - ${locker.tagCode} → Locker ${locker.number} (${locker.status})`);
    });

    // Seed staff users
    console.log('\nSeeding staff users...');
    
    const staffUsers = [
      {
        name: 'John Erikson',
        role: 'STAFF',
        qrToken: 'STAFF-001',
        pin: '111111',
      },
      {
        name: 'Manager Club',
        role: 'ADMIN',
        qrToken: 'STAFF-002',
        pin: '222222',
      },
      {
        name: 'Manager Dallas',
        role: 'ADMIN',
        qrToken: 'STAFF-003',
        pin: '333333',
      },
      {
        name: 'Employee One',
        role: 'STAFF',
        qrToken: 'STAFF-004',
        pin: '444444',
      },
      {
        name: 'Employee Two',
        role: 'STAFF',
        qrToken: 'STAFF-005',
        pin: '555555',
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

    // Seed devices for register use
    console.log('\nSeeding devices...');
    
    const seedDevices = [
      { deviceId: 'register-1', displayName: 'Register 1' },
      { deviceId: 'register-2', displayName: 'Register 2' },
    ];
    
    for (const device of seedDevices) {
      const existing = await query<{ count: string }>(
        'SELECT COUNT(*) as count FROM devices WHERE device_id = $1',
        [device.deviceId]
      );
      
      if (parseInt(existing.rows[0]?.count || '0', 10) === 0) {
        await query(
          `INSERT INTO devices (device_id, display_name, enabled)
           VALUES ($1, $2, true)`,
          [device.deviceId, device.displayName]
        );
        console.log(`✓ Seeded device: ${device.displayName} (${device.deviceId})`);
      } else {
        // Update existing device to ensure it's enabled
        await query(
          `UPDATE devices SET enabled = true, display_name = $1 WHERE device_id = $2`,
          [device.displayName, device.deviceId]
        );
        console.log(`✓ Updated device: ${device.displayName} (${device.deviceId})`);
      }
    }
    
    console.log('✅ Devices seeded successfully');

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

