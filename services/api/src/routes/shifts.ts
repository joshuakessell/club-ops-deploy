import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { query, transaction } from '../db/index.js';
import { requireAuth, requireAdmin } from '../auth/middleware.js';
import { computeCompliance } from '../services/compliance.js';

interface ShiftRow {
  id: string;
  employee_id: string;
  starts_at: Date;
  ends_at: Date;
  shift_code: string;
  status: string;
  notes: string | null;
  created_by: string | null;
  updated_by: string | null;
  employee_name: string;
}

const UpdateShiftSchema = z.object({
  starts_at: z.string().datetime().optional(),
  ends_at: z.string().datetime().optional(),
  employee_id: z.string().uuid().optional(),
  status: z.enum(['SCHEDULED', 'UPDATED', 'CANCELED']).optional(),
  notes: z.string().optional().nullable(),
  shift_code: z.enum(['A', 'B', 'C']).optional(),
});

/**
 * Shifts management routes.
 */
export async function shiftsRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /v1/admin/shifts
   * 
   * Returns scheduled shifts with computed compliance metrics.
   */
  fastify.get('/v1/admin/shifts', {
    preHandler: [requireAuth, requireAdmin],
  }, async (
    request: FastifyRequest<{
      Querystring: {
        from?: string;
        to?: string;
        employeeId?: string;
      };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { from, to, employeeId } = request.query;

      let queryStr = `
        SELECT 
          es.id,
          es.employee_id,
          es.starts_at,
          es.ends_at,
          es.shift_code,
          es.status,
          es.notes,
          es.created_by,
          es.updated_by,
          s.name as employee_name
        FROM employee_shifts es
        JOIN staff s ON s.id = es.employee_id
        WHERE 1=1
      `;
      const params: unknown[] = [];
      let paramCount = 0;

      if (from) {
        paramCount++;
        queryStr += ` AND es.starts_at >= $${paramCount}`;
        params.push(from);
      }

      if (to) {
        paramCount++;
        queryStr += ` AND es.ends_at <= $${paramCount}`;
        params.push(to);
      }

      if (employeeId) {
        paramCount++;
        queryStr += ` AND es.employee_id = $${paramCount}`;
        params.push(employeeId);
      }

      queryStr += ` ORDER BY es.starts_at ASC`;

      const shifts = await query<ShiftRow>(queryStr, params);

      // Compute compliance for each shift
      const results = await Promise.all(
        shifts.rows.map(async (shift) => {
          const compliance = await computeCompliance(shift, shift.employee_id);

          return {
            id: shift.id,
            employeeId: shift.employee_id,
            employeeName: shift.employee_name,
            shiftCode: shift.shift_code as 'A' | 'B' | 'C',
            scheduledStart: shift.starts_at.toISOString(),
            scheduledEnd: shift.ends_at.toISOString(),
            actualClockIn: compliance.actualClockIn?.toISOString() || null,
            actualClockOut: compliance.actualClockOut?.toISOString() || null,
            workedMinutesInWindow: compliance.workedMinutesInWindow,
            scheduledMinutes: compliance.scheduledMinutes,
            compliancePercent: compliance.compliancePercent,
            flags: compliance.flags,
            status: shift.status,
            notes: shift.notes,
          };
        })
      );

      return reply.send(results);
    } catch (error) {
      request.log.error(error, 'Failed to fetch shifts');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * PATCH /v1/admin/shifts/:shiftId
   * 
   * Updates a shift. Writes audit log entry.
   */
  fastify.patch('/v1/admin/shifts/:shiftId', {
    preHandler: [requireAuth, requireAdmin],
  }, async (
    request: FastifyRequest<{
      Params: { shiftId: string };
      Body: z.infer<typeof UpdateShiftSchema>;
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { shiftId } = request.params;
      const body = UpdateShiftSchema.parse(request.body);

      const result = await transaction(async (client) => {
        // Get current shift
        const currentShift = await client.query<ShiftRow>(
          `SELECT * FROM employee_shifts WHERE id = $1`,
          [shiftId]
        );

        if (currentShift.rows.length === 0) {
          throw new Error('Shift not found');
        }

        // Build update query
        const updates: string[] = [];
        const params: unknown[] = [];
        let paramCount = 1;

        if (body.starts_at !== undefined) {
          updates.push(`starts_at = $${paramCount}`);
          params.push(body.starts_at);
          paramCount++;
        }

        if (body.ends_at !== undefined) {
          updates.push(`ends_at = $${paramCount}`);
          params.push(body.ends_at);
          paramCount++;
        }

        if (body.employee_id !== undefined) {
          updates.push(`employee_id = $${paramCount}`);
          params.push(body.employee_id);
          paramCount++;
        }

        if (body.status !== undefined) {
          updates.push(`status = $${paramCount}`);
          params.push(body.status);
          paramCount++;
        }

        if (body.notes !== undefined) {
          updates.push(`notes = $${paramCount}`);
          params.push(body.notes);
          paramCount++;
        }

        if (body.shift_code !== undefined) {
          updates.push(`shift_code = $${paramCount}`);
          params.push(body.shift_code);
          paramCount++;
        }

        if (updates.length === 0) {
          throw new Error('No fields to update');
        }

        // Mark as UPDATED if status not explicitly set
        if (body.status === undefined) {
          updates.push(`status = 'UPDATED'`);
        }

        updates.push(`updated_by = $${paramCount}`);
        params.push(request.staff!.staffId);
        paramCount++;

        updates.push(`updated_at = NOW()`);

        params.push(shiftId);

        await client.query(
          `UPDATE employee_shifts 
           SET ${updates.join(', ')}
           WHERE id = $${paramCount}`,
          params
        );

        // Write audit log
        await client.query(
          `INSERT INTO audit_log (staff_id, action, entity_type, entity_id)
           VALUES ($1, 'SHIFT_UPDATED', 'employee_shift', $2)`,
          [request.staff!.staffId, shiftId]
        );

        // Return updated shift
        const updated = await client.query<ShiftRow>(
          `SELECT 
            es.*,
            s.name as employee_name
           FROM employee_shifts es
           JOIN staff s ON s.id = es.employee_id
           WHERE es.id = $1`,
          [shiftId]
        );

        return updated.rows[0]!;
      });

      return reply.send({
        id: result.id,
        employeeId: result.employee_id,
        employeeName: result.employee_name,
        shiftCode: result.shift_code,
        scheduledStart: result.starts_at.toISOString(),
        scheduledEnd: result.ends_at.toISOString(),
        status: result.status,
        notes: result.notes,
      });
    } catch (error) {
      request.log.error(error, 'Failed to update shift');
      const message = error instanceof Error ? error.message : 'Failed to update shift';
      return reply.status(400).send({ error: message });
    }
  });
}




