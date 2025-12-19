import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { query, transaction } from '../db/index.js';
import {
  hashQrToken,
  verifyPin,
  generateSessionToken,
  getSessionExpiry,
} from '../auth/utils.js';
import { requireAuth } from '../auth/middleware.js';

/**
 * Schema for login request.
 */
const LoginSchema = z.object({
  deviceId: z.string().min(1),
  deviceType: z.enum(['tablet', 'kiosk', 'desktop']),
  qrToken: z.string().optional(),
  pin: z.string().optional(),
}).refine(
  (data) => data.qrToken || data.pin,
  { message: 'Either qrToken or pin must be provided' }
);

type LoginInput = z.infer<typeof LoginSchema>;

interface StaffRow {
  id: string;
  name: string;
  role: string;
  qr_token_hash: string | null;
  pin_hash: string | null;
  active: boolean;
}

/**
 * Authentication routes.
 */
export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /v1/auth/login - Staff login
   * 
   * Accepts QR token or PIN for authentication.
   * Creates a session and returns session token.
   */
  fastify.post('/v1/auth/login', async (
    request: FastifyRequest<{ Body: LoginInput }>,
    reply: FastifyReply
  ) => {
    let body: LoginInput;

    try {
      body = LoginSchema.parse(request.body);
    } catch (error) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: error instanceof z.ZodError ? error.errors : 'Invalid input',
      });
    }

    try {
      const result = await transaction(async (client) => {
        // Find staff by QR token or prepare for PIN lookup
        let staffResult: { rows: StaffRow[] };

        if (body.qrToken) {
          const qrTokenHash = hashQrToken(body.qrToken);
          staffResult = await client.query<StaffRow>(
            `SELECT id, name, role, qr_token_hash, pin_hash, active
             FROM staff
             WHERE qr_token_hash = $1
             AND active = true`,
            [qrTokenHash]
          );
        } else if (body.pin) {
          // For PIN, we need to check all active staff and verify PINs
          // This is less efficient but necessary for PIN-based auth
          const allStaffResult = await client.query<StaffRow>(
            `SELECT id, name, role, qr_token_hash, pin_hash, active
             FROM staff
             WHERE pin_hash IS NOT NULL
             AND active = true`
          );

          // Try to match PIN
          let matchedStaff: StaffRow | null = null;
          for (const staff of allStaffResult.rows) {
            if (staff.pin_hash && await verifyPin(body.pin, staff.pin_hash)) {
              matchedStaff = staff;
              break;
            }
          }

          staffResult = {
            rows: matchedStaff ? [matchedStaff] : [],
          };
        } else {
          staffResult = { rows: [] };
        }

        if (staffResult.rows.length === 0) {
          return null;
        }

        const staff = staffResult.rows[0]!;

        // Generate session token
        const sessionToken = generateSessionToken();
        const expiresAt = getSessionExpiry();

        // Create session
        await client.query(
          `INSERT INTO staff_sessions (staff_id, device_id, device_type, session_token, expires_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [staff.id, body.deviceId, body.deviceType, sessionToken, expiresAt]
        );

        return {
          staffId: staff.id,
          name: staff.name,
          role: staff.role,
          sessionToken,
        };
      });

      if (!result) {
        return reply.status(401).send({
          error: 'Unauthorized',
          message: 'Invalid credentials',
        });
      }

      return reply.send(result);
    } catch (error) {
      request.log.error(error, 'Login error');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to process login',
      });
    }
  });

  /**
   * POST /v1/auth/logout - Staff logout
   * 
   * Revokes the current session token.
   */
  fastify.post('/v1/auth/logout', {
    preHandler: [requireAuth],
  }, async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({
        error: 'Unauthorized',
      });
    }

    const token = authHeader.substring(7);

    try {
      await query(
        `UPDATE staff_sessions
         SET revoked_at = NOW()
         WHERE session_token = $1
         AND revoked_at IS NULL`,
        [token]
      );

      return reply.send({ success: true });
    } catch (error) {
      request.log.error(error, 'Logout error');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to logout',
      });
    }
  });

  /**
   * GET /v1/auth/me - Get current staff identity
   * 
   * Returns the authenticated staff member's information.
   */
  fastify.get('/v1/auth/me', {
    preHandler: [requireAuth],
  }, async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    if (!request.staff) {
      return reply.status(401).send({
        error: 'Unauthorized',
      });
    }

    return reply.send({
      staffId: request.staff.staffId,
      name: request.staff.name,
      role: request.staff.role,
    });
  });
}

