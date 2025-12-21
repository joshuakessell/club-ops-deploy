import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { transaction, query } from '../db/index.js';
import { 
  RoomStatus, 
  RoomStatusSchema, 
  validateTransition 
} from '@club-ops/shared';
import type { Broadcaster } from '../websocket/broadcaster.js';
import { broadcastInventoryUpdate } from './sessions.js';
import { requireAuth } from '../auth/middleware.js';

/**
 * Schema for a single scanned room transition.
 */
const ScannedRoomSchema = z.object({
  token: z.string().min(1),
  roomId: z.string().uuid(),
  fromStatus: RoomStatusSchema,
  toStatus: RoomStatusSchema,
  override: z.boolean().optional().default(false),
  overrideReason: z.string().optional(),
});

/**
 * Schema for batch cleaning operations.
 */
const CleaningBatchSchema = z.object({
  deviceId: z.string().min(1),
  scanned: z.array(ScannedRoomSchema).min(1).max(50),
});

type CleaningBatchInput = z.infer<typeof CleaningBatchSchema>;
type ScannedRoom = z.infer<typeof ScannedRoomSchema>;

interface RoomRow {
  id: string;
  number: string;
  status: string;
  override_flag: boolean;
}

interface BatchResultRoom {
  roomId: string;
  roomNumber: string;
  previousStatus: RoomStatus;
  newStatus: RoomStatus;
  success: boolean;
  error?: string;
  requiresOverride?: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    broadcaster: Broadcaster;
  }
}

/**
 * Cleaning workflow routes for batch room status updates.
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function cleaningRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /v1/cleaning/batch - Batch update room statuses from scanned tokens
   * 
   * Updates multiple rooms based on scanned tokens, enforcing transition rules
   * from the shared package. Records cleaning_events and audit_log entries.
   * 
   * Transition rules:
   * - DIRTY → CLEANING (start cleaning)
   * - CLEANING → CLEAN (finish cleaning)
   * - CLEANING → DIRTY (rollback)
   * - CLEAN → DIRTY (room used/checkout)
   * - CLEAN → CLEANING (re-clean)
   * - DIRTY → CLEAN (requires override)
   */
  fastify.post('/v1/cleaning/batch', {
    preHandler: [requireAuth],
  }, async (
    request: FastifyRequest<{ Body: CleaningBatchInput }>,
    reply: FastifyReply
  ) => {
    if (!request.staff) {
      return reply.status(401).send({
        error: 'Unauthorized',
      });
    }

    let body: CleaningBatchInput;

    try {
      body = CleaningBatchSchema.parse(request.body);
    } catch (error) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: error instanceof z.ZodError ? error.errors : 'Invalid input',
      });
    }

    // Validate override reasons
    for (const scanned of body.scanned) {
      if (scanned.override && !scanned.overrideReason) {
        return reply.status(400).send({
          error: 'Override requires a reason',
          token: scanned.token,
        });
      }
    }

    const staffId = request.staff.staffId;
    const deviceId = body.deviceId;

    try {
      const result = await transaction(async (client) => {
        // 1. Create the cleaning batch record
        const batchResult = await client.query<{ id: string }>(
          `INSERT INTO cleaning_batches (staff_id, room_count)
           VALUES ($1, $2)
           RETURNING id`,
          [staffId, body.scanned.length]
        );
        const batchId = batchResult.rows[0]!.id;

        // 2. Get unique room IDs and fetch rooms with row locks
        const roomIds = [...new Set(body.scanned.map(s => s.roomId))];
        const roomResult = await client.query<RoomRow>(
          `SELECT id, number, status, override_flag
           FROM rooms
           WHERE id = ANY($1)
           FOR UPDATE`,
          [roomIds]
        );

        // Create a map for quick lookup
        const roomMap = new Map(roomResult.rows.map(r => [r.id, r]));

        // Track results for each scanned room
        const results: BatchResultRoom[] = [];
        const successfulTransitions: Array<{
          roomId: string;
          roomNumber: string;
          previousStatus: RoomStatus;
          newStatus: RoomStatus;
        }> = [];

        // 3. Process each scanned room
        for (const scanned of body.scanned) {
          const room = roomMap.get(scanned.roomId);

          if (!room) {
            results.push({
              roomId: scanned.roomId,
              roomNumber: 'UNKNOWN',
              previousStatus: scanned.fromStatus,
              newStatus: scanned.toStatus,
              success: false,
              error: 'Room not found',
            });
            continue;
          }

          // Verify the fromStatus matches current room status
          const currentStatus = room.status as RoomStatus;
          if (currentStatus !== scanned.fromStatus) {
            results.push({
              roomId: scanned.roomId,
              roomNumber: room.number,
              previousStatus: scanned.fromStatus,
              newStatus: scanned.toStatus,
              success: false,
              error: `Room status mismatch: expected ${scanned.fromStatus}, found ${currentStatus}`,
            });
            continue;
          }

          // Validate the transition using shared package
          const validation = validateTransition(scanned.fromStatus, scanned.toStatus, scanned.override);

          if (!validation.ok) {
            results.push({
              roomId: scanned.roomId,
              roomNumber: room.number,
              previousStatus: scanned.fromStatus,
              newStatus: scanned.toStatus,
              success: false,
              error: `Invalid transition from ${scanned.fromStatus} to ${scanned.toStatus}`,
              requiresOverride: validation.needsOverride,
            });
            continue;
          }

          // Skip if status is unchanged
          if (scanned.fromStatus === scanned.toStatus) {
            results.push({
              roomId: scanned.roomId,
              roomNumber: room.number,
              previousStatus: scanned.fromStatus,
              newStatus: scanned.toStatus,
              success: true,
            });
            continue;
          }

          // Determine if this transition should set override flag
          const isOverrideTransition = scanned.override && validation.ok;

          // 4. Update the room status
          await client.query(
            `UPDATE rooms
             SET status = $1,
                 last_status_change = NOW(),
                 override_flag = CASE WHEN $2 THEN true ELSE override_flag END,
                 updated_at = NOW()
             WHERE id = $3`,
            [scanned.toStatus, isOverrideTransition, scanned.roomId]
          );

          // 5. Record cleaning event
          const now = new Date();
          const startedAt = scanned.fromStatus === RoomStatus.DIRTY ? now : null;
          const completedAt = scanned.toStatus === RoomStatus.CLEAN ? now : null;

          await client.query(
            `INSERT INTO cleaning_events 
             (room_id, staff_id, started_at, completed_at, from_status, to_status, override_flag, override_reason, device_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              scanned.roomId,
              staffId,
              startedAt,
              completedAt,
              scanned.fromStatus,
              scanned.toStatus,
              isOverrideTransition,
              isOverrideTransition ? scanned.overrideReason : null,
              deviceId,
            ]
          );

          // 6. Record in cleaning_batch_rooms
          await client.query(
            `INSERT INTO cleaning_batch_rooms 
             (batch_id, room_id, status_from, status_to, override_flag, override_reason)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              batchId,
              scanned.roomId,
              scanned.fromStatus,
              scanned.toStatus,
              isOverrideTransition,
              isOverrideTransition ? scanned.overrideReason : null,
            ]
          );

          // 7. Log to audit log
          if (isOverrideTransition) {
            await client.query(
              `INSERT INTO audit_log 
               (staff_id, action, entity_type, entity_id, old_value, new_value, metadata)
               VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)`,
              [
                staffId,
                'ROOM_STATUS_CHANGE',
                'room',
                scanned.roomId,
                JSON.stringify({ status: scanned.fromStatus }),
                JSON.stringify({ status: scanned.toStatus }),
                JSON.stringify({ override: true, overrideReason: scanned.overrideReason }),
              ]
            );
          } else {
            await client.query(
              `INSERT INTO audit_log 
               (staff_id, action, entity_type, entity_id, old_value, new_value)
               VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
              [
                staffId,
                'ROOM_STATUS_CHANGE',
                'room',
                scanned.roomId,
                JSON.stringify({ status: scanned.fromStatus }),
                JSON.stringify({ status: scanned.toStatus }),
              ]
            );
          }

          results.push({
            roomId: scanned.roomId,
            roomNumber: room.number,
            previousStatus: scanned.fromStatus,
            newStatus: scanned.toStatus,
            success: true,
          });

          successfulTransitions.push({
            roomId: scanned.roomId,
            roomNumber: room.number,
            previousStatus: scanned.fromStatus,
            newStatus: scanned.toStatus,
          });
        }

        // 8. Update batch completion if all rooms processed
        const successCount = results.filter(r => r.success).length;
        if (successCount === body.scanned.length) {
          await client.query(
            `UPDATE cleaning_batches
             SET completed_at = NOW(), room_count = $1, updated_at = NOW()
             WHERE id = $2`,
            [successCount, batchId]
          );
        }

        return {
          batchId,
          results,
          successfulTransitions,
        };
      });

      // Broadcast WebSocket events for successful transitions
      if (fastify.broadcaster && result.successfulTransitions.length > 0) {
        // Create a map of scanned items to get override info
        const scannedMap = new Map(body.scanned.map(s => [s.roomId, s]));

        // Broadcast individual room status changes
        for (const transition of result.successfulTransitions) {
          const scanned = scannedMap.get(transition.roomId);
          fastify.broadcaster.broadcast({
            type: 'ROOM_STATUS_CHANGED',
            payload: {
              roomId: transition.roomId,
              previousStatus: transition.previousStatus,
              newStatus: transition.newStatus,
              changedBy: staffId,
              override: scanned?.override || false,
              reason: scanned?.overrideReason,
            },
            timestamp: new Date().toISOString(),
          });
        }

        // Broadcast inventory update
        await broadcastInventoryUpdate(fastify.broadcaster);
      }

      // Calculate summary
      const successCount = result.results.filter(r => r.success).length;
      const failureCount = result.results.filter(r => !r.success).length;

      return reply.status(successCount > 0 ? 200 : 400).send({
        batchId: result.batchId,
        summary: {
          total: result.results.length,
          success: successCount,
          failed: failureCount,
        },
        rooms: result.results,
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      fastify.log.error({ error: errorMessage, stack: errorStack }, 'Failed to process cleaning batch');
      return reply.status(500).send({
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'test' ? errorMessage : undefined,
      });
    }
  });

  /**
   * GET /v1/cleaning/batches - List recent cleaning batches
   */
  fastify.get('/v1/cleaning/batches', async (
    request: FastifyRequest<{ Querystring: { limit?: string; staffId?: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const limit = Math.min(parseInt(request.query.limit ?? '20', 10), 100);
      const staffId = request.query.staffId;

      let queryText = `
        SELECT id, staff_id, started_at, completed_at, room_count, created_at
        FROM cleaning_batches
      `;
      const params: unknown[] = [];

      if (staffId) {
        queryText += ' WHERE staff_id = $1';
        params.push(staffId);
      }

      queryText += ' ORDER BY started_at DESC LIMIT $' + (params.length + 1);
      params.push(limit);

      const result = await query<{
        id: string;
        staff_id: string;
        started_at: Date;
        completed_at: Date | null;
        room_count: number;
        created_at: Date;
      }>(queryText, params);

      const batches = result.rows.map(row => ({
        id: row.id,
        staffId: row.staff_id,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        roomCount: row.room_count,
        createdAt: row.created_at,
      }));

      return reply.send({ batches });
    } catch (error) {
      fastify.log.error(error, 'Failed to fetch cleaning batches');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}

