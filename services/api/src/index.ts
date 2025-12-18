import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';

import { 
  healthRoutes, 
  sessionRoutes, 
  inventoryRoutes, 
  keysRoutes, 
  cleaningRoutes 
} from './routes/index.js';
import { createBroadcaster, type Broadcaster } from './websocket/broadcaster.js';
import { initializeDatabase, closeDatabase } from './db/index.js';

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

  // Initialize database connection (unless skipped for testing)
  if (!SKIP_DB) {
    try {
      await initializeDatabase();
      fastify.log.info('Database connection initialized');
    } catch (err) {
      fastify.log.error(err, 'Failed to initialize database');
      process.exit(1);
    }
  }

  // Register routes
  await fastify.register(healthRoutes);
  await fastify.register(sessionRoutes);
  await fastify.register(inventoryRoutes);
  await fastify.register(keysRoutes);
  await fastify.register(cleaningRoutes);

  // WebSocket endpoint
  fastify.get('/ws', { websocket: true }, (connection, _req) => {
    const clientId = crypto.randomUUID();
    const socket = connection.socket as unknown as WebSocket;
    fastify.log.info({ clientId }, 'WebSocket client connected');

    broadcaster.addClient(clientId, socket);

    connection.on('message', (message: Buffer) => {
      try {
        const data = JSON.parse(message.toString()) as Record<string, unknown>;
        fastify.log.info({ clientId, data }, 'Received message from client');

        // Handle subscription messages
        if (data.type === 'subscribe' && Array.isArray(data.events)) {
          fastify.log.info({ clientId, events: data.events }, 'Client subscribed to events');
          // In a more advanced implementation, we could track subscriptions per client
          // For now, all clients receive all broadcasts
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
