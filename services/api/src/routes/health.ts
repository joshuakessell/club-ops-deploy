import { FastifyInstance } from 'fastify';

interface HealthResponse {
  status: 'ok' | 'error';
  timestamp: string;
  uptime: number;
}

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Reply: HealthResponse }>('/health', async (_request, reply) => {
    const isHealthy = fastify.dbHealthy;
    if (!isHealthy) {
      reply.code(503);
    }

    return {
      status: isHealthy ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  });
}
