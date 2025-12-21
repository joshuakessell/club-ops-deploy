import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { query } from '../db/index.js';
import { requireAuth, requireAdmin, requireReauthForAdmin } from '../auth/middleware.js';

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
      // Exclude anomalies: negative durations, < 30s, > 4h
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
        ),
        durations AS (
          SELECT 
            EXTRACT(EPOCH FROM (started_at - became_dirty_at) / 60) as minutes
          FROM dirty_to_cleaning
          WHERE became_dirty_at > '1970-01-01'::timestamptz
        )
        SELECT 
          AVG(minutes) as avg_minutes,
          COUNT(*) as count
        FROM durations
        WHERE minutes >= 0.5  -- At least 30 seconds
          AND minutes <= 240   -- At most 4 hours
          AND minutes IS NOT NULL`,
        [from, to]
      );

      // Calculate average cleaning duration (CLEANING start -> CLEAN completion)
      // Match started_at from DIRTY->CLEANING with completed_at from CLEANING->CLEAN
      // Exclude anomalies: negative durations, < 30s, > 4h
      const cleaningDurationResult = await query<{
        avg_minutes: string | null;
        count: string;
      }>(
        `WITH durations AS (
          SELECT 
            EXTRACT(EPOCH FROM (completed_at - started_at) / 60) as minutes
          FROM cleaning_events ce
          WHERE ce.from_status = 'CLEANING'
            AND ce.to_status = 'CLEAN'
            AND ce.override_flag = false
            AND ce.started_at IS NOT NULL
            AND ce.completed_at IS NOT NULL
            AND ce.completed_at >= $1
            AND ce.completed_at <= $2
        )
        SELECT 
          AVG(minutes) as avg_minutes,
          COUNT(*) as count
        FROM durations
        WHERE minutes >= 0.5  -- At least 30 seconds
          AND minutes <= 240   -- At most 4 hours
          AND minutes IS NOT NULL`,
        [from, to]
      );

      // Count total rooms cleaned (CLEANING -> CLEAN transitions, excluding overrides)
      const totalCleanedResult = await query<{ count: string }>(
        `SELECT COUNT(*) as count
         FROM cleaning_events ce
         WHERE ce.from_status = 'CLEANING'
           AND ce.to_status = 'CLEAN'
           AND ce.override_flag = false
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
      const totalRoomsCleaned = parseInt(totalCleanedResult.rows[0]?.count || '0', 10);

      return reply.send({
        from: from.toISOString(),
        to: to.toISOString(),
        averageDirtyTimeMinutes: avgDirtyTime,
        dirtyTimeSampleCount: dirtyTimeCount,
        averageCleaningDurationMinutes: avgCleaningDuration,
        cleaningDurationSampleCount: cleaningDurationCount,
        totalRoomsCleaned,
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

      // Average dirty time for this staff member (with anomaly exclusions)
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
        ),
        durations AS (
          SELECT 
            EXTRACT(EPOCH FROM (started_at - became_dirty_at) / 60) as minutes
          FROM dirty_to_cleaning
          WHERE became_dirty_at > '1970-01-01'::timestamptz
        )
        SELECT 
          AVG(minutes) as avg_minutes,
          COUNT(*) as count
        FROM durations
        WHERE minutes >= 0.5  -- At least 30 seconds
          AND minutes <= 240   -- At most 4 hours
          AND minutes IS NOT NULL`,
        [staffId, from, to]
      );

      // Average cleaning duration for this staff member (with anomaly exclusions)
      const cleaningDurationResult = await query<{
        avg_minutes: string | null;
        count: string;
      }>(
        `WITH durations AS (
          SELECT 
            EXTRACT(EPOCH FROM (completed_at - started_at) / 60) as minutes
          FROM cleaning_events ce
          WHERE ce.from_status = 'CLEANING'
            AND ce.to_status = 'CLEAN'
            AND ce.override_flag = false
            AND ce.staff_id = $1
            AND ce.started_at IS NOT NULL
            AND ce.completed_at IS NOT NULL
            AND ce.completed_at >= $2
            AND ce.completed_at <= $3
        )
        SELECT 
          AVG(minutes) as avg_minutes,
          COUNT(*) as count
        FROM durations
        WHERE minutes >= 0.5  -- At least 30 seconds
          AND minutes <= 240   -- At most 4 hours
          AND minutes IS NOT NULL`,
        [staffId, from, to]
      );

      // Count total rooms cleaned by this staff member
      const totalCleanedResult = await query<{ count: string }>(
        `SELECT COUNT(*) as count
         FROM cleaning_events ce
         WHERE ce.from_status = 'CLEANING'
           AND ce.to_status = 'CLEAN'
           AND ce.override_flag = false
           AND ce.staff_id = $1
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
      const totalRoomsCleaned = parseInt(totalCleanedResult.rows[0]?.count || '0', 10);

      return reply.send({
        staffId,
        from: from.toISOString(),
        to: to.toISOString(),
        averageDirtyTimeMinutes: avgDirtyTime,
        dirtyTimeSampleCount: dirtyTimeCount,
        averageCleaningDurationMinutes: avgCleaningDuration,
        cleaningDurationSampleCount: cleaningDurationCount,
        totalRoomsCleaned,
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
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const result = await query<{
        room_id: string;
        room_number: string;
        room_type: string;
        session_id: string;
        customer_name: string;
        membership_number: string | null;
        check_in_time: Date;
        expected_duration: number;
        checkout_at: Date;
      }>(
        `SELECT 
          r.id as room_id,
          r.number as room_number,
          r.type as room_type,
          s.id as session_id,
          COALESCE(s.member_name, c.name) as customer_name,
          c.membership_number,
          COALESCE(s.check_in_time, s.checkin_at) as check_in_time,
          COALESCE(s.expected_duration, 360) as expected_duration,
          COALESCE(
            s.checkout_at,
            COALESCE(s.check_in_time, s.checkin_at) + (COALESCE(s.expected_duration, 360) * INTERVAL '1 minute')
          ) as checkout_at
         FROM sessions s
         JOIN rooms r ON s.room_id = r.id
         LEFT JOIN customers c ON s.customer_id = c.id
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
          roomTier: row.room_type,
          sessionId: row.session_id,
          customerName: row.customer_name,
          membershipNumber: row.membership_number || null,
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
    request: FastifyRequest,
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

      // Get lockers in use
      const lockersInUseResult = await query<{ count: string }>(
        `SELECT COUNT(DISTINCT l.id) as count
         FROM lockers l
         JOIN sessions s ON l.id = s.locker_id
         WHERE s.status = 'ACTIVE'`
      );

      // Get total lockers and available lockers
      const totalLockersResult = await query<{ count: string }>(
        `SELECT COUNT(*) as count FROM lockers`
      );
      const totalLockers = parseInt(totalLockersResult.rows[0]?.count || '0', 10);
      const lockersOccupied = parseInt(lockersInUseResult.rows[0]?.count || '0', 10);
      const lockersAvailable = totalLockers - lockersOccupied;

      const kpi: Record<string, number> = {
        roomsOccupied: parseInt(occupiedResult.rows[0]?.count || '0', 10),
        roomsUnoccupied: 0,
        roomsDirty: 0,
        roomsCleaning: 0,
        roomsClean: 0,
        lockersOccupied,
        lockersAvailable,
        waitingListCount: 0, // Placeholder for future implementation
      };

      for (const row of roomStatusResult.rows) {
        const count = parseInt(row.count, 10);
        const status = row.status.toLowerCase();
        if (status === 'dirty') kpi.roomsDirty = count;
        else if (status === 'cleaning') kpi.roomsCleaning = count;
        else if (status === 'clean') kpi.roomsClean = count;
      }

      kpi.roomsUnoccupied = (kpi.roomsClean || 0) + (kpi.roomsCleaning || 0) + (kpi.roomsDirty || 0) - kpi.roomsOccupied;

      return reply.send(kpi);
    } catch (error) {
      request.log.error(error, 'Failed to fetch KPI');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /v1/admin/staff - Get list of staff members
   * 
   * Returns all staff members (active and inactive) with last login info.
   */
  fastify.get('/v1/admin/staff', {
    preHandler: [requireAuth, requireAdmin],
  }, async (
    request: FastifyRequest<{
      Querystring: {
        search?: string;
        role?: string;
        active?: string;
      };
    }>,
    reply: FastifyReply
  ) => {
    try {
      let whereClause = '1=1';
      const params: unknown[] = [];
      let paramIndex = 1;

      if (request.query.search) {
        whereClause += ` AND (name ILIKE $${paramIndex} OR id::text = $${paramIndex})`;
        params.push(`%${request.query.search}%`);
        paramIndex++;
      }

      if (request.query.role) {
        whereClause += ` AND role = $${paramIndex}`;
        params.push(request.query.role);
        paramIndex++;
      }

      if (request.query.active !== undefined) {
        whereClause += ` AND active = $${paramIndex}`;
        params.push(request.query.active === 'true');
        paramIndex++;
      }

      const result = await query<{
        id: string;
        name: string;
        role: string;
        active: boolean;
        created_at: Date;
        last_login: Date | null;
      }>(
        `SELECT 
          s.id,
          s.name,
          s.role,
          s.active,
          s.created_at,
          MAX(ss.created_at) as last_login
         FROM staff s
         LEFT JOIN staff_sessions ss ON s.id = ss.staff_id
         WHERE ${whereClause}
         GROUP BY s.id, s.name, s.role, s.active, s.created_at
         ORDER BY s.name`
      );

      return reply.send({
        staff: result.rows.map(row => ({
          id: row.id,
          name: row.name,
          role: row.role,
          active: row.active,
          createdAt: row.created_at.toISOString(),
          lastLogin: row.last_login?.toISOString() || null,
        })),
      });
    } catch (error) {
      request.log.error(error, 'Failed to fetch staff list');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /v1/admin/staff - Create a new staff member
   */
  fastify.post('/v1/admin/staff', {
    preHandler: [requireAuth, requireAdmin],
  }, async (
    request: FastifyRequest<{
      Body: {
        name: string;
        role: 'STAFF' | 'ADMIN';
        pin: string;
        active?: boolean;
      };
    }>,
    reply: FastifyReply
  ) => {
    if (!request.staff) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const CreateStaffSchema = z.object({
      name: z.string().min(1),
      role: z.enum(['STAFF', 'ADMIN']),
      pin: z.string().regex(/^\d{4,6}$/, 'PIN must be 4-6 digits'),
      active: z.boolean().optional().default(true),
    });

    let body;
    try {
      body = CreateStaffSchema.parse(request.body);
    } catch (error) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: error instanceof z.ZodError ? error.errors : 'Invalid input',
      });
    }

    try {
      const { hashPin } = await import('../auth/utils.js');
      const pinHash = await hashPin(body.pin);

      const result = await query<{ id: string }>(
        `INSERT INTO staff (name, role, pin_hash, active)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [body.name, body.role, pinHash, body.active]
      );

      const staffId = result.rows[0]!.id;

      // Log audit action
      await query(
        `INSERT INTO audit_log (staff_id, action, entity_type, entity_id, new_value)
         VALUES ($1, 'STAFF_CREATED', 'staff', $2, $3)`,
        [
          request.staff.staffId,
          staffId,
          JSON.stringify({ name: body.name, role: body.role, active: body.active }),
        ]
      );

      return reply.status(201).send({
        id: staffId,
        name: body.name,
        role: body.role,
        active: body.active,
      });
    } catch (error) {
      request.log.error(error, 'Failed to create staff');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * PATCH /v1/admin/staff/:id - Update a staff member
   */
  fastify.patch('/v1/admin/staff/:id', {
    preHandler: [requireAuth, requireAdmin],
  }, async (
    request: FastifyRequest<{
      Params: { id: string };
      Body: {
        name?: string;
        role?: 'STAFF' | 'ADMIN';
        active?: boolean;
      };
    }>,
    reply: FastifyReply
  ) => {
    if (!request.staff) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const UpdateStaffSchema = z.object({
      name: z.string().min(1).optional(),
      role: z.enum(['STAFF', 'ADMIN']).optional(),
      active: z.boolean().optional(),
    });

    let body;
    try {
      body = UpdateStaffSchema.parse(request.body);
    } catch (error) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: error instanceof z.ZodError ? error.errors : 'Invalid input',
      });
    }

    try {
      const updates: string[] = [];
      const params: unknown[] = [];
      let paramIndex = 1;

      if (body.name !== undefined) {
        updates.push(`name = $${paramIndex}`);
        params.push(body.name);
        paramIndex++;
      }

      if (body.role !== undefined) {
        updates.push(`role = $${paramIndex}`);
        params.push(body.role);
        paramIndex++;
      }

      if (body.active !== undefined) {
        updates.push(`active = $${paramIndex}`);
        params.push(body.active);
        paramIndex++;
      }

      if (updates.length === 0) {
        return reply.status(400).send({ error: 'No fields to update' });
      }

      params.push(request.params.id);

      const result = await query<{
        id: string;
        name: string;
        role: string;
        active: boolean;
      }>(
        `UPDATE staff
         SET ${updates.join(', ')}, updated_at = NOW()
         WHERE id = $${paramIndex}
         RETURNING id, name, role, active`,
        params
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'Staff not found' });
      }

      const staff = result.rows[0]!;

      // Log audit action
      const action = body.active !== undefined
        ? (body.active ? 'STAFF_ACTIVATED' : 'STAFF_DEACTIVATED')
        : 'STAFF_UPDATED';

      await query(
        `INSERT INTO audit_log (staff_id, action, entity_type, entity_id, new_value)
         VALUES ($1, $2, 'staff', $3, $4)`,
        [
          request.staff.staffId,
          action,
          staff.id,
          JSON.stringify(body),
        ]
      );

      return reply.send(staff);
    } catch (error) {
      request.log.error(error, 'Failed to update staff');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /v1/admin/staff/:id/pin-reset - Reset a staff member's PIN
   * 
   * Requires re-authentication for security.
   */
  fastify.post('/v1/admin/staff/:id/pin-reset', {
    preHandler: [requireReauthForAdmin],
  }, async (
    request: FastifyRequest<{
      Params: { id: string };
      Body: { newPin: string };
    }>,
    reply: FastifyReply
  ) => {
    if (!request.staff) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const PinResetSchema = z.object({
      newPin: z.string().regex(/^\d{4,6}$/, 'PIN must be 4-6 digits'),
    });

    let body;
    try {
      body = PinResetSchema.parse(request.body);
    } catch (error) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: error instanceof z.ZodError ? error.errors : 'Invalid input',
      });
    }

    try {
      const { hashPin } = await import('../auth/utils.js');
      const pinHash = await hashPin(body.newPin);

      const result = await query<{ id: string }>(
        `UPDATE staff
         SET pin_hash = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING id`,
        [pinHash, request.params.id]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'Staff not found' });
      }

      // Log audit action
      await query(
        `INSERT INTO audit_log (staff_id, action, entity_type, entity_id)
         VALUES ($1, 'STAFF_PIN_RESET', 'staff', $2)`,
        [request.staff.staffId, request.params.id]
      );

      return reply.send({ success: true });
    } catch (error) {
      request.log.error(error, 'Failed to reset PIN');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}

