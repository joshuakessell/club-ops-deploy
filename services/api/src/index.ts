import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';

import {
  healthRoutes,
  authRoutes,
  webauthnRoutes,
  customerRoutes,
  sessionRoutes,
  laneRoutes,
  inventoryRoutes,
  roomsRoutes,
  keysRoutes,
  cleaningRoutes,
  adminRoutes,
  agreementRoutes,
  upgradeRoutes,
  waitlistRoutes,
  metricsRoutes,
  visitRoutes,
  checkoutRoutes,
  checkinRoutes,
  registerRoutes,
  shiftsRoutes,
  timeclockRoutes,
  documentsRoutes,
  sessionDocumentsRoutes,
  scheduleRoutes,
  timeoffRoutes,
} from './routes/index.js';
import { createBroadcaster, type Broadcaster } from './websocket/broadcaster.js';
import { initializeDatabase, closeDatabase } from './db/index.js';
import { cleanupAbandonedRegisterSessions } from './routes/registers.js';
import { seedDemoData } from './db/seed-demo.js';
import type { WebSocketEventType } from '@club-ops/shared';
import { expireWaitlistEntries } from './waitlist/expireWaitlist.js';
import { processUpgradeHoldsTick } from './waitlist/upgradeHolds.js';
import { setupTelemetry } from './telemetry/plugin.js';

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';
const SKIP_DB = process.env.SKIP_DB === 'true';
const SEED_ON_STARTUP = process.env.SEED_ON_STARTUP === 'true';

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

// Augment FastifyInstance with broadcaster
declare module 'fastify' {
  interface FastifyInstance {
    broadcaster: Broadcaster;
  }
}

async function main() {
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      transport: {
        target: 'pino-pretty',
        options: {
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      },
    },
  });

  // Telemetry: requestId correlation, ingestion endpoint, backend error capture.
  await setupTelemetry(fastify);

  // Register CORS
  await fastify.register(cors, {
    origin: true,
    credentials: true,
  });

  // Register WebSocket support
  await fastify.register(websocket);

  // Create broadcaster for WebSocket events
  const broadcaster = createBroadcaster();

  // Decorate fastify with broadcaster for access in routes
  fastify.decorate('broadcaster', broadcaster);

  // Set up periodic cleanup for abandoned register sessions (every 30 seconds)
  const cleanupInterval = setInterval(() => {
    void (async () => {
      try {
        const cleaned = await cleanupAbandonedRegisterSessions(fastify);
        if (cleaned > 0) {
          fastify.log.info(`Cleaned up ${cleaned} abandoned register session(s)`);
        }
      } catch (error) {
        fastify.log.error(error, 'Error during register session cleanup');
      }
    })();
  }, 30000); // 30 seconds

  // Periodic waitlist expiry (every 60 seconds)
  const waitlistExpiryInterval = setInterval(() => {
    void (async () => {
      try {
        const expired = await expireWaitlistEntries(fastify);
        if (expired > 0) {
          fastify.log.info(`Expired ${expired} waitlist entr${expired === 1 ? 'y' : 'ies'}`);
        }
      } catch (error) {
        fastify.log.error(error, 'Error during waitlist expiry');
      }
    })();
  }, 60000);

  // Periodic upgrade hold/offer processing (every 5 seconds)
  const upgradeHoldInterval = setInterval(() => {
    void (async () => {
      try {
        const { expired, held } = await processUpgradeHoldsTick(fastify);
        if (expired > 0 || held > 0) {
          fastify.log.info({ expired, held }, 'Processed upgrade holds');
        }
      } catch (error) {
        fastify.log.error(error, 'Error during upgrade hold processing');
      }
    })();
  }, 5000);

  // Initialize database connection (unless skipped for testing)
  if (!SKIP_DB) {
    try {
      await initializeDatabase();
      fastify.log.info('Database connection initialized');

      // Seed demo data if DEMO_MODE is enabled
      if (process.env.DEMO_MODE === 'true') {
        if (SEED_ON_STARTUP) {
          fastify.log.info('DEMO_MODE enabled, seeding demo data on startup (SEED_ON_STARTUP=true)...');
          await seedDemoData();
        } else {
          fastify.log.info(
            'DEMO_MODE enabled; skipping demo seed on startup. Run `pnpm demo:seed` or set SEED_ON_STARTUP=true to seed during boot.'
          );
        }
      }
    } catch (err) {
      fastify.log.error(err, 'Failed to initialize database');
      process.exit(1);
    }
  }

  // Register routes
  await fastify.register(healthRoutes);
  await fastify.register(authRoutes);
  await fastify.register(webauthnRoutes);
  await fastify.register(customerRoutes);
  await fastify.register(sessionRoutes);
  await fastify.register(laneRoutes);
  await fastify.register(inventoryRoutes);
  await fastify.register(roomsRoutes);
  await fastify.register(keysRoutes);
  await fastify.register(cleaningRoutes);
  await fastify.register(adminRoutes);
  await fastify.register(agreementRoutes);
  await fastify.register(upgradeRoutes);
  await fastify.register(waitlistRoutes);
  await fastify.register(metricsRoutes);
  await fastify.register(visitRoutes);
  await fastify.register(checkoutRoutes);
  await fastify.register(checkinRoutes);
  await fastify.register(registerRoutes);
  await fastify.register(shiftsRoutes);
  await fastify.register(timeclockRoutes);
  await fastify.register(documentsRoutes);
  await fastify.register(sessionDocumentsRoutes);
  await fastify.register(scheduleRoutes);
  await fastify.register(timeoffRoutes);

  // WebSocket endpoint
  fastify.get('/ws', { websocket: true }, (connection, req) => {
    const clientId = crypto.randomUUID();
    const socket = connection.socket as unknown as WebSocket;
    type AliveWebSocket = WebSocket & { isAlive?: boolean };
    const alive = socket as AliveWebSocket;

    // Extract lane from query string if present
    const url = req.url || '';
    const urlObj = new URL(url, `http://${req.headers.host || 'localhost'}`);
    const lane = urlObj.searchParams.get('lane') || undefined;

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
          fastify.log.info({ clientId, lane: data.lane }, 'Client lane updated');
          broadcaster.updateClientLane(clientId, data.lane);
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
  });

  // Graceful shutdown
  const shutdown = async () => {
    fastify.log.info('Shutting down...');
    clearInterval(cleanupInterval);
    clearInterval(waitlistExpiryInterval);
    clearInterval(upgradeHoldInterval);
    await fastify.close();
    if (!SKIP_DB) {
      await closeDatabase();
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void shutdown();
  });
  process.on('SIGINT', () => {
    void shutdown();
  });

  try {
    await fastify.listen({ port: PORT, host: HOST });
    fastify.log.info(`Server listening on http://${HOST}:${PORT}`);
    fastify.log.info(`WebSocket available at ws://${HOST}:${PORT}/ws`);
    fastify.log.info('Available endpoints:');
    fastify.log.info('  GET  /health');
    fastify.log.info('  POST /v1/sessions');
    fastify.log.info('  GET  /v1/sessions/active');
    fastify.log.info('  GET  /v1/inventory/summary');
    fastify.log.info('  GET  /v1/inventory/available');
    fastify.log.info('  POST /v1/keys/resolve');
    fastify.log.info('  POST /v1/cleaning/batch');
    fastify.log.info('  GET  /v1/cleaning/batches');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main().catch(console.error);
