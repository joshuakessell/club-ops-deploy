import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db';
import { requireAuth, requireAdmin } from '../auth/middleware';
import { parseSince } from '../telemetry/parseSince';
import { decodeCursor, encodeCursor, type TelemetryCursor } from '../telemetry/pagination';

const TelemetryTraceQuerySchema = z.object({
  since: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  app: z.string().optional(),
  deviceId: z.string().optional(),
  sessionId: z.string().optional(),
  traceId: z.string().optional(),
  incidentOnly: z.string().optional(),
  cursor: z.string().optional(),
  direction: z.enum(['next', 'prev']).optional(),
  limit: z.string().optional(),
});

const TelemetryTraceDetailSchema = z.object({
  incidentId: z.string().optional(),
  limit: z.string().optional(),
});

const TelemetryExportSchema = z.object({
  traceId: z.string().min(1),
  incidentId: z.string().optional(),
  bundle: z.string().optional(),
  format: z.enum(['json', 'csv']).optional().default('json'),
});

type TelemetryTraceRow = {
  trace_id: string;
  app: string;
  device_id: string;
  session_id: string;
  started_at: Date;
  last_seen_at: Date;
  incident_open: boolean;
  incident_last_at: Date | null;
};

type TelemetrySpanRow = {
  id: string;
  trace_id: string;
  app: string;
  device_id: string;
  session_id: string;
  span_type: string;
  name: string | null;
  level: string;
  started_at: Date;
  ended_at: Date | null;
  duration_ms: number | null;
  route: string | null;
  method: string | null;
  status: number | null;
  url: string | null;
  message: string | null;
  stack: string | null;
  request_headers: unknown;
  response_headers: unknown;
  request_body: unknown;
  response_body: unknown;
  request_key: string | null;
  incident_id: string | null;
  incident_reason: string | null;
  meta: unknown;
};

type TelemetryPage = {
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
  prevCursor: string | null;
};

const TRACES_ORDER_DESC = `last_seen_at DESC, trace_id DESC`;
const TRACES_ORDER_ASC = `last_seen_at ASC, trace_id ASC`;

function parseIsoDate(value: string): Date | null {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return d;
}

function parseLimit(raw: unknown, fallback = 200): number {
  const n = parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(500, n));
}

function parseBoolean(raw: unknown): boolean {
  if (raw == null) return false;
  const v = String(raw).toLowerCase().trim();
  return v === 'true' || v === '1' || v === 'yes';
}

function addCursorBound(
  where: string[],
  params: unknown[],
  op: '<' | '>' | '<=' | '>=',
  cursor: TelemetryCursor
): void {
  params.push(cursor.createdAt, cursor.id);
  where.push(`(last_seen_at, trace_id) ${op} ($${params.length - 1}, $${params.length})`);
}

function decodeCursorOrThrow(raw: string | undefined, label: string): TelemetryCursor | null {
  if (!raw) return null;
  const decoded = decodeCursor(raw);
  if (!decoded) throw new Error(`Invalid ${label} cursor`);
  return decoded;
}

function buildTraceWhere(input: z.infer<typeof TelemetryTraceQuerySchema>): {
  where: string[];
  params: unknown[];
} {
  const where: string[] = [];
  const params: unknown[] = [];

  const addEq = (col: string, value?: string) => {
    if (!value || !value.trim()) return;
    params.push(value.trim());
    where.push(`${col} = $${params.length}`);
  };

  const addGte = (col: string, value?: Date) => {
    if (!value) return;
    params.push(value);
    where.push(`${col} >= $${params.length}`);
  };

  const addLte = (col: string, value?: Date) => {
    if (!value) return;
    params.push(value);
    where.push(`${col} <= $${params.length}`);
  };

  const sinceDate = input.since ? parseSince(input.since) ?? parseIsoDate(input.since) : null;
  const fromDate = input.from ? parseIsoDate(input.from) : sinceDate;
  const toDate = input.to ? parseIsoDate(input.to) : null;

  if (input.from && !fromDate) throw new Error('Invalid `from`');
  if (input.to && !toDate) throw new Error('Invalid `to`');
  if (input.since && !input.from && !sinceDate) throw new Error('Invalid `since`');

  addGte('last_seen_at', fromDate ?? undefined);
  addLte('last_seen_at', toDate ?? undefined);

  addEq('app', input.app);
  addEq('device_id', input.deviceId);
  addEq('session_id', input.sessionId);
  addEq('trace_id', input.traceId);

  if (parseBoolean(input.incidentOnly)) {
    where.push('(incident_open = true OR incident_last_at IS NOT NULL)');
  }

  return { where, params };
}

function getPageMeta(rows: TelemetryTraceRow[], limit: number, hasMore: boolean): TelemetryPage {
  if (rows.length === 0) {
    return { limit, hasMore: false, nextCursor: null, prevCursor: null };
  }

  const first = rows[0]!;
  const last = rows[rows.length - 1]!;
  return {
    limit,
    hasMore,
    nextCursor: hasMore ? encodeCursor({ createdAt: last.last_seen_at, id: last.trace_id }) : null,
    prevCursor: encodeCursor({ createdAt: first.last_seen_at, id: first.trace_id }),
  };
}

function csvEscape(value: unknown): string {
  if (value == null) return '';
  const s =
    value instanceof Date
      ? value.toISOString()
      : typeof value === 'string'
        ? value
        : typeof value === 'number'
          ? String(value)
          : typeof value === 'object'
            ? JSON.stringify(value)
            : String(value);
  const needsQuotes = /[",\n\r]/.test(s);
  const escaped = s.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

async function loadIncidentBundle(traceId: string, incidentId: string): Promise<TelemetrySpanRow[]> {
  const incidentRes = await query<TelemetrySpanRow>(
    `
    SELECT *
    FROM telemetry_spans
    WHERE trace_id = $1 AND incident_id = $2
    ORDER BY started_at ASC
    `,
    [traceId, incidentId]
  );

  if (incidentRes.rows.length === 0) return [];
  const incidentStart = incidentRes.rows[0]!.started_at;

  const breadcrumbsRes = await query<TelemetrySpanRow>(
    `
    SELECT *
    FROM telemetry_spans
    WHERE trace_id = $1
      AND started_at <= $2
      AND (meta->>'breadcrumb')::boolean = true
    ORDER BY started_at DESC
    LIMIT 200
    `,
    [traceId, incidentStart]
  );

  const breadcrumbs = breadcrumbsRes.rows.reverse();
  return [...breadcrumbs, ...incidentRes.rows];
}

export async function adminTelemetryRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /v1/admin/telemetry/traces
   * Admin-only trace list.
   */
  fastify.get<{
    Querystring: z.infer<typeof TelemetryTraceQuerySchema>;
  }>(
    '/v1/admin/telemetry/traces',
    {
      preHandler: [requireAuth, requireAdmin],
    },
    async (request, reply) => {
      const parsed = TelemetryTraceQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Bad Request', message: 'Invalid query params' });
      }

      const limit = parseLimit(parsed.data.limit, 200);
      const direction = parsed.data.direction ?? 'next';
      if (direction !== 'next' && direction !== 'prev') {
        return reply.status(400).send({ error: 'Bad Request', message: 'Invalid direction' });
      }

      let cursor: TelemetryCursor | null = null;
      try {
        cursor = decodeCursorOrThrow(parsed.data.cursor, 'pagination');
      } catch (err) {
        return reply.status(400).send({ error: 'Bad Request', message: (err as Error).message });
      }

      let where: string[] = [];
      let params: unknown[] = [];
      try {
        const built = buildTraceWhere(parsed.data);
        where = built.where;
        params = built.params;
      } catch (err) {
        return reply.status(400).send({ error: 'Bad Request', message: (err as Error).message });
      }

      if (cursor) {
        addCursorBound(where, params, direction === 'next' ? '<' : '>', cursor);
      }

      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const orderBy = direction === 'prev' ? TRACES_ORDER_ASC : TRACES_ORDER_DESC;

      const res = await query<TelemetryTraceRow>(
        `
        SELECT trace_id, app, device_id, session_id, started_at, last_seen_at, incident_open, incident_last_at
        FROM telemetry_traces
        ${whereSql}
        ORDER BY ${orderBy}
        LIMIT ${limit + 1}
        `,
        params
      );

      const hasMore = res.rows.length > limit;
      const rows = hasMore ? res.rows.slice(0, limit) : res.rows;
      const page = getPageMeta(rows, limit, hasMore);

      return reply.status(200).send({ traces: rows, page });
    }
  );

  /**
   * GET /v1/admin/telemetry/traces/:traceId
   * Admin-only trace detail with spans.
   */
  fastify.get<{
    Params: { traceId: string };
    Querystring: z.infer<typeof TelemetryTraceDetailSchema>;
  }>(
    '/v1/admin/telemetry/traces/:traceId',
    {
      preHandler: [requireAuth, requireAdmin],
    },
    async (request, reply) => {
      const parsed = TelemetryTraceDetailSchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Bad Request', message: 'Invalid query params' });
      }

      const limit = parseLimit(parsed.data.limit, 2000);
      const traceId = request.params.traceId;

      const traceRes = await query<TelemetryTraceRow>(
        `
        SELECT trace_id, app, device_id, session_id, started_at, last_seen_at, incident_open, incident_last_at
        FROM telemetry_traces
        WHERE trace_id = $1
        `,
        [traceId]
      );

      if (traceRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Not found' });
      }

      let spans: TelemetrySpanRow[] = [];
      if (parsed.data.incidentId) {
        spans = await loadIncidentBundle(traceId, parsed.data.incidentId);
      } else {
        const spanRes = await query<TelemetrySpanRow>(
          `
          SELECT *
          FROM telemetry_spans
          WHERE trace_id = $1
          ORDER BY started_at ASC
          LIMIT $2
          `,
          [traceId, limit]
        );
        spans = spanRes.rows;
      }

      return reply.status(200).send({ trace: traceRes.rows[0], spans });
    }
  );

  /**
   * GET /v1/admin/telemetry/export
   * Admin-only export (trace or incident bundle).
   */
  fastify.get<{
    Querystring: z.infer<typeof TelemetryExportSchema>;
  }>(
    '/v1/admin/telemetry/export',
    {
      preHandler: [requireAuth, requireAdmin],
    },
    async (request, reply) => {
      const parsed = TelemetryExportSchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Bad Request', message: 'Invalid query params' });
      }

      const traceId = parsed.data.traceId;
      const incidentId = parsed.data.incidentId;
      const bundle = parseBoolean(parsed.data.bundle);

      let spans: TelemetrySpanRow[] = [];
      if (incidentId && bundle) {
        spans = await loadIncidentBundle(traceId, incidentId);
      } else if (incidentId) {
        const spanRes = await query<TelemetrySpanRow>(
          `
          SELECT *
          FROM telemetry_spans
          WHERE trace_id = $1 AND incident_id = $2
          ORDER BY started_at ASC
          `,
          [traceId, incidentId]
        );
        spans = spanRes.rows;
      } else {
        const spanRes = await query<TelemetrySpanRow>(
          `
          SELECT *
          FROM telemetry_spans
          WHERE trace_id = $1
          ORDER BY started_at ASC
          `,
          [traceId]
        );
        spans = spanRes.rows;
      }

      if (parsed.data.format === 'csv') {
        const header = [
          'started_at',
          'trace_id',
          'app',
          'device_id',
          'session_id',
          'span_type',
          'name',
          'level',
          'route',
          'method',
          'status',
          'url',
          'message',
          'request_key',
          'incident_id',
          'incident_reason',
          'meta',
          'request_headers',
          'response_headers',
          'request_body',
          'response_body',
        ].join(',');

        const rows = spans.map((s) =>
          [
            csvEscape(s.started_at),
            csvEscape(s.trace_id),
            csvEscape(s.app),
            csvEscape(s.device_id),
            csvEscape(s.session_id),
            csvEscape(s.span_type),
            csvEscape(s.name),
            csvEscape(s.level),
            csvEscape(s.route),
            csvEscape(s.method),
            csvEscape(s.status),
            csvEscape(s.url),
            csvEscape(s.message),
            csvEscape(s.request_key),
            csvEscape(s.incident_id),
            csvEscape(s.incident_reason),
            csvEscape(s.meta),
            csvEscape(s.request_headers),
            csvEscape(s.response_headers),
            csvEscape(s.request_body),
            csvEscape(s.response_body),
          ].join(',')
        );

        const csv = [header, ...rows].join('\n');
        reply.header('content-type', 'text/csv; charset=utf-8');
        return reply.status(200).send(csv);
      }

      return reply.status(200).send({
        traceId,
        incidentId: incidentId ?? null,
        bundle,
        spans,
      });
    }
  );
}
