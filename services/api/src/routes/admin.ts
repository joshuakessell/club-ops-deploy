import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { query } from '../db/index.js';
import { requireAuth, requireAdmin } from '../auth/middleware.js';

/**
 * Admin-only routes for operations management and metrics.
 */
export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /v1/admin/metrics/summary - Get cleaning metrics summary
   * 
   * Returns average dirty time and cleaning duration for a time range.
   * Excludes overridden/anomalous records.
   */
  fastify.get('/v1/admin/metrics/summary', {
    preHandler: [requireAuth, requireAdmin],
  }, async (
    request: FastifyRequest<{ 
      Querystring: { 
        from?: string;
        to?: string;
      } 
    }>,
    reply: FastifyReply
  ) => {
    try {
      const from = request.query.from 
        ? new Date(request.query.from)
        : new Date(Date.now() - 24 * 60 * 60 * 1000); // Default: last 24 hours
      const to = request.query.to 
        ? new Date(request.query.to)
        : new Date();

      // Calculate average time rooms remain dirty (DIRTY -> CLEANING transition)
      // Find when room became DIRTY from audit_log (non-override) or previous cleaning event
      const dirtyTimeResult = await query<{
        avg_minutes: string | null;
        count: string;
      }>(
        `WITH dirty_to_cleaning AS (
          SELECT 
            ce.room_id,
            ce.started_at,
            GREATEST(
              COALESCE(
                (SELECT MAX(created_at) 
                 FROM audit_log al 
                 WHERE al.entity_type = 'room' 
                   AND al.entity_id = ce.room_id 
                   AND al.new_value::jsonb->>'status' = 'DIRTY'
                   AND al.created_at < ce.started_at
                   AND al.action != 'OVERRIDE'),
                '1970-01-01'::timestamptz
              ),
              COALESCE(
                (SELECT MAX(created_at) 
                 FROM cleaning_events ce2 
                 WHERE ce2.room_id = ce.room_id 
                   AND ce2.to_status = 'DIRTY'
                   AND ce2.created_at < ce.started_at
                   AND ce2.override_flag = false),
                '1970-01-01'::timestamptz
              )
            ) as became_dirty_at
          FROM cleaning_events ce
          WHERE ce.from_status = 'DIRTY'
            AND ce.to_status = 'CLEANING'
            AND ce.override_flag = false
            AND ce.started_at >= $1
            AND ce.started_at <= $2
        )
        SELECT 
          AVG(EXTRACT(EPOCH FROM (started_at - became_dirty_at) / 60)) as avg_minutes,
          COUNT(*) as count
        FROM dirty_to_cleaning
        WHERE became_dirty_at > '1970-01-01'::timestamptz`,
        [from, to]
      );

      // Calculate average cleaning duration (CLEANING start -> CLEAN completion)
      // Match started_at from DIRTY->CLEANING with completed_at from CLEANING->CLEAN
      const cleaningDurationResult = await query<{
        avg_minutes: string | null;
        count: string;
      }>(
        `SELECT 
          AVG(EXTRACT(EPOCH FROM (completed_at - started_at) / 60)) as avg_minutes,
          COUNT(*) as count
         FROM cleaning_events ce
         WHERE ce.from_status = 'CLEANING'
           AND ce.to_status = 'CLEAN'
           AND ce.override_flag = false
           AND ce.started_at IS NOT NULL
           AND ce.completed_at IS NOT NULL
           AND ce.completed_at >= $1
           AND ce.completed_at <= $2`,
        [from, to]
      );

      const avgDirtyTime = dirtyTimeResult.rows[0]?.avg_minutes 
        ? parseFloat(dirtyTimeResult.rows[0].avg_minutes)
        : null;
      const dirtyTimeCount = parseInt(dirtyTimeResult.rows[0]?.count || '0', 10);

      const avgCleaningDuration = cleaningDurationResult.rows[0]?.avg_minutes
        ? parseFloat(cleaningDurationResult.rows[0].avg_minutes)
        : null;
      const cleaningDurationCount = parseInt(cleaningDurationResult.rows[0]?.count || '0', 10);

      return reply.send({
        from: from.toISOString(),
        to: to.toISOString(),
        averageDirtyTimeMinutes: avgDirtyTime,
        dirtyTimeSampleCount: dirtyTimeCount,
        averageCleaningDurationMinutes: avgCleaningDuration,
        cleaningDurationSampleCount: cleaningDurationCount,
      });
    } catch (error) {
      request.log.error(error, 'Failed to fetch metrics summary');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /v1/admin/metrics/by-staff - Get cleaning metrics by staff member
   * 
   * Returns average dirty time and cleaning duration filtered by staff and time range.
   */
  fastify.get('/v1/admin/metrics/by-staff', {
    preHandler: [requireAuth, requireAdmin],
  }, async (
    request: FastifyRequest<{ 
      Querystring: { 
        from?: string;
        to?: string;
        staffId?: string;
      } 
    }>,
    reply: FastifyReply
  ) => {
    try {
      const from = request.query.from 
        ? new Date(request.query.from)
        : new Date(Date.now() - 24 * 60 * 60 * 1000);
      const to = request.query.to 
        ? new Date(request.query.to)
        : new Date();
      const staffId = request.query.staffId;

      if (!staffId) {
        return reply.status(400).send({ error: 'staffId is required' });
      }

      // Average dirty time for this staff member
      const dirtyTimeResult = await query<{
        avg_minutes: string | null;
        count: string;
      }>(
        `WITH dirty_to_cleaning AS (
          SELECT 
            ce.room_id,
            ce.started_at,
            GREATEST(
              COALESCE(
                (SELECT MAX(created_at) 
                 FROM audit_log al 
                 WHERE al.entity_type = 'room' 
                   AND al.entity_id = ce.room_id 
                   AND al.new_value::jsonb->>'status' = 'DIRTY'
                   AND al.created_at < ce.started_at
                   AND al.action != 'OVERRIDE'),
                '1970-01-01'::timestamptz
              ),
              COALESCE(
                (SELECT MAX(created_at) 
                 FROM cleaning_events ce2 
                 WHERE ce2.room_id = ce.room_id 
                   AND ce2.to_status = 'DIRTY'
                   AND ce2.created_at < ce.started_at
                   AND ce2.override_flag = false),
                '1970-01-01'::timestamptz
              )
            ) as became_dirty_at
          FROM cleaning_events ce
          WHERE ce.from_status = 'DIRTY'
            AND ce.to_status = 'CLEANING'
            AND ce.override_flag = false
            AND ce.staff_id = $1
            AND ce.started_at >= $2
            AND ce.started_at <= $3
        )
        SELECT 
          AVG(EXTRACT(EPOCH FROM (started_at - became_dirty_at) / 60)) as avg_minutes,
          COUNT(*) as count
        FROM dirty_to_cleaning
        WHERE became_dirty_at > '1970-01-01'::timestamptz`,
        [staffId, from, to]
      );

      // Average cleaning duration for this staff member
      const cleaningDurationResult = await query<{
        avg_minutes: string | null;
        count: string;
      }>(
        `SELECT 
          AVG(EXTRACT(EPOCH FROM (completed_at - started_at) / 60)) as avg_minutes,
          COUNT(*) as count
         FROM cleaning_events ce
         WHERE ce.from_status = 'CLEANING'
           AND ce.to_status = 'CLEAN'
           AND ce.override_flag = false
           AND ce.staff_id = $1
           AND ce.started_at IS NOT NULL
           AND ce.completed_at IS NOT NULL
           AND ce.completed_at >= $2
           AND ce.completed_at <= $3`,
        [staffId, from, to]
      );

      const avgDirtyTime = dirtyTimeResult.rows[0]?.avg_minutes 
        ? parseFloat(dirtyTimeResult.rows[0].avg_minutes)
        : null;
      const dirtyTimeCount = parseInt(dirtyTimeResult.rows[0]?.count || '0', 10);

      const avgCleaningDuration = cleaningDurationResult.rows[0]?.avg_minutes
        ? parseFloat(cleaningDurationResult.rows[0].avg_minutes)
        : null;
      const cleaningDurationCount = parseInt(cleaningDurationResult.rows[0]?.count || '0', 10);

      return reply.send({
        staffId,
        from: from.toISOString(),
        to: to.toISOString(),
        averageDirtyTimeMinutes: avgDirtyTime,
        dirtyTimeSampleCount: dirtyTimeCount,
        averageCleaningDurationMinutes: avgCleaningDuration,
        cleaningDurationSampleCount: cleaningDurationCount,
      });
    } catch (error) {
      request.log.error(error, 'Failed to fetch metrics by staff');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /v1/admin/rooms/expirations - Get rooms nearing or past expiration
   * 
   * Returns active sessions with rooms, sorted by expiration time.
   * Past expiration rows are flagged and pinned to top.
   */
  fastify.get('/v1/admin/rooms/expirations', {
    preHandler: [requireAuth, requireAdmin],
  }, async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const result = await query<{
        room_id: string;
        room_number: string;
        session_id: string;
        customer_name: string;
        check_in_time: Date;
        expected_duration: number;
        checkout_at: Date;
      }>(
        `SELECT 
          r.id as room_id,
          r.number as room_number,
          s.id as session_id,
          s.member_name as customer_name,
          s.check_in_time,
          s.expected_duration,
          (s.check_in_time + (s.expected_duration || 60) * INTERVAL '1 minute') as checkout_at
         FROM sessions s
         JOIN rooms r ON s.room_id = r.id
         WHERE s.status = 'ACTIVE'
           AND s.room_id IS NOT NULL
         ORDER BY checkout_at ASC`
      );

      const now = new Date();
      const thirtyMinutesFromNow = new Date(now.getTime() + 30 * 60 * 1000);

      const expirations = result.rows.map(row => {
        const checkoutAt = new Date(row.checkout_at);
        const minutesPast = Math.floor((now.getTime() - checkoutAt.getTime()) / (60 * 1000));
        const minutesRemaining = Math.floor((checkoutAt.getTime() - now.getTime()) / (60 * 1000));
        const isExpired = checkoutAt < now;
        const isExpiringSoon = !isExpired && checkoutAt <= thirtyMinutesFromNow;

        return {
          roomId: row.room_id,
          roomNumber: row.room_number,
          sessionId: row.session_id,
          customerName: row.customer_name,
          checkoutAt: checkoutAt.toISOString(),
          minutesPast: isExpired ? minutesPast : null,
          minutesRemaining: !isExpired ? minutesRemaining : null,
          isExpired,
          isExpiringSoon,
        };
      });

      // Sort: expired first (most expired), then expiring soon, then others
      expirations.sort((a, b) => {
        if (a.isExpired && !b.isExpired) return -1;
        if (!a.isExpired && b.isExpired) return 1;
        if (a.isExpired && b.isExpired) {
          // Most expired first
          return (b.minutesPast || 0) - (a.minutesPast || 0);
        }
        if (a.isExpiringSoon && !b.isExpiringSoon) return -1;
        if (!a.isExpiringSoon && b.isExpiringSoon) return 1;
        // Both expiring soon or both normal - sort by remaining time
        return (a.minutesRemaining || 0) - (b.minutesRemaining || 0);
      });

      return reply.send({ expirations });
    } catch (error) {
      request.log.error(error, 'Failed to fetch room expirations');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /v1/admin/kpi - Get KPI summary for admin dashboard
   * 
   * Returns counts for rooms (occupied, unoccupied, dirty, cleaning, clean) and lockers.
   */
  fastify.get('/v1/admin/kpi', {
    preHandler: [requireAuth, requireAdmin],
  }, async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      // Get room counts by status
      const roomStatusResult = await query<{ status: string; count: string }>(
        `SELECT status, COUNT(*) as count
         FROM rooms
         WHERE type != 'LOCKER'
         GROUP BY status`
      );

      // Get occupied rooms (assigned to sessions)
      const occupiedResult = await query<{ count: string }>(
        `SELECT COUNT(DISTINCT r.id) as count
         FROM rooms r
         JOIN sessions s ON r.id = s.room_id
         WHERE s.status = 'ACTIVE'
           AND r.type != 'LOCKER'`
      );

      // Get locker counts
      const lockerResult = await query<{ status: string; count: string }>(
        `SELECT status, COUNT(*) as count
         FROM lockers
         GROUP BY status`
      );

      // Get lockers in use
      const lockersInUseResult = await query<{ count: string }>(
        `SELECT COUNT(DISTINCT l.id) as count
         FROM lockers l
         JOIN sessions s ON l.id = s.locker_id
         WHERE s.status = 'ACTIVE'`
      );

      const kpi: Record<string, number> = {
        roomsOccupied: parseInt(occupiedResult.rows[0]?.count || '0', 10),
        roomsUnoccupied: 0,
        roomsDirty: 0,
        roomsCleaning: 0,
        roomsClean: 0,
        lockersInUse: parseInt(lockersInUseResult.rows[0]?.count || '0', 10),
        waitingListCount: 0, // Placeholder for future implementation
      };

      for (const row of roomStatusResult.rows) {
        const count = parseInt(row.count, 10);
        const status = row.status.toLowerCase();
        if (status === 'dirty') kpi.roomsDirty = count;
        else if (status === 'cleaning') kpi.roomsCleaning = count;
        else if (status === 'clean') kpi.roomsClean = count;
      }

      kpi.roomsUnoccupied = kpi.roomsClean + kpi.roomsCleaning + kpi.roomsDirty - kpi.roomsOccupied;

      return reply.send(kpi);
    } catch (error) {
      request.log.error(error, 'Failed to fetch KPI');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /v1/admin/staff - Get list of staff members
   * 
   * Returns all active staff members for filtering metrics.
   */
  fastify.get('/v1/admin/staff', {
    preHandler: [requireAuth, requireAdmin],
  }, async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const result = await query<{
        id: string;
        name: string;
        role: string;
      }>(
        `SELECT id, name, role
         FROM staff
         WHERE active = true
         ORDER BY name`
      );

      return reply.send({
        staff: result.rows.map(row => ({
          id: row.id,
          name: row.name,
          role: row.role,
        })),
      });
    } catch (error) {
      request.log.error(error, 'Failed to fetch staff list');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}

