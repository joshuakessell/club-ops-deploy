import { useEffect, useMemo, useState } from 'react';
import type { InventoryUpdatedPayload, WebSocketEvent } from '@club-ops/shared';
import { safeJsonParse, useReconnectingWebSocket } from '@club-ops/ui';
import type { StaffSession } from './LockScreen';
import { apiJson, wsBaseUrl } from './api';
import { useNavigate } from 'react-router-dom';

type InventorySummaryResponse = {
  byType: Record<string, { clean: number; cleaning: number; dirty: number; total: number }>;
  overall: { clean: number; cleaning: number; dirty: number; total: number };
  lockers: { clean: number; cleaning: number; dirty: number; total: number };
};

export function DemoOverview({ session }: { session: StaffSession }) {
  const navigate = useNavigate();
  const [inventory, setInventory] = useState<InventorySummaryResponse | null>(null);
  const [waitlistMetrics, setWaitlistMetrics] = useState<{
    activeCount: number;
    offeredCount: number;
  } | null>(null);
  const [docSessionId, setDocSessionId] = useState('');
  const [docLookupBusy, setDocLookupBusy] = useState(false);
  const [docLookupError, setDocLookupError] = useState<string | null>(null);
  const [docLookup, setDocLookup] = useState<
    | null
    | {
        documents: Array<{
          id: string;
          doc_type: string;
          mime_type: string;
          created_at: string;
          has_signature: boolean;
          signature_hash_prefix?: string;
          has_pdf?: boolean;
        }>;
      }
  >(null);

  const lowAvailability = useMemo(() => {
    const byType = inventory?.byType || {};
    return Object.entries(byType)
      .map(([tier, c]) => ({ tier, available: c.clean }))
      .filter((x) => ['STANDARD', 'DOUBLE', 'SPECIAL'].includes(x.tier))
      .sort((a, b) => a.available - b.available);
  }, [inventory]);

  useEffect(() => {
    apiJson<InventorySummaryResponse>('/v1/inventory/summary')
      .then(setInventory)
      .catch(console.error);

    apiJson<{ activeCount: number; offeredCount: number; averageWaitTimeMinutes: number }>(
      '/v1/metrics/waitlist',
      { sessionToken: session.sessionToken }
    )
      .then((m) => setWaitlistMetrics({ activeCount: m.activeCount, offeredCount: m.offeredCount }))
      .catch(() => setWaitlistMetrics(null));
  }, [session.sessionToken]);

  useReconnectingWebSocket({
    url: wsBaseUrl(),
    onOpenSendJson: [{ type: 'subscribe', events: ['INVENTORY_UPDATED', 'WAITLIST_UPDATED'] }],
    onMessage: (event) => {
      const msg = safeJsonParse<WebSocketEvent>(String(event.data));
      if (!msg) return;
      if (msg.type === 'INVENTORY_UPDATED') {
        const payload = msg.payload as InventoryUpdatedPayload;
        setInventory(payload.inventory as unknown as InventorySummaryResponse);
      }
      if (msg.type === 'WAITLIST_UPDATED') {
        apiJson<{ activeCount: number; offeredCount: number; averageWaitTimeMinutes: number }>(
          '/v1/metrics/waitlist',
          { sessionToken: session.sessionToken }
        )
          .then((m) => setWaitlistMetrics({ activeCount: m.activeCount, offeredCount: m.offeredCount }))
          .catch(() => setWaitlistMetrics(null));
      }
    },
  });

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <section className="stats-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card">
          <span className="stat-value">{inventory?.overall.total ?? '—'}</span>
          <span className="stat-label">Total Rooms</span>
        </div>
        <div className="stat-card stat-available">
          <span className="stat-value">{inventory?.overall.clean ?? '—'}</span>
          <span className="stat-label">Available (Clean)</span>
        </div>
        <div className="stat-card stat-cleaning">
          <span className="stat-value">{inventory?.overall.cleaning ?? '—'}</span>
          <span className="stat-label">Cleaning</span>
        </div>
        <div className="stat-card stat-occupied">
          <span className="stat-value">
            {waitlistMetrics ? waitlistMetrics.activeCount + waitlistMetrics.offeredCount : '—'}
          </span>
          <span className="stat-label">Waitlist (A+O)</span>
        </div>
      </section>

      <section className="panel cs-liquid-card" style={{ marginBottom: '1.5rem' }}>
        <div className="panel-header">
          <h2>Administrative Demo Overview</h2>
        </div>
        <div className="panel-content" style={{ padding: '1.25rem' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: '1rem',
            }}
          >
            <div className="csRaisedCard cs-liquid-card" style={{ padding: '1rem' }}>
              <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>Live Lane Monitor</div>
              <div style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                Pick lane 1 or 2; see employee + customer mirrored state with live WS updates.
              </div>
              <button className="cs-liquid-button" onClick={() => navigate('/monitor')}>
                Open Monitor
              </button>
            </div>

            <div className="csRaisedCard cs-liquid-card" style={{ padding: '1rem' }}>
              <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>Waitlist Management</div>
              <div style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                Active / Offered lists, offer upgrades, complete or cancel, live refresh.
              </div>
              <button className="cs-liquid-button" onClick={() => navigate('/waitlist')}>
                Manage Waitlist
              </button>
            </div>

            <div className="csRaisedCard cs-liquid-card" style={{ padding: '1rem' }}>
              <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>Agreement PDF verification</div>
              <div style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                Paste a lane session ID to verify PDF + signature artifacts, and download the PDF.
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  value={docSessionId}
                  onChange={(e) => setDocSessionId(e.target.value)}
                  placeholder="lane session id (uuid)…"
                  style={{
                    flex: '1 1 320px',
                    padding: '0.5rem 0.75rem',
                    background: 'var(--bg)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    color: 'var(--text)',
                    fontFamily: 'monospace',
                  }}
                />
                <button
                  className="cs-liquid-button cs-liquid-button--secondary"
                  disabled={docLookupBusy || !docSessionId.trim()}
                  onClick={() => {
                    const sid = docSessionId.trim();
                    if (!sid) return;
                    setDocLookupBusy(true);
                    setDocLookupError(null);
                    apiJson<{ documents: any[] }>(`/v1/documents/by-session/${sid}`, {
                      sessionToken: session.sessionToken,
                    })
                      .then((data) => setDocLookup({ documents: Array.isArray(data.documents) ? (data.documents as any) : [] }))
                      .catch((e) => setDocLookupError(e instanceof Error ? e.message : 'Failed to fetch'))
                      .finally(() => setDocLookupBusy(false));
                  }}
                >
                  {docLookupBusy ? 'Checking…' : 'Check'}
                </button>
              </div>
              {docLookupError && (
                <div style={{ marginTop: '0.75rem', color: '#fecaca', fontWeight: 700 }}>{docLookupError}</div>
              )}
              {docLookup && (
                <div style={{ marginTop: '0.75rem', display: 'grid', gap: '0.5rem' }}>
                  {docLookup.documents.length === 0 ? (
                    <div style={{ color: 'var(--text-muted)' }}>No documents found.</div>
                  ) : (
                    docLookup.documents.map((d) => (
                      <div
                        key={d.id}
                        className="er-surface"
                        style={{ padding: '0.75rem', borderRadius: 12, display: 'grid', gap: '0.35rem' }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                          <div style={{ fontWeight: 900 }}>
                            {d.doc_type}{' '}
                            <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--text-muted)' }}>
                              {d.id}
                            </span>
                          </div>
                          <div style={{ color: 'var(--text-muted)' }}>
                            {d.created_at ? new Date(d.created_at).toLocaleString() : '—'}
                          </div>
                        </div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                          PDF stored: {d.has_pdf ? 'yes' : 'no'} • Signature stored: {d.has_signature ? 'yes' : 'no'}
                          {d.signature_hash_prefix ? ` • sig hash: ${d.signature_hash_prefix}…` : ''}
                        </div>
                        <div>
                          <button
                            className="cs-liquid-button"
                            disabled={!d.has_pdf}
                            onClick={() => {
                              fetch(`/api/v1/documents/${d.id}/download`, {
                                headers: { Authorization: `Bearer ${session.sessionToken}` },
                              })
                                .then(async (res) => {
                                  if (!res.ok) throw new Error('Download failed');
                                  const blob = await res.blob();
                                  const obj = URL.createObjectURL(blob);
                                  window.open(obj, '_blank', 'noopener,noreferrer');
                                  window.setTimeout(() => URL.revokeObjectURL(obj), 60_000);
                                })
                                .catch((e) => setDocLookupError(e instanceof Error ? e.message : 'Download failed'));
                            }}
                          >
                            Download PDF
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="csRaisedCard cs-liquid-card" style={{ padding: '1rem' }}>
              <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>Customer Admin Tools</div>
              <div style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                Search customers; admin can clear notes and waive past-due balance.
              </div>
              <button className="cs-liquid-button" onClick={() => navigate('/customers')}>
                Open Customer Tools
              </button>
            </div>

            <div className="csRaisedCard cs-liquid-card" style={{ padding: '1rem' }}>
              <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>Reports (Demo)</div>
              <div style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                Inventory summary + low-availability tiers; cash totals by method/register.
              </div>
              <button className="cs-liquid-button" onClick={() => navigate('/reports')}>
                Open Reports
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="panel cs-liquid-card">
        <div className="panel-header">
          <h2>Low Availability (tiers &lt; 5 available)</h2>
        </div>
        <div className="panel-content" style={{ padding: '1.25rem' }}>
          {lowAvailability.length === 0 ? (
            <div style={{ color: 'var(--text-muted)' }}>No inventory data yet.</div>
          ) : (
            <table className="rooms-table">
              <thead>
                <tr>
                  <th>Tier</th>
                  <th>Available (Clean)</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {lowAvailability.map((row) => (
                  <tr
                    key={row.tier}
                    style={{
                      background: row.available < 5 ? 'rgba(245, 158, 11, 0.08)' : undefined,
                    }}
                  >
                    <td className="room-number">{row.tier}</td>
                    <td
                      style={{
                        fontWeight: 700,
                        color: row.available < 5 ? 'var(--warning)' : 'var(--text)',
                      }}
                    >
                      {row.available}
                    </td>
                    <td>
                      {row.available < 5 ? (
                        <button className="cs-liquid-button cs-liquid-button--secondary" onClick={() => navigate('/monitor')}>
                          Monitor lanes
                        </button>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
