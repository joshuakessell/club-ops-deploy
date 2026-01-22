import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StaffSession } from './LockScreen';
import { ApiError, apiJson } from './api';
import { getApiUrl } from '@/lib/apiBase';

type TelemetryEvent = {
  id: string;
  created_at: string;
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

type TelemetryResponse = {
  events: TelemetryEvent[];
  page: {
    limit: number;
    hasMore: boolean;
    nextCursor: string | null;
    prevCursor: string | null;
  };
};

type TelemetryTailResponse = {
  events: TelemetryEvent[];
  cursor: {
    latestCursor: string | null;
  };
};

const SINCE_OPTIONS = [
  { value: '30m', label: 'Last 30 minutes' },
  { value: '2h', label: 'Last 2 hours' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
];

const LIMIT_OPTIONS = [100, 200, 500];

function truncate(value: string | null, max = 120): string {
  if (!value) return '—';
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

function formatMeta(meta: unknown): string {
  if (meta == null) return '—';
  try {
    return JSON.stringify(meta, null, 2);
  } catch {
    return String(meta);
  }
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return ts;
  return d.toLocaleString();
}

export function TelemetryView({ session }: { session: StaffSession }) {
  const [events, setEvents] = useState<TelemetryEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [page, setPage] = useState<TelemetryResponse['page'] | null>(null);
  const [afterCursor, setAfterCursor] = useState<string | null>(null);

  const [filters, setFilters] = useState({
    app: '',
    level: '',
    kind: '',
    lane: '',
    q: '',
    since: '2h',
    limit: 200,
  });

  const abortRef = useRef<AbortController | null>(null);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (filters.since) p.set('since', filters.since);
    if (filters.app) p.set('app', filters.app);
    if (filters.level) p.set('level', filters.level);
    if (filters.kind) p.set('kind', filters.kind);
    if (filters.lane) p.set('lane', filters.lane);
    if (filters.q) p.set('q', filters.q);
    p.set('limit', String(filters.limit));
    return p;
  }, [filters]);

  const loadEvents = useCallback(
    async (
      opts: { silent?: boolean; cursor?: string | null; direction?: 'next' | 'prev' } = {}
    ) => {
      if (!session.sessionToken) return;
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      if (!opts.silent) setLoading(true);
      setError(null);
      try {
        const p = new URLSearchParams(params);
        if (opts.cursor) p.set('cursor', opts.cursor);
        if (opts.direction) p.set('direction', opts.direction);

        const data = await apiJson<TelemetryResponse>(`/v1/admin/telemetry/events?${p}`, {
          sessionToken: session.sessionToken,
          signal: ac.signal,
        });
        if (ac.signal.aborted) return;
        setEvents(data.events || []);
        setPage(data.page || null);
        const shouldUpdateAfter = !opts.cursor || opts.direction === 'prev';
        if (shouldUpdateAfter) {
          setAfterCursor(data.page?.prevCursor ?? null);
        }
      } catch (e) {
        if (ac.signal.aborted) return;
        if (e instanceof ApiError && e.status === 403) {
          setError('Admin access required.');
          return;
        }
        setError(e instanceof Error ? e.message : 'Failed to load telemetry');
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    },
    [params, session.sessionToken]
  );

  useEffect(() => {
    setAfterCursor(null);
    setPage(null);
    loadEvents();
    return () => {
      abortRef.current?.abort();
    };
  }, [loadEvents]);

  const pollTail = useCallback(async () => {
    if (!session.sessionToken || !afterCursor) return;
    try {
      const p = new URLSearchParams(params);
      p.set('after', afterCursor);
      p.set('limit', String(filters.limit));
      const data = await apiJson<TelemetryTailResponse>(`/v1/admin/telemetry/tail?${p}`, {
        sessionToken: session.sessionToken,
      });
      if (!data.events || data.events.length === 0) return;

      const incoming = [...data.events].reverse();
      setEvents((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        const deduped = incoming.filter((e) => !seen.has(e.id));
        return deduped.concat(prev);
      });
      if (data.cursor?.latestCursor) {
        setAfterCursor(data.cursor.latestCursor);
        setPage((prev) => (prev ? { ...prev, prevCursor: data.cursor.latestCursor } : prev));
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setError('Admin access required.');
        return;
      }
      setError(e instanceof Error ? e.message : 'Failed to tail telemetry');
    }
  }, [afterCursor, filters.limit, params, session.sessionToken]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(() => {
      void pollTail();
    }, 5000);
    return () => window.clearInterval(id);
  }, [autoRefresh, pollTail]);

  const handleDownload = async (format: 'json' | 'csv') => {
    if (!session.sessionToken) return;
    try {
      setError(null);
      const p = new URLSearchParams(params);
      p.set('format', format);
      const url = getApiUrl(`/api/v1/admin/telemetry/export?${p.toString()}`);
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${session.sessionToken}`,
        },
      });
      if (!res.ok) {
        throw new ApiError(res.status, `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `telemetry-${new Date().toISOString()}.${format === 'csv' ? 'csv' : 'json'}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(downloadUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to export telemetry');
    }
  };

  return (
    <div style={{ maxWidth: 1500, margin: '0 auto' }}>
      <section className="panel cs-liquid-card" style={{ marginBottom: '1.5rem' }}>
        <div className="panel-header">
          <h2>Telemetry</h2>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <button className="cs-liquid-button" onClick={() => loadEvents()}>
              Refresh
            </button>
            <button
              className="cs-liquid-button"
              disabled={!page?.nextCursor}
              onClick={() => loadEvents({ cursor: page?.nextCursor, direction: 'next' })}
            >
              Older
            </button>
            <button
              className="cs-liquid-button"
              disabled={!page?.prevCursor}
              onClick={() => loadEvents({ cursor: page?.prevCursor, direction: 'prev' })}
            >
              Newer
            </button>
            <label className="telemetry-toggle">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
              />
              Auto-refresh (5s)
            </label>
            <button className="cs-liquid-button" onClick={() => handleDownload('json')}>
              Download JSON
            </button>
            <button className="cs-liquid-button" onClick={() => handleDownload('csv')}>
              Download CSV
            </button>
          </div>
        </div>

        <div className="metrics-filters cs-liquid-card" style={{ margin: '1rem 1.5rem' }}>
          <div className="filter-group">
            <label>App</label>
            <input
              value={filters.app}
              placeholder="customer-kiosk"
              onChange={(e) => setFilters((f) => ({ ...f, app: e.target.value }))}
            />
          </div>
          <div className="filter-group">
            <label>Level</label>
            <input
              value={filters.level}
              placeholder="error"
              onChange={(e) => setFilters((f) => ({ ...f, level: e.target.value }))}
            />
          </div>
          <div className="filter-group">
            <label>Kind</label>
            <input
              value={filters.kind}
              placeholder="ui.error"
              onChange={(e) => setFilters((f) => ({ ...f, kind: e.target.value }))}
            />
          </div>
          <div className="filter-group">
            <label>Lane</label>
            <input
              value={filters.lane}
              placeholder="lane-1"
              onChange={(e) => setFilters((f) => ({ ...f, lane: e.target.value }))}
            />
          </div>
          <div className="filter-group">
            <label>Search</label>
            <input
              value={filters.q}
              placeholder="message / kind / route"
              onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
            />
          </div>
          <div className="filter-group">
            <label>Since</label>
            <select
              value={filters.since}
              onChange={(e) => setFilters((f) => ({ ...f, since: e.target.value }))}
            >
              {SINCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <label>Limit</label>
            <select
              value={filters.limit}
              onChange={(e) => setFilters((f) => ({ ...f, limit: Number(e.target.value) }))}
            >
              {LIMIT_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="panel-content" style={{ padding: '1rem 1.5rem 1.5rem' }}>
          {error && <div className="telemetry-error">{error}</div>}
          {loading && <div className="telemetry-loading">Loading…</div>}
          {!loading && !error && events.length === 0 && (
            <div className="empty-state">No telemetry events found.</div>
          )}

          {events.length > 0 && (
            <table className="rooms-table telemetry-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>App</th>
                  <th>Level</th>
                  <th>Kind</th>
                  <th>Message</th>
                  <th>Lane / Device</th>
                  <th>Route</th>
                  <th>Request ID</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event, idx) => {
                  const key = `${event.id}|${event.created_at}|${idx}`;
                  const isOpen = expandedKey === key;
                  return (
                    <Fragment key={key}>
                      <tr
                        className={`telemetry-row ${isOpen ? 'is-open' : ''}`}
                        onClick={() => setExpandedKey(isOpen ? null : key)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td>{formatTimestamp(event.created_at)}</td>
                        <td>{event.app}</td>
                        <td className={`telemetry-level telemetry-level-${event.level}`}>{event.level}</td>
                        <td>{event.kind}</td>
                        <td>{truncate(event.message)}</td>
                        <td>{event.lane || event.device_id || '—'}</td>
                        <td>{event.route || '—'}</td>
                        <td>{event.request_id || '—'}</td>
                      </tr>
                      {isOpen && (
                        <tr className="telemetry-details-row">
                          <td colSpan={8}>
                            <div className="telemetry-details">
                              <div className="telemetry-details-grid">
                                <div>
                                  <div className="telemetry-label">Message</div>
                                  <div className="telemetry-value">{event.message || '—'}</div>
                                </div>
                                <div>
                                  <div className="telemetry-label">Route</div>
                                  <div className="telemetry-value">{event.route || '—'}</div>
                                </div>
                                <div>
                                  <div className="telemetry-label">Method / Status</div>
                                  <div className="telemetry-value">
                                    {event.method || '—'} {event.status != null ? `(${event.status})` : ''}
                                  </div>
                                </div>
                                <div>
                                  <div className="telemetry-label">URL</div>
                                  <div className="telemetry-value">{event.url || '—'}</div>
                                </div>
                                <div>
                                  <div className="telemetry-label">Request / Session</div>
                                  <div className="telemetry-value">
                                    {event.request_id || '—'} / {event.session_id || '—'}
                                  </div>
                                </div>
                                <div>
                                  <div className="telemetry-label">Device / Lane</div>
                                  <div className="telemetry-value">
                                    {event.device_id || '—'} / {event.lane || '—'}
                                  </div>
                                </div>
                              </div>

                              <div className="telemetry-stack">
                                <div className="telemetry-label">Stack</div>
                                <pre>{event.stack || '—'}</pre>
                              </div>

                              <div className="telemetry-meta">
                                <div className="telemetry-label">Meta</div>
                                <pre>{formatMeta(event.meta)}</pre>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}

