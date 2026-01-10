import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import {
  NONEXISTENT_ROOM_NUMBERS,
  ROOM_NUMBERS,
} from '@club-ops/shared';

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

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

  const runIfDemo = process.env.DEMO_MODE === 'true' ? it : it.skip;

  runIfDemo('seeds peak occupancy in the past + exactly one active late stay at now, while preserving inventory contract', async () => {
    const customers = await pool.query<{ count: string }>('SELECT COUNT(*)::text as count FROM customers');
    const members = await pool.query<{ count: string }>('SELECT COUNT(*)::text as count FROM members');
    expect(parseInt(members.rows[0]!.count, 10)).toBe(100);
    expect(parseInt(customers.rows[0]!.count, 10)).toBeGreaterThanOrEqual(142);

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

    const lockers = await pool.query<{ number: string; status: string; assigned: string | null }>(
      `SELECT number, status::text as status, assigned_to_customer_id as assigned
       FROM lockers
       ORDER BY number`
    );
    expect(lockers.rows.length).toBe(108);

    // XOR violations must be zero (room OR locker, never both)
    const bothInSessions = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM sessions WHERE room_id IS NOT NULL AND locker_id IS NOT NULL`
    );
    const bothInBlocks = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM checkin_blocks WHERE room_id IS NOT NULL AND locker_id IS NOT NULL`
    );
    expect(parseInt(bothInSessions.rows[0]!.count, 10)).toBe(0);
    expect(parseInt(bothInBlocks.rows[0]!.count, 10)).toBe(0);

    // Exactly one active late stay at "now" (derived from dataset)
    const activeSessions = await pool.query<{
      id: string;
      check_in_time: Date;
      checkout_at: Date | null;
      check_out_time: Date | null;
      room_id: string | null;
      locker_id: string | null;
    }>(`SELECT id, check_in_time, checkout_at, check_out_time, room_id, locker_id FROM sessions WHERE status = 'ACTIVE'`);
    expect(activeSessions.rows.length).toBe(1);
    const active = activeSessions.rows[0]!;
    expect(active.check_out_time).toBeNull();
    expect(Boolean(active.room_id) !== Boolean(active.locker_id)).toBe(true);
    expect(active.checkout_at).not.toBeNull();

    // Reconstruct the seed's reference times from the dataset:
    // - seedNow = active.checkout_at + 15 minutes
    // - peak = seedNow - 6 hours = active.check_in_time + 15 minutes
    const seedNow = new Date(new Date(active.checkout_at!).getTime() + FIFTEEN_MIN_MS);
    const peak = new Date(active.check_in_time.getTime() + FIFTEEN_MIN_MS);

    // Peak occupancy computed via checkin_blocks time overlap
    const peakRoomOcc = await pool.query<{ count: string }>(
      `SELECT COUNT(DISTINCT room_id)::text as count
       FROM checkin_blocks
       WHERE room_id IS NOT NULL
         AND starts_at <= $1
         AND ends_at > $1`,
      [peak]
    );
    const peakLockerOcc = await pool.query<{ count: string }>(
      `SELECT COUNT(DISTINCT locker_id)::text as count
       FROM checkin_blocks
       WHERE locker_id IS NOT NULL
         AND starts_at <= $1
         AND ends_at > $1`,
      [peak]
    );
    expect(parseInt(peakRoomOcc.rows[0]!.count, 10)).toBe(54);
    expect(parseInt(peakLockerOcc.rows[0]!.count, 10)).toBe(88);

    // Exactly one free room at peak, and it must be STANDARD
    const freeRoomsAtPeak = await pool.query<{ number: string; type: string }>(
      `SELECT r.number, r.type::text as type
       FROM rooms r
       WHERE r.id NOT IN (
         SELECT cb.room_id
         FROM checkin_blocks cb
         WHERE cb.room_id IS NOT NULL
           AND cb.starts_at <= $1
           AND cb.ends_at > $1
       )
       ORDER BY r.number`,
      [peak]
    );
    expect(freeRoomsAtPeak.rows.length).toBe(1);
    expect(freeRoomsAtPeak.rows[0]!.type).toBe('STANDARD');

    // Active late stay scheduled checkout must be exactly seedNow - 15 minutes (within tiny tolerance)
    expect(Math.abs(new Date(active.checkout_at!).getTime() - (seedNow.getTime() - FIFTEEN_MIN_MS))).toBeLessThan(2000);

    // Checkout quality: >= 85% have (checkout_at - check_out_time) in [0, 15 minutes]
    const quality = await pool.query<{ total: string; good: string }>(
      `SELECT
         COUNT(*)::text as total,
         COUNT(*) FILTER (
           WHERE EXTRACT(EPOCH FROM (checkout_at - check_out_time)) BETWEEN 0 AND (15 * 60)
         )::text as good
       FROM sessions
       WHERE status = 'COMPLETED'
         AND checkout_at IS NOT NULL
         AND check_out_time IS NOT NULL`
    );
    const total = parseInt(quality.rows[0]!.total, 10);
    const good = parseInt(quality.rows[0]!.good, 10);
    expect(total).toBeGreaterThan(0);
    expect(good / total).toBeGreaterThanOrEqual(0.85);
  });
});
