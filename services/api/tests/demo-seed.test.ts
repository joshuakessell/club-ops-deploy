import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import {
  DELUXE_ROOM_NUMBERS,
  SPECIAL_ROOM_NUMBERS,
  NONEXISTENT_ROOM_NUMBERS,
  ROOM_NUMBERS,
} from '@club-ops/shared';

describe('demo seed (busy Saturday) database assertions', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5433', 10),
      database: process.env.DB_NAME || 'club_operations',
      user: process.env.DB_USER || 'clubops',
      password: process.env.DB_PASSWORD || 'clubops_dev',
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('seeds 100 members/customers and preserves inventory contract + occupancy targets', async () => {
    const now = new Date();
    const lowerBound = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const customers = await pool.query<{ count: string }>('SELECT COUNT(*)::text as count FROM customers');
    const members = await pool.query<{ count: string }>('SELECT COUNT(*)::text as count FROM members');
    expect(parseInt(customers.rows[0]!.count, 10)).toBe(100);
    expect(parseInt(members.rows[0]!.count, 10)).toBe(100);

    const rooms = await pool.query<{ number: string; type: string; status: string; assigned: string | null }>(
      `SELECT number, type::text as type, status::text as status, assigned_to_customer_id as assigned
       FROM rooms
       ORDER BY number`
    );
    const roomNumbers = rooms.rows.map((r) => parseInt(r.number, 10));
    expect(rooms.rows.length).toBe(55);

    // Ensure inventory is exactly the contract set (no extras, no missing)
    expect(new Set(roomNumbers)).toEqual(new Set(ROOM_NUMBERS));
    expect(NONEXISTENT_ROOM_NUMBERS.every((n) => !roomNumbers.includes(n))).toBe(true);

    const occupiedRooms = rooms.rows.filter((r) => r.status === 'OCCUPIED' && r.assigned);
    const availableRooms = rooms.rows.filter((r) => r.status === 'CLEAN' && !r.assigned);
    expect(occupiedRooms.length).toBe(54);
    expect(availableRooms.length).toBe(1);
    expect(availableRooms[0]!.type).toBe('STANDARD');

    // Deluxe + Special rooms must be occupied
    for (const n of DELUXE_ROOM_NUMBERS) {
      const row = rooms.rows.find((r) => r.number === String(n));
      expect(row?.status).toBe('OCCUPIED');
    }
    for (const n of SPECIAL_ROOM_NUMBERS) {
      const row = rooms.rows.find((r) => r.number === String(n));
      expect(row?.status).toBe('OCCUPIED');
    }

    const lockers = await pool.query<{ number: string; status: string; assigned: string | null }>(
      `SELECT number, status::text as status, assigned_to_customer_id as assigned
       FROM lockers
       ORDER BY number`
    );
    expect(lockers.rows.length).toBe(108);
    const occupiedLockers = lockers.rows.filter((l) => l.status === 'OCCUPIED' && l.assigned);
    const availableLockers = lockers.rows.filter((l) => l.status === 'CLEAN' && !l.assigned);
    expect(occupiedLockers.length).toBe(88);
    expect(availableLockers.length).toBe(20);

    const bounds = await pool.query<{ min: Date | null; max: Date | null }>(
      `SELECT MIN(check_in_time) as min, MAX(check_in_time) as max FROM sessions WHERE status = 'ACTIVE'`
    );
    expect(bounds.rows[0]!.min).not.toBeNull();
    expect(bounds.rows[0]!.max).not.toBeNull();
    const min = new Date(bounds.rows[0]!.min!);
    const max = new Date(bounds.rows[0]!.max!);

    // Allow small clock drift between seed time and test time
    expect(min.getTime()).toBeGreaterThanOrEqual(lowerBound.getTime() - 60_000);
    expect(max.getTime()).toBeLessThanOrEqual(now.getTime() + 5_000);
  });
});
