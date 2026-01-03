import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { query, transaction } from '../db/index.js';
import { verifyPin } from '../auth/utils.js';
import { requireAuth } from '../auth/middleware.js';

/**
 * Schema for PIN verification request.
 */
const VerifyPinSchema = z.object({
  employeeId: z.string().uuid(),
  pin: z.string().regex(/^\d{6}$/, 'PIN must be exactly 6 digits'),
  deviceId: z.string().min(1),
});

type VerifyPinInput = z.infer<typeof VerifyPinSchema>;

/**
 * Schema for register assignment request.
 */
const AssignRegisterSchema = z.object({
  employeeId: z.string().uuid(),
  deviceId: z.string().min(1),
  registerNumber: z.number().int().min(1).max(2).optional(),
});

type AssignRegisterInput = z.infer<typeof AssignRegisterSchema>;

/**
 * Schema for register confirmation request.
 */
const ConfirmRegisterSchema = z.object({
  employeeId: z.string().uuid(),
  deviceId: z.string().min(1),
  registerNumber: z.number().int().min(1).max(2),
});

type ConfirmRegisterInput = z.infer<typeof ConfirmRegisterSchema>;

/**
 * Schema for heartbeat request.
 */
const HeartbeatSchema = z.object({
  deviceId: z.string().min(1),
});

type HeartbeatInput = z.infer<typeof HeartbeatSchema>;

interface EmployeeRow {
  id: string;
  name: string;
  role: string;
  pin_hash: string | null;
  active: boolean;
}

interface RegisterSessionRow {
  id: string;
  employee_id: string;
  device_id: string;
  register_number: number;
  last_heartbeat: Date;
  created_at: Date;
  signed_out_at: Date | null;
}

/**
 * Helper function to ensure a device is registered and enabled for register use.
 *
 * Behavior:
 * - If device does not exist in `devices`, auto-register it as enabled.
 * - If device exists but is disabled, throw DEVICE_DISABLED.
 */
async function ensureDeviceEnabled(deviceId: string): Promise<void> {
  const result = await query<{ enabled: boolean }>(
    `SELECT enabled FROM devices WHERE device_id = $1`,
    [deviceId]
  );

  // Auto-register unknown devices (enabled by default)
  if (result.rows.length === 0) {
    const safeSuffix = deviceId.length > 32 ? `${deviceId.slice(0, 32)}…` : deviceId;
    const displayName = `Auto-registered (${safeSuffix})`;

    await query(
      `INSERT INTO devices (device_id, display_name, enabled)
       VALUES ($1, $2, true)
       ON CONFLICT (device_id) DO NOTHING`,
      [deviceId, displayName]
    );
    return;
  }

  if (!result.rows[0]!.enabled) {
    throw new Error('DEVICE_DISABLED');
  }
}

/**
 * Register management routes.
 * Handles employee sign-in, register assignment, heartbeat, and sign-out.
 */
export async function registerRoutes(fastify: FastifyInstance & { broadcaster: any }): Promise<void> {
  /**
   * GET /v1/employees/available
   * 
   * Returns list of employees available for register sign-in.
   * Excludes employees already signed into any register.
   */
  fastify.get('/v1/employees/available', async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      // Get all active employees
      const allEmployees = await query<EmployeeRow>(
        `SELECT id, name, role, active
         FROM staff
         WHERE active = true
         ORDER BY name`
      );

      // Get employees currently signed into registers
      const signedInEmployees = await query<{ employee_id: string }>(
        `SELECT DISTINCT employee_id
         FROM register_sessions
         WHERE signed_out_at IS NULL`
      );

      const signedInIds = new Set(signedInEmployees.rows.map(r => r.employee_id));

      // Filter out signed-in employees
      const available = allEmployees.rows
        .filter(emp => !signedInIds.has(emp.id))
        .map(emp => ({
          id: emp.id,
          name: emp.name,
          role: emp.role,
        }));

      return reply.send({ employees: available });
    } catch (error) {
      request.log.error(error, 'Failed to fetch available employees');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch available employees',
      });
    }
  });

  /**
   * GET /v1/registers/availability
   *
   * Returns which register numbers (1/2) are currently occupied.
   * Used by the employee-register UI so the user can choose a register.
   */
  fastify.get('/v1/registers/availability', async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const active = await query<{
        register_number: number;
        device_id: string;
        employee_id: string;
        employee_name: string;
        employee_role: string;
      }>(
        `SELECT
           rs.register_number,
           rs.device_id,
           rs.employee_id,
           s.name as employee_name,
           s.role as employee_role
         FROM register_sessions rs
         JOIN staff s ON s.id = rs.employee_id
         WHERE rs.signed_out_at IS NULL`
      );

      const byRegister = new Map<number, (typeof active.rows)[number]>();
      for (const row of active.rows) {
        byRegister.set(row.register_number, row);
      }

      const registers = [1, 2].map((num) => {
        const row = byRegister.get(num);
        if (!row) {
          return { registerNumber: num as 1 | 2, occupied: false };
        }
        return {
          registerNumber: num as 1 | 2,
          occupied: true,
          deviceId: row.device_id,
          employee: {
            id: row.employee_id,
            name: row.employee_name,
            role: row.employee_role,
          },
        };
      });

      return reply.send({ registers });
    } catch (error) {
      request.log.error(error, 'Failed to fetch register availability');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch register availability',
      });
    }
  });

  /**
   * POST /v1/auth/verify-pin
   * 
   * Verifies employee PIN without creating a session.
   * Used in the sign-in flow before register assignment.
   */
  fastify.post('/v1/auth/verify-pin', async (
    request: FastifyRequest<{ Body: VerifyPinInput }>,
    reply: FastifyReply
  ) => {
    let body: VerifyPinInput;

    try {
      body = VerifyPinSchema.parse(request.body);
    } catch (error) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: error instanceof z.ZodError ? error.errors : 'Invalid input',
      });
    }

    try {
      // Check device is enabled
      try {
        await ensureDeviceEnabled(body.deviceId);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Device check failed';
        if (message === 'DEVICE_DISABLED') {
          return reply.status(403).send({
            error: 'Device not allowed',
            code: 'DEVICE_DISABLED',
            message: 'This device is not enabled for register use',
          });
        }
        throw err;
      }
      const result = await query<EmployeeRow>(
        `SELECT id, name, role, pin_hash, active
         FROM staff
         WHERE id = $1
         AND pin_hash IS NOT NULL
         AND active = true
         LIMIT 1`,
        [body.employeeId]
      );

      if (result.rows.length === 0) {
        return reply.status(401).send({
          error: 'Unauthorized',
          message: 'Employee not found or inactive',
        });
      }

      const employee = result.rows[0]!;

      // Verify PIN
      if (!employee.pin_hash || !(await verifyPin(body.pin, employee.pin_hash))) {
        return reply.status(401).send({
          error: 'Unauthorized',
          message: 'Wrong PIN',
        });
      }

      return reply.send({
        verified: true,
        employee: {
          id: employee.id,
          name: employee.name,
          role: employee.role,
        },
      });
    } catch (error) {
      request.log.error(error, 'PIN verification error');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to verify PIN',
      });
    }
  });

  /**
   * POST /v1/registers/assign
   * 
   * Assigns a register to an employee.
   * If registerNumber is not provided, automatically assigns the remaining register.
   * Returns the assigned register number and requires confirmation.
   */
  fastify.post('/v1/registers/assign', async (
    request: FastifyRequest<{ Body: AssignRegisterInput }>,
    reply: FastifyReply
  ) => {
    let body: AssignRegisterInput;

    try {
      body = AssignRegisterSchema.parse(request.body);
    } catch (error) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: error instanceof z.ZodError ? error.errors : 'Invalid input',
      });
    }

    try {
      // Check device is enabled
      try {
        await ensureDeviceEnabled(body.deviceId);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Device check failed';
        if (message === 'DEVICE_DISABLED') {
          return reply.status(403).send({
            error: 'Device not allowed',
            code: 'DEVICE_DISABLED',
            message: 'This device is not enabled for register use',
          });
        }
        throw err;
      }

      const result = await transaction(async (client) => {
        // Check if employee is already signed in
        const existingSession = await client.query<RegisterSessionRow>(
          `SELECT * FROM register_sessions
           WHERE employee_id = $1
           AND signed_out_at IS NULL`,
          [body.employeeId]
        );

        if (existingSession.rows.length > 0) {
          throw new Error('Employee already signed into a register');
        }

        // Check if device is already signed in
        const existingDevice = await client.query<RegisterSessionRow>(
          `SELECT * FROM register_sessions
           WHERE device_id = $1
           AND signed_out_at IS NULL`,
          [body.deviceId]
        );

        if (existingDevice.rows.length > 0) {
          throw new Error('Device already signed into a register');
        }

        // Get currently occupied registers
        const occupiedRegisters = await client.query<{ register_number: number }>(
          `SELECT register_number FROM register_sessions
           WHERE signed_out_at IS NULL`
        );

        const occupiedNumbers = new Set(occupiedRegisters.rows.map(r => r.register_number));

        let registerNumber: number;

        if (body.registerNumber) {
          // Check if requested register is available
          if (occupiedNumbers.has(body.registerNumber)) {
            throw new Error(`Register ${body.registerNumber} is already occupied`);
          }
          registerNumber = body.registerNumber;
        } else {
          // Auto-assign remaining register
          if (occupiedNumbers.size >= 2) {
            throw new Error('All registers are occupied');
          }
          // Assign register 1 if available, otherwise register 2
          registerNumber = occupiedNumbers.has(1) ? 2 : 1;
        }

        return {
          registerNumber,
          requiresConfirmation: true,
        };
      });

      return reply.send(result);
    } catch (error) {
      request.log.error(error, 'Register assignment error');
      const message = error instanceof Error ? error.message : 'Failed to assign register';
      return reply.status(400).send({
        error: 'Assignment failed',
        message,
      });
    }
  });

  /**
   * POST /v1/registers/confirm
   * 
   * Confirms and locks register assignment.
   * Creates the register session and enforces uniqueness constraints.
   */
  fastify.post('/v1/registers/confirm', async (
    request: FastifyRequest<{ Body: ConfirmRegisterInput }>,
    reply: FastifyReply
  ) => {
    let body: ConfirmRegisterInput;

    try {
      body = ConfirmRegisterSchema.parse(request.body);
    } catch (error) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: error instanceof z.ZodError ? error.errors : 'Invalid input',
      });
    }

    try {
      // Check device is enabled
      try {
        await ensureDeviceEnabled(body.deviceId);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Device check failed';
        if (message === 'DEVICE_DISABLED') {
          return reply.status(403).send({
            error: 'Device not allowed',
            code: 'DEVICE_DISABLED',
            message: 'This device is not enabled for register use',
          });
        }
        throw err;
      }

      const result = await transaction(async (client) => {
        // Double-check constraints before inserting
        const existingEmployee = await client.query<RegisterSessionRow>(
          `SELECT * FROM register_sessions
           WHERE employee_id = $1
           AND signed_out_at IS NULL`,
          [body.employeeId]
        );

        if (existingEmployee.rows.length > 0) {
          throw new Error('Employee already signed into a register');
        }

        const existingDevice = await client.query<RegisterSessionRow>(
          `SELECT * FROM register_sessions
           WHERE device_id = $1
           AND signed_out_at IS NULL`,
          [body.deviceId]
        );

        if (existingDevice.rows.length > 0) {
          throw new Error('Device already signed into a register');
        }

        const existingRegister = await client.query<RegisterSessionRow>(
          `SELECT * FROM register_sessions
           WHERE register_number = $1
           AND signed_out_at IS NULL`,
          [body.registerNumber]
        );

        if (existingRegister.rows.length > 0) {
          throw new Error(`Register ${body.registerNumber} is already occupied`);
        }

        // Create register session
        const sessionResult = await client.query<RegisterSessionRow>(
          `INSERT INTO register_sessions (employee_id, device_id, register_number, last_heartbeat)
           VALUES ($1, $2, $3, NOW())
           RETURNING *`,
          [body.employeeId, body.deviceId, body.registerNumber]
        );

        const session = sessionResult.rows[0]!;

        // Create or update timeclock session for register sign-in
        const now = new Date();
        // Find nearest scheduled shift
        const shiftResult = await client.query<{
          id: string;
          starts_at: Date;
          ends_at: Date;
        }>(
          `SELECT id, starts_at, ends_at
           FROM employee_shifts
           WHERE employee_id = $1
           AND status != 'CANCELED'
           AND (
             (starts_at <= $2 AND ends_at >= $2)
             OR (starts_at > $2 AND starts_at <= $2 + INTERVAL '60 minutes')
           )
           ORDER BY ABS(EXTRACT(EPOCH FROM (starts_at - $2::timestamp)))
           LIMIT 1`,
          [body.employeeId, now]
        );

        const shiftId = shiftResult.rows.length > 0 ? shiftResult.rows[0]!.id : null;

        // Check if employee already has an open timeclock session
        const existingTimeclock = await client.query<{ id: string }>(
          `SELECT id FROM timeclock_sessions
           WHERE employee_id = $1 AND clock_out_at IS NULL`,
          [body.employeeId]
        );

        if (existingTimeclock.rows.length === 0) {
          // Create new timeclock session
          await client.query(
            `INSERT INTO timeclock_sessions 
             (employee_id, shift_id, clock_in_at, source, notes)
             VALUES ($1, $2, $3, 'EMPLOYEE_REGISTER', NULL)`,
            [body.employeeId, shiftId, now]
          );
        } else {
          // Update existing session to attach shift if not already attached
          if (shiftId) {
            await client.query(
              `UPDATE timeclock_sessions
               SET shift_id = $1
               WHERE id = $2 AND shift_id IS NULL`,
              [shiftId, existingTimeclock.rows[0]!.id]
            );
          }
        }

        // Get employee info
        const employeeResult = await client.query<EmployeeRow>(
          `SELECT id, name, role FROM staff WHERE id = $1`,
          [body.employeeId]
        );

        const employee = employeeResult.rows[0]!;

        // Log audit action
        await client.query(
          `INSERT INTO audit_log (staff_id, action, entity_type, entity_id)
           VALUES ($1, 'REGISTER_SIGN_IN', 'register_session', $2)`,
          [body.employeeId, session.id]
        );

        // Broadcast REGISTER_SESSION_UPDATED event
        const payload = {
          registerNumber: session.register_number as 1 | 2,
          active: true,
          sessionId: session.id,
          employee: {
            id: employee.id,
            displayName: employee.name,
            role: employee.role,
          },
          deviceId: session.device_id,
          createdAt: session.created_at.toISOString(),
          lastHeartbeatAt: session.last_heartbeat.toISOString(),
          reason: 'CONFIRMED' as const,
        };

        fastify.broadcaster.broadcastRegisterSessionUpdated(payload);

        return {
          sessionId: session.id,
          employee: {
            id: employee.id,
            name: employee.name,
            role: employee.role,
          },
          registerNumber: session.register_number,
          deviceId: session.device_id,
        };
      });

      return reply.send(result);
    } catch (error) {
      request.log.error(error, 'Register confirmation error');
      const message = error instanceof Error ? error.message : 'Failed to confirm register assignment';
      return reply.status(400).send({
        error: 'Confirmation failed',
        message,
      });
    }
  });

  /**
   * POST /v1/registers/heartbeat
   * 
   * Updates the last_heartbeat timestamp for a register session.
   * Used to keep sessions alive and detect abandoned sessions.
   */
  fastify.post('/v1/registers/heartbeat', async (
    request: FastifyRequest<{ Body: HeartbeatInput }>,
    reply: FastifyReply
  ) => {
    let body: HeartbeatInput;

    try {
      body = HeartbeatSchema.parse(request.body);
    } catch (error) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: error instanceof z.ZodError ? error.errors : 'Invalid input',
      });
    }

    try {
      // Check device is enabled
      try {
        await ensureDeviceEnabled(body.deviceId);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Device check failed';
        if (message === 'DEVICE_DISABLED') {
          return reply.status(403).send({
            error: 'Device not allowed',
            code: 'DEVICE_DISABLED',
            message: 'This device is not enabled for register use',
          });
        }
        throw err;
      }

      const result = await query<RegisterSessionRow>(
        `UPDATE register_sessions
         SET last_heartbeat = NOW()
         WHERE device_id = $1
         AND signed_out_at IS NULL
         RETURNING *`,
        [body.deviceId]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'No active register session found for this device',
        });
      }

      return reply.send({
        success: true,
        lastHeartbeat: result.rows[0]!.last_heartbeat.toISOString(),
      });
    } catch (error) {
      request.log.error(error, 'Heartbeat error');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to update heartbeat',
      });
    }
  });

  /**
   * POST /v1/registers/signout
   * 
   * Signs out an employee from their register.
   * Requires authentication (session token).
   */
  fastify.post<{ Body: { deviceId: string } }>('/v1/registers/signout', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const staff = request.staff;
    if (!staff) {
      return reply.status(401).send({
        error: 'Unauthorized',
      });
    }

    const deviceId = request.body.deviceId;

    if (!deviceId) {
      return reply.status(400).send({
        error: 'Validation failed',
        message: 'deviceId is required',
      });
    }

    try {
      const result = await transaction(async (client) => {
        // Find active register session for this device
        const sessionResult = await client.query<RegisterSessionRow>(
          `SELECT * FROM register_sessions
           WHERE device_id = $1
           AND signed_out_at IS NULL`,
          [deviceId]
        );

        if (sessionResult.rows.length === 0) {
          throw new Error('No active register session found');
        }

        const session = sessionResult.rows[0]!;

        // Verify employee matches (security check)
        if (session.employee_id !== staff.staffId) {
          throw new Error('Register session does not belong to authenticated employee');
        }

                    // Sign out
                    await client.query(
                      `UPDATE register_sessions
                       SET signed_out_at = NOW()
                       WHERE id = $1`,
                      [session.id]
                    );

                    // Close timeclock session if employee is no longer signed into any register or cleaning station
                    // Check if employee has any other active sessions (register or staff_sessions for cleaning)
                    const otherRegisterSession = await client.query<{ count: string }>(
                      `SELECT COUNT(*) as count FROM register_sessions
                       WHERE employee_id = $1 AND signed_out_at IS NULL`,
                      [session.employee_id]
                    );

                    const otherStaffSession = await client.query<{ count: string }>(
                      `SELECT COUNT(*) as count FROM staff_sessions
                       WHERE staff_id = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
                      [session.employee_id]
                    );

                    // Only close timeclock if no other active sessions
                    if (
                      parseInt(otherRegisterSession.rows[0]?.count || '0', 10) === 0 &&
                      parseInt(otherStaffSession.rows[0]?.count || '0', 10) === 0
                    ) {
                      await client.query(
                        `UPDATE timeclock_sessions
                         SET clock_out_at = NOW()
                         WHERE employee_id = $1 AND clock_out_at IS NULL`,
                        [session.employee_id]
                      );
                    }

        // Log audit action
        await client.query(
          `INSERT INTO audit_log (staff_id, action, entity_type, entity_id)
           VALUES ($1, 'REGISTER_SIGN_OUT', 'register_session', $2)`,
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
          reason: 'SIGNED_OUT' as const,
        };

        fastify.broadcaster.broadcastRegisterSessionUpdated(payload);

        return {
          success: true,
          sessionId: session.id,
        };
      });

      return reply.send(result);
    } catch (error) {
      request.log.error(error, 'Sign out error');
      const message = error instanceof Error ? error.message : 'Failed to sign out';
      return reply.status(400).send({
        error: 'Sign out failed',
        message,
      });
    }
  });

  /**
   * GET /v1/registers/status
   * 
   * Returns the current register session status for a device.
   * Used to check if device is already signed in.
   */
  fastify.get('/v1/registers/status', async (
    request: FastifyRequest<{ Querystring: { deviceId: string } }>,
    reply: FastifyReply
  ) => {
    const deviceId = request.query.deviceId;

    if (!deviceId) {
      return reply.status(400).send({
        error: 'Validation failed',
        message: 'deviceId query parameter is required',
      });
    }

    try {
      // Auto-register device on first contact; reject only if explicitly disabled
      try {
        await ensureDeviceEnabled(deviceId);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Device check failed';
        if (message === 'DEVICE_DISABLED') {
          return reply.status(403).send({
            error: 'Device not allowed',
            code: 'DEVICE_DISABLED',
            message: 'This device is not enabled for register use',
          });
        }
        throw err;
      }

      const result = await query<RegisterSessionRow & { employee_name: string; employee_role: string }>(
        `SELECT 
           rs.*,
           s.name as employee_name,
           s.role as employee_role
         FROM register_sessions rs
         JOIN staff s ON s.id = rs.employee_id
         WHERE rs.device_id = $1
         AND rs.signed_out_at IS NULL`,
        [deviceId]
      );

      if (result.rows.length === 0) {
        return reply.send({
          signedIn: false,
        });
      }

      const session = result.rows[0]!;

      return reply.send({
        signedIn: true,
        sessionId: session.id,
        employee: {
          id: session.employee_id,
          name: session.employee_name,
          role: session.employee_role,
        },
        registerNumber: session.register_number,
        lastHeartbeat: session.last_heartbeat.toISOString(),
      });
    } catch (error) {
      request.log.error(error, 'Failed to fetch register status');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch register status',
      });
    }
  });
}

/**
 * Clean up abandoned register sessions (no heartbeat for > 90 seconds).
 * Should be called periodically (e.g., every 30 seconds).
 * Broadcasts REGISTER_SESSION_UPDATED events for expired sessions.
 */
export async function cleanupAbandonedRegisterSessions(fastify?: FastifyInstance & { broadcaster: any }): Promise<number> {
  try {
    // Get sessions that will be expired
    const expiredSessions = await query<{
      id: string;
      register_number: number;
    }>(
      `SELECT id, register_number
       FROM register_sessions
       WHERE signed_out_at IS NULL
       AND last_heartbeat < NOW() - INTERVAL '90 seconds'`
    );

    if (expiredSessions.rows.length === 0) {
      return 0;
    }

    // Sign them out
    const result = await query(
      `UPDATE register_sessions
       SET signed_out_at = NOW()
       WHERE signed_out_at IS NULL
       AND last_heartbeat < NOW() - INTERVAL '90 seconds'`
    );

    // Broadcast events if broadcaster available
    if (fastify?.broadcaster) {
      for (const session of expiredSessions.rows) {
        const payload = {
          registerNumber: session.register_number as 1 | 2,
          active: false,
          sessionId: null,
          employee: null,
          deviceId: null,
          createdAt: null,
          lastHeartbeatAt: null,
          reason: 'TTL_EXPIRED' as const,
        };
        fastify.broadcaster.broadcastRegisterSessionUpdated(payload);
      }
    }

    return result.rowCount || 0;
  } catch (error) {
    console.error('Failed to cleanup abandoned register sessions:', error);
    return 0;
  }
}

