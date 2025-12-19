import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../db/index.js';

export interface StaffSession {
  staffId: string;
  name: string;
  role: 'STAFF' | 'ADMIN';
}

declare module 'fastify' {
  interface FastifyRequest {
    staff?: StaffSession;
  }
}

/**
 * Middleware to require authentication.
 * Extracts session token from Authorization header and validates it.
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({
      error: 'Unauthorized',
      message: 'Missing or invalid authorization header',
    });
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix

  try {
    // Look up session in database
    const sessionResult = await query<{
      staff_id: string;
      name: string;
      role: string;
      revoked_at: string | null;
      expires_at: string;
    }>(
      `SELECT s.staff_id, st.name, st.role, s.revoked_at, s.expires_at
       FROM staff_sessions s
       JOIN staff st ON s.staff_id = st.id
       WHERE s.session_token = $1
       AND s.revoked_at IS NULL
       AND st.active = true`,
      [token]
    );

    if (sessionResult.rows.length === 0) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Invalid or expired session token',
      });
    }

    const session = sessionResult.rows[0]!;
    
    // Check if session has expired
    const expiresAt = new Date(session.expires_at);
    if (expiresAt < new Date()) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Session has expired',
      });
    }

    // Attach staff info to request
    request.staff = {
      staffId: session.staff_id,
      name: session.name,
      role: session.role as 'STAFF' | 'ADMIN',
    };
  } catch (error) {
    request.log.error(error, 'Error validating session token');
    return reply.status(500).send({
      error: 'Internal Server Error',
      message: 'Failed to validate session',
    });
  }
}

/**
 * Middleware to require admin role.
 * Must be used after requireAuth.
 */
export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!request.staff) {
    return reply.status(401).send({
      error: 'Unauthorized',
      message: 'Authentication required',
    });
  }

  if (request.staff.role !== 'ADMIN') {
    return reply.status(403).send({
      error: 'Forbidden',
      message: 'Admin role required',
    });
  }
}

/**
 * Register authentication middleware as a Fastify hook.
 */
export function registerAuthMiddleware(fastify: FastifyInstance): void {
  // This will be used as a preHandler on specific routes
  // No global hook needed - we'll apply it per-route
}

