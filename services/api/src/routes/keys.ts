import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { query } from '../db/index.js';
import { RoomStatus } from '@club-ops/shared';

/**
 * Schema for resolving key tags to rooms.
 */
const ResolveKeysSchema = z.object({
  tagCodes: z.array(z.string().min(1)).min(1).max(50), // Max 50 tags per request
});

type ResolveKeysInput = z.infer<typeof ResolveKeysSchema>;

interface KeyTagRow {
  id: string;
  room_id: string;
  tag_code: string;
  tag_type: string;
  is_active: boolean;
}

interface RoomRow {
  id: string;
  number: string;
  type: string;
  status: string;
  floor: number;
  override_flag: boolean;
}

interface ResolvedRoom {
  roomId: string;
  roomNumber: string;
  roomType: string;
  status: RoomStatus;
  floor: number;
  tagCode: string;
  tagType: string;
  overrideFlag: boolean;
}

/**
 * Key tag resolution routes for cleaning station workflow.
 * Supports batch scanning of QR/NFC tags.
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function keysRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /v1/keys/resolve - Resolve key tag codes to room information
   * 
   * Used by cleaning stations to batch-scan room tags and determine
   * which rooms are being processed. Returns room statuses for
   * determining the primary action or showing resolution UI.
   */
  fastify.post('/v1/keys/resolve', async (
    request: FastifyRequest<{ Body: ResolveKeysInput }>,
    reply: FastifyReply
  ) => {
    let body: ResolveKeysInput;

    try {
      body = ResolveKeysSchema.parse(request.body);
    } catch (error) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: error instanceof z.ZodError ? error.errors : 'Invalid input',
      });
    }

    try {
      // Find all matching key tags
      const tagResult = await query<KeyTagRow>(
        `SELECT id, room_id, tag_code, tag_type, is_active
         FROM key_tags
         WHERE tag_code = ANY($1) AND is_active = true`,
        [body.tagCodes]
      );

      if (tagResult.rows.length === 0) {
        return reply.status(404).send({
          error: 'No active key tags found',
          notFound: body.tagCodes,
        });
      }

      // Get room IDs from found tags
      const roomIds = tagResult.rows.map(tag => tag.room_id);
      const tagByRoomId = new Map(tagResult.rows.map(tag => [tag.room_id, tag]));

      // Fetch room details
      const roomResult = await query<RoomRow>(
        `SELECT id, number, type, status, floor, override_flag
         FROM rooms
         WHERE id = ANY($1)`,
        [roomIds]
      );

      // Build resolved rooms array
      const resolvedRooms: ResolvedRoom[] = [];
      const foundTagCodes = new Set<string>();

      for (const room of roomResult.rows) {
        const tag = tagByRoomId.get(room.id);
        if (tag) {
          foundTagCodes.add(tag.tag_code);
          resolvedRooms.push({
            roomId: room.id,
            roomNumber: room.number,
            roomType: room.type,
            status: room.status as RoomStatus,
            floor: room.floor,
            tagCode: tag.tag_code,
            tagType: tag.tag_type,
            overrideFlag: room.override_flag,
          });
        }
      }

      // Identify tags that weren't found
      const notFound = body.tagCodes.filter(code => !foundTagCodes.has(code));

      // Analyze statuses for primary action determination
      const statusCounts: Record<string, number> = {
        DIRTY: 0,
        CLEANING: 0,
        CLEAN: 0,
      };

      for (const room of resolvedRooms) {
        statusCounts[room.status] = (statusCounts[room.status] || 0) + 1;
      }

      // Determine if all rooms have the same status (for single-action button)
      const uniqueStatuses = Object.entries(statusCounts)
        .filter(([, count]) => count > 0)
        .map(([status]) => status);

      const isMixedStatus = uniqueStatuses.length > 1;

      // Determine primary action based on scanned statuses
      let primaryAction: string | null = null;
      if (!isMixedStatus && uniqueStatuses.length === 1) {
        const status = uniqueStatuses[0];
        // Primary action is the next step in the cleaning flow
        switch (status) {
          case 'DIRTY':
            primaryAction = 'START_CLEANING'; // DIRTY → CLEANING
            break;
          case 'CLEANING':
            primaryAction = 'MARK_CLEAN'; // CLEANING → CLEAN
            break;
          case 'CLEAN':
            primaryAction = 'MARK_DIRTY'; // CLEAN → DIRTY (room used)
            break;
        }
      }

      return reply.send({
        rooms: resolvedRooms,
        statusCounts,
        isMixedStatus,
        primaryAction,
        notFound: notFound.length > 0 ? notFound : undefined,
        totalResolved: resolvedRooms.length,
        totalRequested: body.tagCodes.length,
      });
    } catch (error) {
      fastify.log.error(error, 'Failed to resolve key tags');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}

