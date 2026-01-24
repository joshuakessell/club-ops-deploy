import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db';
import { storeTelemetryEvents, type TelemetryEventInput } from '../telemetry/storeTelemetryEvents';

const TelemetryEventSchema = z
  .object({
    ts: z.string().optional(),
    app: z.string().min(1).max(100),
    env: z.string().optional(),
    kind: z.string().min(1).max(80),
    level: z.enum(['error', 'warn', 'info']).default('error'),

    requestId: z.string().optional(),
    sessionId: z.string().optional(),
    deviceId: z.string().optional(),
    lane: z.string().optional(),
    route: z.string().optional(),

    message: z.string().optional(),
    stack: z.string().optional(),

    url: z.string().optional(),
    method: z.string().optional(),
    status: z.number().int().optional(),

    meta: z.record(z.unknown()).optional(),
  })
  .strict();

const TelemetryIngestSchema = z.union([
  z
    .object({
      events: z.array(TelemetryEventSchema).min(1).max(200),
      reason: z.string().optional(),
    })
    .strict(),
  TelemetryEventSchema,
]);

export async function telemetryRoutes(fastify: FastifyInstance): Promise<void> {
  // Ingest (public, never throws; we do not want telemetry to break the app)
  fastify.post('/v1/telemetry', { bodyLimit: 256 * 1024 }, async (request, reply) => {
    try {
      const parsed = TelemetryIngestSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(200).send({ ok: true });

      const events: TelemetryEventInput[] =
        'events' in parsed.data ? parsed.data.events : [parsed.data];

      await storeTelemetryEvents(events, {
        ip: request.ip ?? null,
        userAgent: (request.headers['user-agent'] as string) ?? null,
      });
    } catch {
      // swallow
    }
    return reply.status(200).send({ ok: true });
  });

  // Dev-only: quick inspection endpoint (do NOT rely on this for prod)
  fastify.get('/v1/telemetry', async (request, reply) => {
    if (process.env.NODE_ENV === 'production') {
      return reply.status(404).send({ error: 'Not found' });
    }

    const q = (request.query ?? {}) as Record<string, string | undefined>;
    const limitRaw = q.limit ? Number(q.limit) : 100;
    const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 100;

    const where: string[] = [];
    const params: unknown[] = [];

    const addEq = (col: string, value?: string) => {
      if (!value || !value.trim()) return;
      params.push(value.trim());
      where.push(`${col} = $${params.length}`);
    };

    addEq('app', q.app);
    addEq('level', q.level);
    addEq('kind', q.kind);
    addEq('device_id', q.deviceId);
    addEq('lane', q.lane);
    addEq('request_id', q.requestId);

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const res = await query(
      `SELECT id, created_at, app, env, kind, level, request_id, session_id, device_id, lane, route, message, stack, url, method, status, user_agent, ip_address, meta
       FROM telemetry_events
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT ${limit}`,
      params
    );

    return reply.status(200).send({ events: res.rows });
  });
}
