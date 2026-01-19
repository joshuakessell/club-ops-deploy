import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';

import type { WebSocketEventType } from '@club-ops/shared';

import { optionalAuth } from '../auth/middleware.js';
import { requireKioskTokenOrStaff } from '../auth/kioskToken.js';
import type { Broadcaster } from './broadcaster.js';
import { LaneIdSchema, parseLaneIdOptional } from '../utils/lane.js';

function isWebSocketEventType(value: unknown): value is WebSocketEventType {
  if (typeof value !== 'string') return false;
  switch (value) {
    case 'ROOM_STATUS_CHANGED':
    case 'INVENTORY_UPDATED':
    case 'ROOM_ASSIGNED':
    case 'ROOM_RELEASED':
    case 'SESSION_UPDATED':
    case 'SELECTION_PROPOSED':
    case 'SELECTION_FORCED':
    case 'SELECTION_LOCKED':
    case 'SELECTION_ACKNOWLEDGED':
    case 'WAITLIST_CREATED':
    case 'UPGRADE_HOLD_AVAILABLE':
    case 'UPGRADE_OFFER_EXPIRED':
    case 'ASSIGNMENT_CREATED':
    case 'ASSIGNMENT_FAILED':
    case 'CUSTOMER_CONFIRMATION_REQUIRED':
    case 'CUSTOMER_CONFIRMED':
    case 'CUSTOMER_DECLINED':
    case 'CHECKOUT_REQUESTED':
    case 'CHECKOUT_CLAIMED':
    case 'CHECKOUT_UPDATED':
    case 'CHECKOUT_COMPLETED':
    case 'WAITLIST_UPDATED':
    case 'REGISTER_SESSION_UPDATED':
      return true;
    default:
      return false;
  }
}

function getLaneFromUrl(req: FastifyRequest): string | undefined {
  const url = req.url || '';
  const urlObj = new URL(url, `http://${req.headers.host || 'localhost'}`);
  return urlObj.searchParams.get('lane') || undefined;
}

async function validateWsLaneQuery(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const lane = getLaneFromUrl(request);
  if (!lane) return;
  const parsed = LaneIdSchema.safeParse(lane);
  if (!parsed.success) {
    reply.status(400).send({
      error: 'Validation failed',
      message: parsed.error.issues[0]?.message ?? 'Invalid lane',
    });
  }
}

/**
 * Register the authenticated websocket endpoint.
 *
 * Policy:
 * - WebSockets must be authenticated (kiosk token OR staff bearer token).
 * - Lane values must be validated (format: lane-<number>).
 */
export async function registerWsRoute(
  fastify: FastifyInstance,
  broadcaster: Broadcaster
): Promise<void> {
  fastify.get(
    '/ws',
    {
      websocket: true,
      preHandler: [optionalAuth, requireKioskTokenOrStaff, validateWsLaneQuery],
    },
    (connection, req) => {
      const clientId = crypto.randomUUID();
      const socket = connection.socket as unknown as WebSocket;
      type AliveWebSocket = WebSocket & { isAlive?: boolean };
      const alive = socket as AliveWebSocket;

      const lane = parseLaneIdOptional(getLaneFromUrl(req));
      fastify.log.info({ clientId, lane }, 'WebSocket client connected');

      broadcaster.addClient(clientId, alive, lane);

      // Keepalive: send ping frames to prevent idle timeouts and detect half-open connections.
      alive.isAlive = true;
      alive.on('pong', () => {
        alive.isAlive = true;
      });

      const keepaliveInterval = setInterval(() => {
        if (alive.readyState !== alive.OPEN) return;
        if (alive.isAlive === false) {
          alive.terminate();
          broadcaster.removeClient(clientId);
          clearInterval(keepaliveInterval);
          return;
        }
        alive.isAlive = false;
        alive.ping();
      }, 30000); // 30s

      connection.on('message', (message: Buffer) => {
        try {
          const data = JSON.parse(message.toString()) as Record<string, unknown>;
          fastify.log.info({ clientId, data }, 'Received message from client');

          // Handle subscription messages
          if (data.type === 'subscribe' && Array.isArray(data.events)) {
            const events = data.events.filter(isWebSocketEventType);
            fastify.log.info({ clientId, events }, 'Client subscribed to events');
            broadcaster.subscribeClient(clientId, events);
          }

          // Handle lane update
          if (data.type === 'setLane' && typeof data.lane === 'string') {
            const parsed = LaneIdSchema.safeParse(data.lane);
            if (!parsed.success) {
              fastify.log.warn({ clientId, lane: data.lane }, 'Rejected invalid lane update');
              try {
                alive.send(JSON.stringify({ type: 'error', code: 'INVALID_LANE' }));
              } catch {
                // ignore
              }
              return;
            }
            fastify.log.info({ clientId, lane: parsed.data }, 'Client lane updated');
            broadcaster.updateClientLane(clientId, parsed.data);
          }
        } catch {
          fastify.log.warn({ clientId }, 'Received invalid JSON from client');
        }
      });

      connection.on('close', () => {
        clearInterval(keepaliveInterval);
        broadcaster.removeClient(clientId);
        fastify.log.info({ clientId }, 'WebSocket client disconnected');
      });

      connection.on('error', (err) => {
        clearInterval(keepaliveInterval);
        fastify.log.error({ clientId, err }, 'WebSocket error');
        broadcaster.removeClient(clientId);
      });
    }
  );
}

