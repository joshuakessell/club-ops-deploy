import type { FastifyInstance, FastifyReply } from 'fastify';
import { query } from '../db/index.js';

interface RoomCountRow {
  status: string;
  room_type: string;
  count: string;
}

interface LockerCountRow {
  status: string;
  count: string;
}

/**
 * Inventory routes for room and locker availability.
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function inventoryRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /v1/inventory/summary - Get inventory summary by status and type
   * 
   * Returns counts of rooms and lockers grouped by status (CLEAN, CLEANING, DIRTY)
   * and by type (STANDARD, DELUXE, VIP).
   */
  fastify.get('/v1/inventory/summary', async (_request, reply: FastifyReply) => {
    try {
      // Get room counts by status and type (excluding LOCKER type in rooms table)
      const roomResult = await query<RoomCountRow>(
        `SELECT status, type as room_type, COUNT(*) as count
         FROM rooms
         WHERE type != 'LOCKER'
         GROUP BY status, type
         ORDER BY type, status`
      );

      // Get locker counts by status
      const lockerResult = await query<LockerCountRow>(
        `SELECT status, COUNT(*) as count
         FROM lockers
         GROUP BY status
         ORDER BY status`
      );

      // Build byType inventory
      const byType: Record<string, { clean: number; cleaning: number; dirty: number; total: number }> = {
        STANDARD: { clean: 0, cleaning: 0, dirty: 0, total: 0 },
        DELUXE: { clean: 0, cleaning: 0, dirty: 0, total: 0 },
        VIP: { clean: 0, cleaning: 0, dirty: 0, total: 0 },
      };

      let overallClean = 0;
      let overallCleaning = 0;
      let overallDirty = 0;

      for (const row of roomResult.rows) {
        const count = parseInt(row.count, 10);
        const roomType = row.room_type;
        const status = row.status.toLowerCase() as 'clean' | 'cleaning' | 'dirty';

        if (!byType[roomType]) {
          byType[roomType] = { clean: 0, cleaning: 0, dirty: 0, total: 0 };
        }

        byType[roomType][status] = count;
        byType[roomType].total += count;

        if (status === 'clean') overallClean += count;
        else if (status === 'cleaning') overallCleaning += count;
        else if (status === 'dirty') overallDirty += count;
      }

      // Build locker inventory
      let lockerClean = 0;
      let lockerCleaning = 0;
      let lockerDirty = 0;

      for (const row of lockerResult.rows) {
        const count = parseInt(row.count, 10);
        const status = row.status.toLowerCase() as 'clean' | 'cleaning' | 'dirty';

        if (status === 'clean') lockerClean = count;
        else if (status === 'cleaning') lockerCleaning = count;
        else if (status === 'dirty') lockerDirty = count;
      }

      return reply.send({
        byType,
        overall: {
          clean: overallClean,
          cleaning: overallCleaning,
          dirty: overallDirty,
          total: overallClean + overallCleaning + overallDirty,
        },
        lockers: {
          clean: lockerClean,
          cleaning: lockerCleaning,
          dirty: lockerDirty,
          total: lockerClean + lockerCleaning + lockerDirty,
        },
      });
    } catch (error) {
      fastify.log.error(error, 'Failed to fetch inventory summary');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /v1/inventory/available - Get available (CLEAN) rooms by type
   * 
   * Returns only unassigned CLEAN rooms, useful for check-in flow.
   */
  fastify.get('/v1/inventory/available', async (_request, reply: FastifyReply) => {
    try {
      const result = await query<{ room_type: string; count: string }>(
        `SELECT type as room_type, COUNT(*) as count
         FROM rooms
         WHERE status = 'CLEAN' 
           AND assigned_to IS NULL
           AND type != 'LOCKER'
         GROUP BY type
         ORDER BY type`
      );

      const lockerResult = await query<{ count: string }>(
        `SELECT COUNT(*) as count
         FROM lockers
         WHERE status = 'CLEAN' AND assigned_to IS NULL`
      );

      const available: Record<string, number> = {
        STANDARD: 0,
        DELUXE: 0,
        VIP: 0,
      };

      for (const row of result.rows) {
        available[row.room_type] = parseInt(row.count, 10);
      }

      return reply.send({
        rooms: available,
        lockers: parseInt(lockerResult.rows[0]?.count ?? '0', 10),
        total: Object.values(available).reduce((a, b) => a + b, 0),
      });
    } catch (error) {
      fastify.log.error(error, 'Failed to fetch available inventory');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}

