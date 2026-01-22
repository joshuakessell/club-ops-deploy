import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db';
import { requireAuth, requireAdmin } from '../auth/middleware';
import { parseSince } from '../telemetry/parseSince';
import { decodeCursor, encodeCursor, type TelemetryCursor } from '../telemetry/pagination';

const TelemetryBaseQuerySchema = z.object({
  since: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),

  app: z.string().optional(),
  level: z.string().optional(),
  kind: z.string().optional(),
  lane: z.string().optional(),
  deviceId: z.string().optional(),
  requestId: z.string().optional(),

  q: z.string().optional(),
});

const TelemetryEventsQuerySchema = TelemetryBaseQuerySchema.extend({
  cursor: z.string().optional(),
  direction: z.enum(['next', 'prev']).optional(),
  limit: z.string().optional(),
});

const TelemetryExportQuerySchema = TelemetryBaseQuerySchema.extend({
  format: z.enum(['json', 'csv']).optional().default('json'),
  cursorFrom: z.string().optional(),
  cursorTo: z.string().optional(),
  limit: z.string().optional(),
});

const TelemetryTailQuerySchema = TelemetryBaseQuerySchema.extend({
  after: z.string().optional(),
  includePage: z.string().optional(),
  limit: z.string().optional(),
});

type TelemetryEventRow = {
  id: string;
  created_at: Date;
  app: string;
  level: string;
  kind: string;
  route: string | null;
  message: string | null;
  stack: string | null;
  request_id: string | null;
  session_id: string | null;
  device_id: string | null;
  lane: string | null;
  method: string | null;
  status: number | null;
  url: string | null;
  meta: unknown;
};

type TelemetryPage = {
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
  prevCursor: string | null;
};

const TELEMETRY_SORT_COLUMNS = new Set(['created_at', 'id']);
const EVENTS_ORDER_DESC = `created_at DESC, id DESC`;
const EVENTS_ORDER_ASC = `created_at ASC, id ASC`;

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

function buildTelemetryWhere(input: z.infer<typeof TelemetryBaseQuerySchema>): {
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

  addGte('created_at', fromDate ?? undefined);
  addLte('created_at', toDate ?? undefined);

  addEq('app', input.app);
  addEq('level', input.level);
  addEq('kind', input.kind);
  addEq('lane', input.lane);
  addEq('device_id', input.deviceId);
  addEq('request_id', input.requestId);

  if (input.q && input.q.trim()) {
    params.push(`%${input.q.trim()}%`);
    const p = `$${params.length}`;
    where.push(`(COALESCE(message, '') ILIKE ${p} OR kind ILIKE ${p} OR COALESCE(route, '') ILIKE ${p})`);
  }

  return { where, params };
}

function addCursorBound(
  where: string[],
  params: unknown[],
  op: '<' | '>' | '<=' | '>=',
  cursor: TelemetryCursor
): void {
  params.push(cursor.createdAt, cursor.id);
  where.push(`(created_at, id) ${op} ($${params.length - 1}, $${params.length})`);
}

function decodeCursorOrThrow(raw: string | undefined, label: string): TelemetryCursor | null {
  if (!raw) return null;
  const decoded = decodeCursor(raw);
  if (!decoded) throw new Error(`Invalid ${label} cursor`);
  return decoded;
}

function getPageMeta(rows: TelemetryEventRow[], limit: number, hasMore: boolean): TelemetryPage {
  if (rows.length === 0) {
    return { limit, hasMore: false, nextCursor: null, prevCursor: null };
  }

  const first = rows[0]!;
  const last = rows[rows.length - 1]!;
  return {
    limit,
    hasMore,
    nextCursor: hasMore ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null,
    prevCursor: encodeCursor({ createdAt: first.created_at, id: first.id }),
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

export async function adminTelemetryRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /v1/admin/telemetry/events
   * Admin-only telemetry inspection.
   *
   * Manual test notes:
   * - Fetch first page (no cursor) and verify page metadata.
   * - Use nextCursor with direction=next to page older.
   * - Use prevCursor with direction=prev to page newer.
   */
  fastify.get<{
    Querystring: z.infer<typeof TelemetryEventsQuerySchema>;
  }>(
    '/v1/admin/telemetry/events',
    {
      preHandler: [requireAuth, requireAdmin],
    },
    async (request, reply) => {
      const parsed = TelemetryEventsQuerySchema.safeParse(request.query ?? {});
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
        const built = buildTelemetryWhere(parsed.data);
        where = built.where;
        params = built.params;
      } catch (err) {
        return reply.status(400).send({ error: 'Bad Request', message: (err as Error).message });
      }

      if (cursor) {
        addCursorBound(where, params, direction === 'next' ? '<' : '>', cursor);
      }

      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const orderBy = EVENTS_ORDER_DESC;
      if (!TELEMETRY_SORT_COLUMNS.has('created_at') || !TELEMETRY_SORT_COLUMNS.has('id')) {
        return reply.status(500).send({ error: 'Internal server error' });
      }

      const res = await query<TelemetryEventRow>(
        `
        SELECT id, created_at, app, level, kind, route, message, stack,
               request_id, session_id, device_id, lane,
               method, status, url, meta
        FROM telemetry_events
        ${whereSql}
        ORDER BY ${orderBy}
        LIMIT ${limit + 1}
        `,
        params
      );

      const hasMore = res.rows.length > limit;
      const rows = hasMore ? res.rows.slice(0, limit) : res.rows;

      let page: TelemetryPage = { limit, hasMore, nextCursor: null, prevCursor: null };
      if (rows.length > 0) {
        const first = rows[0]!;
        const last = rows[rows.length - 1]!;
        const prevCursor = encodeCursor({ createdAt: first.created_at, id: first.id });
        const nextCursor = encodeCursor({ createdAt: last.created_at, id: last.id });
        page =
          direction === 'prev'
            ? { limit, hasMore, nextCursor, prevCursor }
            : { limit, hasMore, nextCursor: hasMore ? nextCursor : null, prevCursor };
      }

      return reply.status(200).send({ events: rows, page });
    }
  );

  /**
   * GET /v1/admin/telemetry/tail
   * Admin-only tail for efficient polling.
   */
  fastify.get<{
    Querystring: z.infer<typeof TelemetryTailQuerySchema>;
  }>(
    '/v1/admin/telemetry/tail',
    {
      preHandler: [requireAuth, requireAdmin],
    },
    async (request, reply) => {
      const parsed = TelemetryTailQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Bad Request', message: 'Invalid query params' });
      }

      if (!parsed.data.after) {
        return reply.status(400).send({ error: 'Bad Request', message: '`after` is required' });
      }

      let afterCursor: TelemetryCursor | null = null;
      try {
        afterCursor = decodeCursorOrThrow(parsed.data.after, 'after');
      } catch (err) {
        return reply.status(400).send({ error: 'Bad Request', message: (err as Error).message });
      }

      if (!afterCursor) {
        return reply.status(400).send({ error: 'Bad Request', message: 'Invalid after cursor' });
      }

      const limit = parseLimit(parsed.data.limit, 200);
      const includePage = parseBoolean(parsed.data.includePage);

      let where: string[] = [];
      let params: unknown[] = [];
      try {
        const built = buildTelemetryWhere(parsed.data);
        where = built.where;
        params = built.params;
      } catch (err) {
        return reply.status(400).send({ error: 'Bad Request', message: (err as Error).message });
      }

      addCursorBound(where, params, '>', afterCursor);

      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const orderBy = EVENTS_ORDER_ASC;
      if (!TELEMETRY_SORT_COLUMNS.has('created_at') || !TELEMETRY_SORT_COLUMNS.has('id')) {
        return reply.status(500).send({ error: 'Internal server error' });
      }

      const tailLimit = includePage ? limit + 1 : limit;
      const res = await query<TelemetryEventRow>(
        `
        SELECT id, created_at, app, level, kind, route, message, stack,
               request_id, session_id, device_id, lane,
               method, status, url, meta
        FROM telemetry_events
        ${whereSql}
        ORDER BY ${orderBy}
        LIMIT ${tailLimit}
        `,
        params
      );

      const hasMore = includePage && res.rows.length > limit;
      const rows = hasMore ? res.rows.slice(0, limit) : res.rows;
      const latestCursor =
        rows.length > 0 ? encodeCursor({ createdAt: rows[rows.length - 1]!.created_at, id: rows[rows.length - 1]!.id }) : parsed.data.after;

      const response: { events: TelemetryEventRow[]; cursor: { latestCursor: string | null }; page?: TelemetryPage } = {
        events: rows,
        cursor: { latestCursor },
      };

      if (includePage) {
        response.page = getPageMeta(rows, limit, hasMore);
      }

      return reply.status(200).send(response);
    }
  );

  /**
   * GET /v1/admin/telemetry/export
   * Admin-only export for triage / ChatGPT import.
   */
  fastify.get<{
    Querystring: z.infer<typeof TelemetryExportQuerySchema>;
  }>(
    '/v1/admin/telemetry/export',
    {
      preHandler: [requireAuth, requireAdmin],
    },
    async (request, reply) => {
      const parsed = TelemetryExportQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Bad Request', message: 'Invalid query params' });
      }

      const limit = parseLimit(parsed.data.limit, 200);

      let cursorFrom: TelemetryCursor | null = null;
      let cursorTo: TelemetryCursor | null = null;
      try {
        cursorFrom = decodeCursorOrThrow(parsed.data.cursorFrom, 'cursorFrom');
        cursorTo = decodeCursorOrThrow(parsed.data.cursorTo, 'cursorTo');
      } catch (err) {
        return reply.status(400).send({ error: 'Bad Request', message: (err as Error).message });
      }

      let where: string[] = [];
      let params: unknown[] = [];
      try {
        const built = buildTelemetryWhere(parsed.data);
        where = built.where;
        params = built.params;
      } catch (err) {
        return reply.status(400).send({ error: 'Bad Request', message: (err as Error).message });
      }

      if (cursorFrom) addCursorBound(where, params, '<=', cursorFrom);
      if (cursorTo) addCursorBound(where, params, '>=', cursorTo);

      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const orderBy = EVENTS_ORDER_DESC;
      if (!TELEMETRY_SORT_COLUMNS.has('created_at') || !TELEMETRY_SORT_COLUMNS.has('id')) {
        return reply.status(500).send({ error: 'Internal server error' });
      }

      const res = await query<TelemetryEventRow>(
        `
        SELECT id, created_at, app, level, kind, route, message, stack,
               request_id, session_id, device_id, lane,
               method, status, url, meta
        FROM telemetry_events
        ${whereSql}
        ORDER BY ${orderBy}
        LIMIT ${limit}
        `,
        params
      );

      if (parsed.data.format === 'csv') {
        const header = [
          'created_at',
          'app',
          'level',
          'kind',
          'route',
          'message',
          'request_id',
          'session_id',
          'device_id',
          'lane',
          'method',
          'status',
          'url',
          'meta',
        ].join(',');

        const rows = res.rows.map((r) =>
          [
            csvEscape(r.created_at),
            csvEscape(r.app),
            csvEscape(r.level),
            csvEscape(r.kind),
            csvEscape(r.route),
            csvEscape(r.message),
            csvEscape(r.request_id),
            csvEscape(r.session_id),
            csvEscape(r.device_id),
            csvEscape(r.lane),
            csvEscape(r.method),
            csvEscape(r.status),
            csvEscape(r.url),
            csvEscape(r.meta),
          ].join(',')
        );

        const csv = [header, ...rows].join('\n');
        reply.header('content-type', 'text/csv; charset=utf-8');
        return reply.status(200).send(csv);
      }

      return reply.status(200).send({ events: res.rows });
    }
  );
}
