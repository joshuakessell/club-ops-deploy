import { query, initializeDatabase, closeDatabase } from './index.js';
import { RoomStatus, RoomType } from '@club-ops/shared';

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
  { number: '201', type: RoomType.DELUXE, status: RoomStatus.DIRTY, floor: 2, tagCode: 'ROOM-201' },
  
  // CLEANING rooms
  { number: '103', type: RoomType.STANDARD, status: RoomStatus.CLEANING, floor: 1, tagCode: 'ROOM-103' },
  { number: '202', type: RoomType.DELUXE, status: RoomStatus.CLEANING, floor: 2, tagCode: 'ROOM-202' },
  
  // CLEAN rooms
  { number: '104', type: RoomType.STANDARD, status: RoomStatus.CLEAN, floor: 1, tagCode: 'ROOM-104' },
  { number: '105', type: RoomType.STANDARD, status: RoomStatus.CLEAN, floor: 1, tagCode: 'ROOM-105' },
  { number: '203', type: RoomType.DELUXE, status: RoomStatus.CLEAN, floor: 2, tagCode: 'ROOM-203' },
  { number: '301', type: RoomType.VIP, status: RoomStatus.CLEAN, floor: 3, tagCode: 'ROOM-301' },
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

