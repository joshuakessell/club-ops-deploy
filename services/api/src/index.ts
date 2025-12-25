import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';

import {
  healthRoutes,
  authRoutes,
  webauthnRoutes,
  sessionRoutes,
  laneRoutes,
  inventoryRoutes,
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
  documentsRoutes
} from './routes/index.js';
import { createBroadcaster, type Broadcaster } from './websocket/broadcaster.js';
import { initializeDatabase, closeDatabase } from './db/index.js';
import { cleanupAbandonedRegisterSessions } from './routes/registers.js';
import { seedDemoData } from './db/seed-demo.js';

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';
const SKIP_DB = process.env.SKIP_DB === 'true';

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
  const cleanupInterval = setInterval(async () => {
    try {
      const cleaned = await cleanupAbandonedRegisterSessions(fastify);
      if (cleaned > 0) {
        fastify.log.info(`Cleaned up ${cleaned} abandoned register session(s)`);
      }
    } catch (error) {
      fastify.log.error(error, 'Error during register session cleanup');
    }
  }, 30000); // 30 seconds

  // Initialize database connection (unless skipped for testing)
  if (!SKIP_DB) {
    try {
      await initializeDatabase();
      fastify.log.info('Database connection initialized');
      
      // Seed demo data if DEMO_MODE is enabled
      if (process.env.DEMO_MODE === 'true') {
        fastify.log.info('DEMO_MODE enabled, seeding demo data...');
        await seedDemoData();
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
  await fastify.register(sessionRoutes);
  await fastify.register(laneRoutes);
  await fastify.register(inventoryRoutes);
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

  // WebSocket endpoint
  fastify.get('/ws', { websocket: true }, (connection, req) => {
    const clientId = crypto.randomUUID();
    const socket = connection.socket as unknown as WebSocket;
    
    // Extract lane from query string if present
    const url = req.url || '';
    const urlObj = new URL(url, `http://${req.headers.host || 'localhost'}`);
    const lane = urlObj.searchParams.get('lane') || undefined;
    
    fastify.log.info({ clientId, lane }, 'WebSocket client connected');
    
    broadcaster.addClient(clientId, socket, lane);

    connection.on('message', (message: Buffer) => {
      try {
        const data = JSON.parse(message.toString()) as Record<string, unknown>;
        fastify.log.info({ clientId, data }, 'Received message from client');

        // Handle subscription messages
        if (data.type === 'subscribe' && Array.isArray(data.events)) {
          fastify.log.info({ clientId, events: data.events }, 'Client subscribed to events');
          broadcaster.subscribeClient(clientId, data.events as string[]);
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
      broadcaster.removeClient(clientId);
      fastify.log.info({ clientId }, 'WebSocket client disconnected');
    });

    connection.on('error', (err) => {
      fastify.log.error({ clientId, err }, 'WebSocket error');
      broadcaster.removeClient(clientId);
    });
  });

  // Graceful shutdown
  const shutdown = async () => {
    fastify.log.info('Shutting down...');
    clearInterval(cleanupInterval);
    await fastify.close();
    if (!SKIP_DB) {
      await closeDatabase();
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => { void shutdown(); });
  process.on('SIGINT', () => { void shutdown(); });

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
