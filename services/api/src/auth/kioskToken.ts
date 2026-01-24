import type { FastifyReply, FastifyRequest } from 'fastify';
import crypto from 'crypto';

function getHeader(request: FastifyRequest, name: string): string | undefined {
  const direct = (request.headers as Record<string, unknown>)[name] as string | undefined;
  if (typeof direct === 'string') return direct;
  const lower = (request.headers as Record<string, unknown>)[name.toLowerCase()] as
    | string
    | undefined;
  if (typeof lower === 'string') return lower;
  const upper = (request.headers as Record<string, unknown>)[name.toUpperCase()] as
    | string
    | undefined;
  if (typeof upper === 'string') return upper;
  return undefined;
}

function getKioskTokenFromWebSocketProtocol(request: FastifyRequest): string | undefined {
  // Browser WebSockets cannot set arbitrary headers (like `x-kiosk-token`), but they *can*
  // negotiate a subprotocol via the `Sec-WebSocket-Protocol` header.
  //
  // We accept a protocol entry shaped like: `kiosk-token.<token>`.
  // (The token should be a "token" per RFC6455; avoid spaces/commas.)
  const raw = getHeader(request, 'sec-websocket-protocol');
  if (!raw) return undefined;

  // Header is a comma-separated list of protocol names.
  const parts = raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  for (const p of parts) {
    if (p.startsWith('kiosk-token.')) {
      const token = p.slice('kiosk-token.'.length).trim();
      if (token) return token;
    }
  }

  return undefined;
}

function timingSafeEquals(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

/**
 * Kiosk authentication for kiosk-facing, state-mutating endpoints.
 *
 * Policy:
 * - If a valid staff Bearer token is present (optionalAuth already ran), allow.
 * - Else require either:
 *   - an `x-kiosk-token` header matching process.env.KIOSK_TOKEN, OR
 *   - a WebSocket subprotocol entry `kiosk-token.<token>` (via `Sec-WebSocket-Protocol`)
 *     matching process.env.KIOSK_TOKEN.
 *
 * This is a pragmatic LAN threat-model guard to prevent unauthenticated callers from mutating
 * lane session / inventory state.
 */
export async function requireKioskTokenOrStaff(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (request.staff) return;

  const expected = process.env.KIOSK_TOKEN;
  if (!expected) {
    request.log.error('KIOSK_TOKEN is not configured; refusing kiosk mutation request');
    reply.status(500).send({
      error: 'Server misconfigured',
      message: 'Kiosk token not configured',
    });
    return;
  }

  const provided =
    getHeader(request, 'x-kiosk-token') ?? getKioskTokenFromWebSocketProtocol(request);
  if (!provided || !timingSafeEquals(provided, expected)) {
    reply.status(401).send({
      error: 'Unauthorized',
      message: 'Valid kiosk token required',
    });
    return;
  }
}
