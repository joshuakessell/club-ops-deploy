import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StaffSession } from './LockScreen';
import { ApiError, apiJson } from './api';
import { getApiUrl } from '@club-ops/shared';

type TelemetryTrace = {
  trace_id: string;
  app: string;
  device_id: string;
  session_id: string;
  started_at: string;
  last_seen_at: string;
  incident_open: boolean;
  incident_last_at: string | null;
};

type TelemetrySpan = {
  id: string;
  trace_id: string;
  app: string;
  device_id: string;
  session_id: string;
  span_type: string;
  name: string | null;
  level: string;
  started_at: string;
  ended_at: string | null;
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

type TelemetryTraceResponse = {
  traces: TelemetryTrace[];
  page: {
    limit: number;
    hasMore: boolean;
    nextCursor: string | null;
    prevCursor: string | null;
  };
};

type TelemetryTraceDetail = {
  trace: TelemetryTrace;
  spans: TelemetrySpan[];
};

const SINCE_OPTIONS = [
  { value: '30m', label: 'Last 30 minutes' },
  { value: '2h', label: 'Last 2 hours' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
];

const LIMIT_OPTIONS = [50, 100, 200];
const RECENT_INCIDENT_MINUTES = 15;

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
  const [traces, setTraces] = useState<TelemetryTrace[]>([]);
  const [traceDetail, setTraceDetail] = useState<TelemetryTraceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [page, setPage] = useState<TelemetryTraceResponse['page'] | null>(null);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string>('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const [filters, setFilters] = useState({
    app: '',
    deviceId: '',
    sessionId: '',
    traceId: '',
    since: '2h',
    limit: 200,
    incidentOnly: false,
  });

  const abortRef = useRef<AbortController | null>(null);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (filters.since) p.set('since', filters.since);
    if (filters.app) p.set('app', filters.app);
    if (filters.deviceId) p.set('deviceId', filters.deviceId);
    if (filters.sessionId) p.set('sessionId', filters.sessionId);
    if (filters.traceId) p.set('traceId', filters.traceId);
    if (filters.incidentOnly) p.set('incidentOnly', 'true');
    p.set('limit', String(filters.limit));
    return p;
  }, [filters]);

  const loadTraces = useCallback(
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

        const data = await apiJson<TelemetryTraceResponse>(`/v1/admin/telemetry/traces?${p}`, {
          sessionToken: session.sessionToken,
          signal: ac.signal,
        });
        if (ac.signal.aborted) return;
        setTraces(data.traces || []);
        setPage(data.page || null);
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
    setPage(null);
    loadTraces();
    return () => {
      abortRef.current?.abort();
    };
  }, [loadTraces]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(() => {
      void loadTraces({ silent: true });
    }, 5000);
    return () => window.clearInterval(id);
  }, [autoRefresh, loadTraces]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const loadTraceDetail = useCallback(
    async (traceId: string) => {
      if (!session.sessionToken) return;
      try {
        const data = await apiJson<TelemetryTraceDetail>(`/v1/admin/telemetry/traces/${traceId}`, {
          sessionToken: session.sessionToken,
        });
        setTraceDetail(data);
        setSelectedIncidentId('');
      } catch (e) {
        if (e instanceof ApiError && e.status === 403) {
          setError('Admin access required.');
          return;
        }
        setError(e instanceof Error ? e.message : 'Failed to load trace');
      }
    },
    [session.sessionToken]
  );

  const handleDownload = async (format: 'json' | 'csv', incidentId?: string, bundle?: boolean) => {
    if (!session.sessionToken) return;
    if (!selectedTraceId) {
      setError('Select a trace to export.');
      return;
    }
    try {
      setError(null);
      const p = new URLSearchParams();
      p.set('traceId', selectedTraceId);
      if (incidentId) p.set('incidentId', incidentId);
      if (bundle) p.set('bundle', 'true');
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
      const suffix = incidentId ? `incident-${incidentId}` : 'trace';
      a.download = `telemetry-${suffix}-${new Date().toISOString()}.${format === 'csv' ? 'csv' : 'json'}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(downloadUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to export telemetry');
    }
  };

  const handleCopyIncidentJson = useCallback(async () => {
    if (!session.sessionToken || !selectedTraceId || !selectedIncidentId) return;
    try {
      setError(null);
      const p = new URLSearchParams();
      p.set('traceId', selectedTraceId);
      p.set('incidentId', selectedIncidentId);
      p.set('bundle', 'true');
      p.set('format', 'json');
      const url = getApiUrl(`/api/v1/admin/telemetry/export?${p.toString()}`);
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${session.sessionToken}`,
        },
      });
      if (!res.ok) {
        throw new ApiError(res.status, `Export failed (${res.status})`);
      }
      const jsonText = await res.text();
      await navigator.clipboard.writeText(jsonText);
      setToast({ message: 'Incident JSON copied to clipboard', type: 'success' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to copy incident JSON';
      setError(msg);
      setToast({ message: msg, type: 'error' });
    }
  }, [selectedIncidentId, selectedTraceId, session.sessionToken]);

  const incidentIds = useMemo(() => {
    if (!traceDetail?.spans) return [];
    const ids = new Set<string>();
    for (const span of traceDetail.spans) {
      if (span.incident_id) ids.add(span.incident_id);
    }
    return Array.from(ids.values());
  }, [traceDetail?.spans]);

  const breadcrumbs = useMemo(() => {
    if (!traceDetail?.spans) return [];
    return traceDetail.spans.filter((span) => {
      const meta = span.meta as Record<string, unknown> | null;
      return meta && typeof meta === 'object' && (meta as { breadcrumb?: boolean }).breadcrumb === true;
    });
  }, [traceDetail?.spans]);

  const incidents = useMemo(() => {
    if (!traceDetail?.spans) return [];
    const groups = new Map<string, TelemetrySpan[]>();
    for (const span of traceDetail.spans) {
      const id = span.incident_id;
      if (!id) continue;
      const arr = groups.get(id) ?? [];
      arr.push(span);
      groups.set(id, arr);
    }
    return Array.from(groups.entries());
  }, [traceDetail?.spans]);

  const isRecentIncident = (trace: TelemetryTrace) => {
    if (!trace.incident_last_at) return false;
    const diff = Date.now() - new Date(trace.incident_last_at).getTime();
    return diff <= RECENT_INCIDENT_MINUTES * 60 * 1000;
  };

  return (
    <div style={{ maxWidth: 1500, margin: '0 auto' }}>
      <section className="panel cs-liquid-card" style={{ marginBottom: '1.5rem' }}>
        <div className="panel-header">
          <h2>Telemetry</h2>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <button className="cs-liquid-button" onClick={() => loadTraces()}>
              Refresh
            </button>
            <button
              className="cs-liquid-button"
              disabled={!page?.nextCursor}
              onClick={() => loadTraces({ cursor: page?.nextCursor, direction: 'next' })}
            >
              Older
            </button>
            <button
              className="cs-liquid-button"
              disabled={!page?.prevCursor}
              onClick={() => loadTraces({ cursor: page?.prevCursor, direction: 'prev' })}
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
              Export Trace JSON
            </button>
            <button className="cs-liquid-button" onClick={() => handleDownload('csv')}>
              Export Trace CSV
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
            <label>Device</label>
            <input
              value={filters.deviceId}
              placeholder="device-id"
              onChange={(e) => setFilters((f) => ({ ...f, deviceId: e.target.value }))}
            />
          </div>
          <div className="filter-group">
            <label>Session</label>
            <input
              value={filters.sessionId}
              placeholder="session-id"
              onChange={(e) => setFilters((f) => ({ ...f, sessionId: e.target.value }))}
            />
          </div>
          <div className="filter-group">
            <label>Trace</label>
            <input
              value={filters.traceId}
              placeholder="trace-id"
              onChange={(e) => setFilters((f) => ({ ...f, traceId: e.target.value }))}
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
          <label className="telemetry-toggle">
            <input
              type="checkbox"
              checked={filters.incidentOnly}
              onChange={(e) => setFilters((f) => ({ ...f, incidentOnly: e.target.checked }))}
            />
            Incidents only
          </label>
        </div>

        <div className="panel-content" style={{ padding: '1rem 1.5rem 1.5rem' }}>
          {error && <div className="telemetry-error">{error}</div>}
          {loading && <div className="telemetry-loading">Loading…</div>}
          {!loading && !error && traces.length === 0 && (
            <div className="empty-state">No telemetry events found.</div>
          )}

          {traces.length > 0 && (
            <table className="rooms-table telemetry-table">
              <thead>
                <tr>
                  <th>Last Seen</th>
                  <th>App</th>
                  <th>Device</th>
                  <th>Session</th>
                  <th>Trace</th>
                  <th>Incident</th>
                </tr>
              </thead>
              <tbody>
                {traces.map((trace) => {
                  const isSelected = selectedTraceId === trace.trace_id;
                  const hasIncident = trace.incident_open || isRecentIncident(trace);
                  return (
                    <tr
                      key={trace.trace_id}
                      className={`telemetry-row ${isSelected ? 'is-open' : ''}`}
                      onClick={() => {
                        setSelectedTraceId(trace.trace_id);
                        void loadTraceDetail(trace.trace_id);
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>{formatTimestamp(trace.last_seen_at)}</td>
                      <td>{trace.app}</td>
                      <td>{trace.device_id}</td>
                      <td>{trace.session_id}</td>
                      <td>{truncate(trace.trace_id, 24)}</td>
                      <td>
                        {hasIncident ? (
                          <span className="telemetry-level telemetry-level-warn">
                            {trace.incident_open ? 'Open' : 'Recent'}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {traceDetail && (
        <section className="panel cs-liquid-card">
          <div className="panel-header">
            <h3>Trace Detail</h3>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {incidentIds.length > 0 && (
                <>
                  <select value={selectedIncidentId} onChange={(e) => setSelectedIncidentId(e.target.value)}>
                    <option value="">Select incident</option>
                    {incidentIds.map((id) => (
                      <option key={id} value={id}>
                        {id.slice(0, 12)}
                      </option>
                    ))}
                  </select>
                  <button
                    className="cs-liquid-button"
                    disabled={!selectedIncidentId}
                    onClick={() => void handleCopyIncidentJson()}
                  >
                    Copy Incident JSON
                  </button>
                  <button
                    className="cs-liquid-button"
                    disabled={!selectedIncidentId}
                    onClick={() => handleDownload('csv', selectedIncidentId, true)}
                  >
                    Export Incident CSV
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="panel-content" style={{ padding: '1rem 1.5rem 1.5rem' }}>
            <div className="telemetry-details-grid" style={{ marginBottom: '1rem' }}>
              <div>
                <div className="telemetry-label">Trace</div>
                <div className="telemetry-value">{traceDetail.trace.trace_id}</div>
              </div>
              <div>
                <div className="telemetry-label">App</div>
                <div className="telemetry-value">{traceDetail.trace.app}</div>
              </div>
              <div>
                <div className="telemetry-label">Device / Session</div>
                <div className="telemetry-value">
                  {traceDetail.trace.device_id} / {traceDetail.trace.session_id}
                </div>
              </div>
            </div>

            <div className="telemetry-stack" style={{ marginBottom: '1rem' }}>
              <div className="telemetry-label">Breadcrumbs</div>
              {breadcrumbs.length === 0 && <div className="telemetry-value">None</div>}
              {breadcrumbs.map((span) => (
                <div key={span.id} className="telemetry-value" style={{ marginBottom: '4px' }}>
                  {formatTimestamp(span.started_at)} — {span.span_type} — {span.name || span.message || '—'}
                </div>
              ))}
            </div>

            {incidents.length > 0 && (
              <div className="telemetry-stack">
                <div className="telemetry-label">Incidents</div>
                {incidents.map(([id, spans]) => (
                  <details key={id} style={{ marginBottom: '0.75rem' }}>
                    <summary>
                      Incident {id.slice(0, 12)} ({spans.length} spans)
                    </summary>
                    {spans.map((span) => (
                      <div key={span.id} style={{ marginTop: '0.5rem' }}>
                        {span.span_type === 'incident.report' && (
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            {(() => {
                              const meta = span.meta as Record<string, unknown> | null;
                              const severity = typeof meta?.severity === 'string' ? meta.severity : 'info';
                              const screen = typeof meta?.screen === 'string' ? meta.screen : 'unknown';
                              const levelClass =
                                severity === 'error'
                                  ? 'telemetry-level-error'
                                  : severity === 'warning'
                                    ? 'telemetry-level-warn'
                                    : 'telemetry-level-info';
                              return (
                                <>
                                  <span className={`telemetry-level ${levelClass}`}>{severity}</span>
                                  <span className="telemetry-value">Screen: {screen}</span>
                                </>
                              );
                            })()}
                          </div>
                        )}
                        <div className="telemetry-value">
                          {formatTimestamp(span.started_at)} — {span.span_type} — {span.name || span.message || '—'}
                        </div>
                        <div className="telemetry-details-grid" style={{ marginTop: '0.5rem' }}>
                          <div>
                            <div className="telemetry-label">Route</div>
                            <div className="telemetry-value">{span.route || '—'}</div>
                          </div>
                          <div>
                            <div className="telemetry-label">Method / Status</div>
                            <div className="telemetry-value">
                              {span.method || '—'} {span.status != null ? `(${span.status})` : ''}
                            </div>
                          </div>
                          <div>
                            <div className="telemetry-label">URL</div>
                            <div className="telemetry-value">{span.url || '—'}</div>
                          </div>
                          <div>
                            <div className="telemetry-label">Request Key</div>
                            <div className="telemetry-value">{span.request_key || '—'}</div>
                          </div>
                        </div>
                        <div className="telemetry-meta">
                          <div className="telemetry-label">Meta</div>
                          <pre>{formatMeta(span.meta)}</pre>
                        </div>
                        {(Boolean(span.request_headers) || Boolean(span.response_headers)) && (
                          <div className="telemetry-meta">
                            <div className="telemetry-label">Headers</div>
                            <pre>{formatMeta({ request: span.request_headers, response: span.response_headers })}</pre>
                          </div>
                        )}
                        {(Boolean(span.request_body) || Boolean(span.response_body)) && (
                          <div className="telemetry-meta">
                            <div className="telemetry-label">Bodies</div>
                            <pre>{formatMeta({ request: span.request_body, response: span.response_body })}</pre>
                          </div>
                        )}
                        {span.stack && (
                          <div className="telemetry-stack">
                            <div className="telemetry-label">Stack</div>
                            <pre>{span.stack}</pre>
                          </div>
                        )}
                        {span.span_type === 'incident.report' && span.message && (
                          <div className="telemetry-stack">
                            <div className="telemetry-label">Report</div>
                            <pre style={{ whiteSpace: 'pre-wrap' }}>{span.message}</pre>
                          </div>
                        )}
                      </div>
                    ))}
                  </details>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: '2rem',
            right: '2rem',
            padding: '1rem 1.5rem',
            background: toast.type === 'success' ? '#10b981' : '#ef4444',
            color: '#f9fafb',
            borderRadius: '8px',
            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)',
            zIndex: 1000,
          }}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
