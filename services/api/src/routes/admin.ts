import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, transaction } from '../db/index.js';
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
  fastify.get<{
    Querystring: {
      from?: string;
      to?: string;
    };
  }>(
    '/v1/admin/metrics/summary',
    {
      preHandler: [requireAuth, requireAdmin],
    },
    async (request, reply) => {
      try {
        const from = request.query.from
          ? new Date(request.query.from)
          : new Date(Date.now() - 24 * 60 * 60 * 1000); // Default: last 24 hours
        const to = request.query.to ? new Date(request.query.to) : new Date();

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
    }
  );

  /**
   * GET /v1/admin/metrics/by-staff - Get cleaning metrics by staff member
   *
   * Returns average dirty time and cleaning duration filtered by staff and time range.
   */
  fastify.get<{
    Querystring: {
      from?: string;
      to?: string;
      staffId?: string;
    };
  }>(
    '/v1/admin/metrics/by-staff',
    {
      preHandler: [requireAuth, requireAdmin],
    },
    async (request, reply) => {
      try {
        const from = request.query.from
          ? new Date(request.query.from)
          : new Date(Date.now() - 24 * 60 * 60 * 1000);
        const to = request.query.to ? new Date(request.query.to) : new Date();
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
    }
  );

  /**
   * GET /v1/admin/rooms/expirations - Get rooms nearing or past expiration
   *
   * Returns active sessions with rooms, sorted by expiration time.
   * Past expiration rows are flagged and pinned to top.
   */
  fastify.get(
    '/v1/admin/rooms/expirations',
    {
      preHandler: [requireAuth, requireAdmin],
    },
    async (request, reply) => {
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

        const expirations = result.rows.map((row) => {
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
    }
  );

  /**
   * GET /v1/admin/kpi - Get KPI summary for admin dashboard
   *
   * Returns counts for rooms (occupied, unoccupied, dirty, cleaning, clean) and lockers.
   */
  fastify.get(
    '/v1/admin/kpi',
    {
      preHandler: [requireAuth, requireAdmin],
    },
    async (request, reply) => {
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

        type AdminKpi = {
          roomsOccupied: number;
          roomsUnoccupied: number;
          roomsDirty: number;
          roomsCleaning: number;
          roomsClean: number;
          lockersOccupied: number;
          lockersAvailable: number;
          waitingListCount: number;
        };

        const kpi: AdminKpi = {
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

        kpi.roomsUnoccupied =
          kpi.roomsClean + kpi.roomsCleaning + kpi.roomsDirty - kpi.roomsOccupied;

        return reply.send(kpi);
      } catch (error) {
        request.log.error(error, 'Failed to fetch KPI');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * GET /v1/admin/staff - Get list of staff members
   *
   * Returns all staff members (active and inactive) with last login info.
   */
  fastify.get<{
    Querystring: {
      search?: string;
      role?: string;
      active?: string;
    };
  }>(
    '/v1/admin/staff',
    {
      preHandler: [requireAuth, requireAdmin],
    },
    async (request, reply) => {
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
          staff: result.rows.map((row) => ({
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
    }
  );

  /**
   * POST /v1/admin/staff - Create a new staff member
   */
  fastify.post<{
    Body: {
      name: string;
      role: 'STAFF' | 'ADMIN';
      pin: string;
      active?: boolean;
    };
  }>(
    '/v1/admin/staff',
    {
      preHandler: [requireAuth, requireAdmin],
    },
    async (request, reply) => {
      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const CreateStaffSchema = z.object({
        name: z.string().min(1),
        role: z.enum(['STAFF', 'ADMIN']),
        pin: z.string().regex(/^\d{6}$/, 'PIN must be exactly 6 digits'),
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
    }
  );

  /**
   * PATCH /v1/admin/staff/:id - Update a staff member
   */
  fastify.patch<{
    Params: { id: string };
    Body: {
      name?: string;
      role?: 'STAFF' | 'ADMIN';
      active?: boolean;
    };
  }>(
    '/v1/admin/staff/:id',
    {
      preHandler: [requireAuth, requireAdmin],
    },
    async (request, reply) => {
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
        const action =
          body.active !== undefined
            ? body.active
              ? 'STAFF_ACTIVATED'
              : 'STAFF_DEACTIVATED'
            : 'STAFF_UPDATED';

        await query(
          `INSERT INTO audit_log (staff_id, action, entity_type, entity_id, new_value)
         VALUES ($1, $2, 'staff', $3, $4)`,
          [request.staff.staffId, action, staff.id, JSON.stringify(body)]
        );

        return reply.send(staff);
      } catch (error) {
        request.log.error(error, 'Failed to update staff');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * POST /v1/admin/staff/:id/pin-reset - Reset a staff member's PIN
   *
   * Requires re-authentication for security.
   */
  fastify.post<{
    Params: { id: string };
    Body: { newPin: string };
  }>(
    '/v1/admin/staff/:id/pin-reset',
    {
      preHandler: [requireReauthForAdmin],
    },
    async (request, reply) => {
      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const PinResetSchema = z.object({
        newPin: z.string().regex(/^\d{6}$/, 'PIN must be exactly 6 digits'),
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
    }
  );

  /**
   * GET /v1/admin/register-sessions
   *
   * Returns array with exactly two entries (Register 1 and Register 2).
   * Shows current status, employee info, device, and heartbeat data.
   */
  fastify.get(
    '/v1/admin/register-sessions',
    {
      preHandler: [requireAuth, requireAdmin],
    },
    async (request, reply) => {
      try {
        // Get active sessions for both registers
        const activeSessions = await query<{
          id: string;
          employee_id: string;
          device_id: string;
          register_number: number;
          created_at: Date;
          last_heartbeat: Date;
          employee_name: string;
          employee_role: string;
        }>(
          `SELECT 
          rs.id,
          rs.employee_id,
          rs.device_id,
          rs.register_number,
          rs.created_at,
          rs.last_heartbeat,
          s.name as employee_name,
          s.role as employee_role
        FROM register_sessions rs
        JOIN staff s ON s.id = rs.employee_id
        WHERE rs.signed_out_at IS NULL
        ORDER BY rs.register_number`
        );

        // Build result array with exactly 2 entries
        const result: Array<{
          registerNumber: 1 | 2;
          active: boolean;
          sessionId: string | null;
          employee: {
            id: string;
            displayName: string;
            role: string;
          } | null;
          deviceId: string | null;
          createdAt: string | null;
          lastHeartbeatAt: string | null;
          secondsSinceHeartbeat: number | null;
        }> = [];

        for (let regNum = 1; regNum <= 2; regNum++) {
          const session = activeSessions.rows.find((s) => s.register_number === regNum);
          if (session) {
            const now = new Date();
            const heartbeatTime = new Date(session.last_heartbeat);
            const secondsSinceHeartbeat = Math.floor(
              (now.getTime() - heartbeatTime.getTime()) / 1000
            );

            result.push({
              registerNumber: regNum as 1 | 2,
              active: true,
              sessionId: session.id,
              employee: {
                id: session.employee_id,
                displayName: session.employee_name,
                role: session.employee_role,
              },
              deviceId: session.device_id,
              createdAt: session.created_at.toISOString(),
              lastHeartbeatAt: session.last_heartbeat.toISOString(),
              secondsSinceHeartbeat,
            });
          } else {
            result.push({
              registerNumber: regNum as 1 | 2,
              active: false,
              sessionId: null,
              employee: null,
              deviceId: null,
              createdAt: null,
              lastHeartbeatAt: null,
              secondsSinceHeartbeat: null,
            });
          }
        }

        return reply.send(result);
      } catch (error) {
        request.log.error(error, 'Failed to fetch register sessions');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * POST /v1/admin/register-sessions/:registerNumber/force-signout
   *
   * Forces sign-out of active session for specified register.
   * Broadcasts REGISTER_SESSION_UPDATED event.
   */
  fastify.post<{
    Params: { registerNumber: string };
  }>(
    '/v1/admin/register-sessions/:registerNumber/force-signout',
    {
      preHandler: [requireAuth, requireAdmin],
    },
    async (request, reply) => {
      const registerNumber = parseInt(request.params.registerNumber, 10);

      if (registerNumber !== 1 && registerNumber !== 2) {
        return reply.status(400).send({
          error: 'Invalid register number',
          message: 'Register number must be 1 or 2',
        });
      }

      try {
        const result = await transaction(async (client) => {
          // Find active session for this register
          const sessionResult = await client.query<{
            id: string;
            employee_id: string;
            device_id: string;
            created_at: Date;
            last_heartbeat: Date;
            employee_name: string;
            employee_role: string;
          }>(
            `SELECT 
            rs.id,
            rs.employee_id,
            rs.device_id,
            rs.created_at,
            rs.last_heartbeat,
            s.name as employee_name,
            s.role as employee_role
          FROM register_sessions rs
          JOIN staff s ON s.id = rs.employee_id
          WHERE rs.register_number = $1
          AND rs.signed_out_at IS NULL`,
            [registerNumber]
          );

          if (sessionResult.rows.length === 0) {
            return {
              ok: true,
              message: 'already signed out',
              register: {
                registerNumber: registerNumber as 1 | 2,
                active: false,
                sessionId: null,
                employee: null,
                deviceId: null,
                createdAt: null,
                lastHeartbeatAt: null,
              },
            };
          }

          const session = sessionResult.rows[0]!;

          // Sign out
          await client.query(
            `UPDATE register_sessions
           SET signed_out_at = NOW()
           WHERE id = $1`,
            [session.id]
          );

          // Log audit action
          await client.query(
            `INSERT INTO audit_log (staff_id, action, entity_type, entity_id)
           VALUES ($1, 'REGISTER_FORCE_SIGN_OUT', 'register_session', $2)`,
            [request.staff!.staffId, session.id]
          );

          // Broadcast REGISTER_SESSION_UPDATED event
          const payload = {
            registerNumber: registerNumber as 1 | 2,
            active: false,
            sessionId: null,
            employee: null,
            deviceId: null,
            createdAt: null,
            lastHeartbeatAt: null,
            reason: 'FORCED_SIGN_OUT' as const,
          };

          fastify.broadcaster.broadcastRegisterSessionUpdated(payload);

          return {
            ok: true,
            register: {
              registerNumber: registerNumber as 1 | 2,
              active: false,
              sessionId: null,
              employee: null,
              deviceId: null,
              createdAt: null,
              lastHeartbeatAt: null,
            },
          };
        });

        return reply.send(result);
      } catch (error) {
        request.log.error(error, 'Failed to force sign out register session');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * GET /v1/admin/devices
   *
   * Returns all devices (enabled and disabled).
   */
  fastify.get(
    '/v1/admin/devices',
    {
      preHandler: [requireAuth, requireAdmin],
    },
    async (request, reply) => {
      try {
        const result = await query<{
          device_id: string;
          display_name: string;
          enabled: boolean;
        }>(
          `SELECT device_id, display_name, enabled
         FROM devices
         ORDER BY created_at DESC`
        );

        return reply.send(
          result.rows.map((row) => ({
            deviceId: row.device_id,
            displayName: row.display_name,
            enabled: row.enabled,
          }))
        );
      } catch (error) {
        request.log.error(error, 'Failed to fetch devices');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * POST /v1/admin/devices
   *
   * Adds a new device.
   * Rejects if 2 enabled devices already exist.
   */
  fastify.post<{
    Body: {
      deviceId: string;
      displayName: string;
    };
  }>(
    '/v1/admin/devices',
    {
      preHandler: [requireAuth, requireAdmin],
    },
    async (request, reply) => {
      const { deviceId, displayName } = request.body;

      if (!deviceId || !displayName) {
        return reply.status(400).send({
          error: 'Validation failed',
          message: 'deviceId and displayName are required',
        });
      }

      try {
        const result = await transaction(async (client) => {
          // Check if device already exists
          const existing = await client.query(
            `SELECT device_id FROM devices WHERE device_id = $1`,
            [deviceId]
          );

          if (existing.rows.length > 0) {
            throw new Error('Device already exists');
          }

          // Insert new device (enabled by default)
          await client.query(
            `INSERT INTO devices (device_id, display_name, enabled)
           VALUES ($1, $2, true)`,
            [deviceId, displayName]
          );

          return {
            deviceId,
            displayName,
            enabled: true,
          };
        });

        return reply.send(result);
      } catch (error) {
        request.log.error(error, 'Failed to add device');
        const message = error instanceof Error ? error.message : 'Failed to add device';
        return reply.status(400).send({
          error: 'Failed to add device',
          message,
        });
      }
    }
  );

  /**
   * PATCH /v1/admin/devices/:deviceId
   *
   * Enables or disables a device.
   * If disabling an active device, force sign out its register session.
   */
  fastify.patch<{
    Params: { deviceId: string };
    Body: { enabled: boolean };
  }>(
    '/v1/admin/devices/:deviceId',
    {
      preHandler: [requireAuth, requireAdmin],
    },
    async (request, reply) => {
      const { deviceId } = request.params;
      const { enabled } = request.body;

      if (typeof enabled !== 'boolean') {
        return reply.status(400).send({
          error: 'Validation failed',
          message: 'enabled must be a boolean',
        });
      }

      try {
        const result = await transaction(async (client) => {
          // Check if device exists
          const deviceResult = await client.query<{ device_id: string; enabled: boolean }>(
            `SELECT device_id, enabled FROM devices WHERE device_id = $1`,
            [deviceId]
          );

          if (deviceResult.rows.length === 0) {
            throw new Error('Device not found');
          }

          // Devices may be auto-registered by register clients; admins can disable as needed.

          // If disabling, check for active register session and force sign out
          if (!enabled) {
            const activeSession = await client.query<{
              id: string;
              register_number: number;
            }>(
              `SELECT id, register_number
             FROM register_sessions
             WHERE device_id = $1
             AND signed_out_at IS NULL`,
              [deviceId]
            );

            if (activeSession.rows.length > 0) {
              const session = activeSession.rows[0]!;

              // Sign out
              await client.query(
                `UPDATE register_sessions
               SET signed_out_at = NOW()
               WHERE id = $1`,
                [session.id]
              );

              // Log audit action
              await client.query(
                `INSERT INTO audit_log (staff_id, action, entity_type, entity_id)
               VALUES ($1, 'REGISTER_FORCE_SIGN_OUT', 'register_session', $2)`,
                [request.staff!.staffId, session.id]
              );

              // Broadcast REGISTER_SESSION_UPDATED event
              const payload = {
                registerNumber: session.register_number as 1 | 2,
                active: false,
                sessionId: null,
                employee: null,
                deviceId: null,
                createdAt: null,
                lastHeartbeatAt: null,
                reason: 'FORCED_SIGN_OUT' as const,
              };

              fastify.broadcaster.broadcastRegisterSessionUpdated(payload);
            }
          }

          // Update device
          await client.query(`UPDATE devices SET enabled = $1 WHERE device_id = $2`, [
            enabled,
            deviceId,
          ]);

          return {
            deviceId,
            enabled,
          };
        });

        return reply.send(result);
      } catch (error) {
        request.log.error(error, 'Failed to update device');
        const message = error instanceof Error ? error.message : 'Failed to update device';
        return reply.status(400).send({
          error: 'Failed to update device',
          message,
        });
      }
    }
  );

  /**
   * GET /v1/admin/customers - Search customers (admin)
   *
   * Used by office-dashboard Customer Admin Tools.
   */
  fastify.get<{
    Querystring: {
      search?: string;
      limit?: string;
    };
  }>(
    '/v1/admin/customers',
    {
      preHandler: [requireAuth, requireAdmin],
    },
    async (request, reply) => {
      const search = (request.query.search || '').trim();
      const limit = Math.min(Math.max(parseInt(request.query.limit || '25', 10) || 25, 1), 100);

      if (search.length < 2) {
        return reply.send({ customers: [] });
      }

      try {
        const result = await query<{
          id: string;
          name: string;
          membership_number: string | null;
          primary_language: string | null;
          notes: string | null;
          past_due_balance: string | number | null;
        }>(
          `SELECT id, name, membership_number, primary_language, notes, past_due_balance
         FROM customers
         WHERE name ILIKE $1 OR membership_number ILIKE $1
         ORDER BY name ASC
         LIMIT $2`,
          [`%${search}%`, limit]
        );

        return reply.send({
          customers: result.rows.map((r) => ({
            id: r.id,
            name: r.name,
            membershipNumber: r.membership_number,
            primaryLanguage: (r.primary_language as 'EN' | 'ES' | null) || null,
            notes: r.notes,
            pastDueBalance: parseFloat(String(r.past_due_balance || 0)),
          })),
        });
      } catch (error) {
        request.log.error(error, 'Failed to search customers');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * PATCH /v1/admin/customers/:id - Update admin-controlled customer fields
   *
   * Admin-only and requires step-up re-auth (PIN or WebAuthn).
   * Supported edits (demo):
   * - notes (clear/remove)
   * - pastDueBalance (waive)
   */
  fastify.patch<{
    Params: { id: string };
    Body: {
      notes?: string | null;
      pastDueBalance?: number;
    };
  }>(
    '/v1/admin/customers/:id',
    {
      preHandler: [requireReauthForAdmin],
    },
    async (request, reply) => {
      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
      const auditStaffId = request.staff.staffId;
      const auditStaffRole = request.staff.role;

      const UpdateSchema = z
        .object({
          notes: z.string().nullable().optional(),
          pastDueBalance: z.number().min(0).optional(),
        })
        .refine((b) => b.notes !== undefined || b.pastDueBalance !== undefined, {
          message: 'At least one field is required',
        });

      let body: z.infer<typeof UpdateSchema>;
      try {
        body = UpdateSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      try {
        const result = await transaction(async (client) => {
          const existing = await client.query<{
            id: string;
            notes: string | null;
            past_due_balance: string | number | null;
            primary_language: string | null;
            name: string;
            membership_number: string | null;
          }>(
            `SELECT id, name, membership_number, primary_language, notes, past_due_balance
           FROM customers
           WHERE id = $1
           FOR UPDATE`,
            [request.params.id]
          );

          if (existing.rows.length === 0) {
            throw { statusCode: 404, message: 'Customer not found' };
          }

          const before = existing.rows[0]!;
          const updates: string[] = [];
          const params: unknown[] = [];
          let idx = 1;

          if (body.notes !== undefined) {
            const normalized = body.notes && body.notes.trim() ? body.notes : null;
            updates.push(`notes = $${idx}`);
            params.push(normalized);
            idx++;
          }

          if (body.pastDueBalance !== undefined) {
            updates.push(`past_due_balance = $${idx}`);
            params.push(body.pastDueBalance);
            idx++;
          }

          params.push(request.params.id);

          const updated = await client.query<{
            id: string;
            name: string;
            membership_number: string | null;
            primary_language: string | null;
            notes: string | null;
            past_due_balance: string | number | null;
          }>(
            `UPDATE customers
           SET ${updates.join(', ')}, updated_at = NOW()
           WHERE id = $${idx}
           RETURNING id, name, membership_number, primary_language, notes, past_due_balance`,
            params
          );

          const after = updated.rows[0]!;

          await client.query(
            `INSERT INTO audit_log (user_id, user_role, action, entity_type, entity_id, old_value, new_value)
           VALUES ($1, $2, 'UPDATE', 'customer', $3, $4, $5)`,
            [
              auditStaffId,
              auditStaffRole,
              request.params.id,
              JSON.stringify({
                notes: before.notes,
                pastDueBalance: parseFloat(String(before.past_due_balance || 0)),
              }),
              JSON.stringify({
                notes: after.notes,
                pastDueBalance: parseFloat(String(after.past_due_balance || 0)),
              }),
            ]
          );

          return after;
        });

        return reply.send({
          id: result.id,
          name: result.name,
          membershipNumber: result.membership_number,
          primaryLanguage: (result.primary_language as 'EN' | 'ES' | null) || null,
          notes: result.notes,
          pastDueBalance: parseFloat(String(result.past_due_balance || 0)),
        });
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const statusCode = (error as { statusCode: number }).statusCode;
          const message = (error as { message?: string }).message;
          return reply.status(statusCode).send({
            error: message ?? 'Failed to update customer',
          });
        }
        request.log.error(error, 'Failed to update customer');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * GET /v1/admin/reports/cash-totals - Demo cash totals for today
   *
   * Uses payment_intents marked PAID today; groups by payment_method and register_number.
   */
  fastify.get(
    '/v1/admin/reports/cash-totals',
    {
      preHandler: [requireAuth, requireAdmin],
    },
    async (request, reply) => {
      try {
        const totals = await query<{ total: string | null }>(
          `SELECT COALESCE(SUM(amount), 0)::numeric(10,2) as total
         FROM payment_intents
         WHERE status = 'PAID'
           AND paid_at >= date_trunc('day', NOW())
           AND paid_at <  date_trunc('day', NOW()) + INTERVAL '1 day'`
        );

        const byMethod = await query<{ payment_method: string | null; total: string | null }>(
          `SELECT payment_method, COALESCE(SUM(amount), 0)::numeric(10,2) as total
         FROM payment_intents
         WHERE status = 'PAID'
           AND paid_at >= date_trunc('day', NOW())
           AND paid_at <  date_trunc('day', NOW()) + INTERVAL '1 day'
         GROUP BY payment_method`
        );

        const byRegister = await query<{ register_number: number | null; total: string | null }>(
          `SELECT register_number, COALESCE(SUM(amount), 0)::numeric(10,2) as total
         FROM payment_intents
         WHERE status = 'PAID'
           AND paid_at >= date_trunc('day', NOW())
           AND paid_at <  date_trunc('day', NOW()) + INTERVAL '1 day'
         GROUP BY register_number
         ORDER BY register_number NULLS LAST`
        );

        const byPaymentMethod: Record<string, number> = {};
        for (const row of byMethod.rows) {
          const key = row.payment_method || 'UNKNOWN';
          byPaymentMethod[key] = parseFloat(String(row.total || 0));
        }

        const byRegisterOut: Record<string, number> = {};
        for (const row of byRegister.rows) {
          const key = row.register_number ? `Register ${row.register_number}` : 'Unassigned';
          byRegisterOut[key] = parseFloat(String(row.total || 0));
        }

        // Ensure stable keys for the demo UI
        byPaymentMethod.CASH ??= 0;
        byPaymentMethod.CREDIT ??= 0;
        byRegisterOut['Register 1'] ??= 0;
        byRegisterOut['Register 2'] ??= 0;

        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');

        return reply.send({
          date: `${yyyy}-${mm}-${dd}`,
          total: parseFloat(String(totals.rows[0]?.total || 0)),
          byPaymentMethod,
          byRegister: byRegisterOut,
        });
      } catch (error) {
        request.log.error(error, 'Failed to build cash totals');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
