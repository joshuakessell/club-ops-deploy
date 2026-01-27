import { useEffect, useMemo, useRef, useState } from 'react';
import type { InventoryUpdatedPayload, WebSocketEvent } from '@club-ops/shared';
import { useLaneSession } from '@club-ops/shared';
import { safeJsonParse } from '@club-ops/ui';
import type { StaffSession } from './LockScreen';
import { apiJson, wsBaseUrl } from './api';
import { useNavigate } from 'react-router-dom';
import { getApiUrl } from '@club-ops/shared';
import { PanelContent } from './views/PanelContent';
import { PanelHeader } from './views/PanelHeader';
import { PanelShell } from './views/PanelShell';
import { RaisedCard } from './views/RaisedCard';

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
  const [docCustomerName, setDocCustomerName] = useState('');
  const [docLookupBusy, setDocLookupBusy] = useState(false);
  const [docLookupError, setDocLookupError] = useState<string | null>(null);
  const [docLookup, setDocLookup] = useState<null | {
    customers: Array<{
      id: string;
      name: string;
      dob: string | null;
      membership_number: string | null;
      last_visit_at: string | null;
    }>;
  }>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<null | {
    id: string;
    name: string;
    dob: string | null;
    membership_number: string | null;
    last_visit_at: string | null;
  }>(null);
  const [docHistoryBusy, setDocHistoryBusy] = useState(false);
  const [customerDocs, setCustomerDocs] = useState<null | {
    documents: Array<{
      id: string;
      doc_type: string;
      mime_type: string;
      created_at: string;
      has_signature: boolean;
      signature_hash_prefix?: string;
      has_pdf?: boolean;
      visit_started_at?: string | null;
    }>;
  }>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchSeqRef = useRef(0);
  const lastSearchTermRef = useRef('');

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

  const rawEnv = import.meta.env as unknown as Record<string, unknown>;
  const kioskToken =
    typeof rawEnv.VITE_KIOSK_TOKEN === 'string' && rawEnv.VITE_KIOSK_TOKEN.trim()
      ? rawEnv.VITE_KIOSK_TOKEN.trim()
      : '';
  void wsBaseUrl;
  const { lastMessage } = useLaneSession({
    laneId: '',
    role: 'employee',
    kioskToken,
    enabled: !!kioskToken,
  });

  useEffect(() => {
    if (!lastMessage) return;
    const msg = safeJsonParse<WebSocketEvent>(String(lastMessage.data));
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
        .then((m) =>
          setWaitlistMetrics({ activeCount: m.activeCount, offeredCount: m.offeredCount })
        )
        .catch(() => setWaitlistMetrics(null));
    }
  }, [lastMessage, session.sessionToken]);

  useEffect(() => {
    if (selectedCustomer) {
      searchAbortRef.current?.abort();
      setDocLookupBusy(false);
      return;
    }
    const trimmed = docCustomerName.trim();
    if (!trimmed) {
      setDocLookup(null);
      setDocLookupError(null);
      setDocLookupBusy(false);
      return;
    }
    if (trimmed === lastSearchTermRef.current && docLookup) return;
    const handle = window.setTimeout(() => {
      const seq = ++searchSeqRef.current;
      searchAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;
      lastSearchTermRef.current = trimmed;
      setDocLookupBusy(true);
      setDocLookupError(null);
      apiJson<{ customers: any[] }>(
        `/v1/documents/customers?name=${encodeURIComponent(trimmed)}`,
        {
          sessionToken: session.sessionToken,
          signal: controller.signal,
        }
      )
        .then((data) => {
          if (searchSeqRef.current !== seq) return;
          setDocLookup({
            customers: Array.isArray(data.customers) ? (data.customers as any) : [],
          });
        })
        .catch((e) => {
          if (controller.signal.aborted) return;
          if (searchSeqRef.current !== seq) return;
          setDocLookupError(e instanceof Error ? e.message : 'Failed to fetch');
        })
        .finally(() => {
          if (searchSeqRef.current !== seq) return;
          setDocLookupBusy(false);
        });
    }, 350);

    return () => window.clearTimeout(handle);
  }, [docCustomerName, selectedCustomer, session.sessionToken, docLookup]);

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

      <PanelShell spacing="md">
        <PanelHeader title="Administrative Demo Overview" />
        <PanelContent padding="md">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: '1rem',
            }}
          >
            <RaisedCard>
              <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>Live Lane Monitor</div>
              <div style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                Pick lane 1 or 2; see employee + customer mirrored state with live WS updates.
              </div>
              <button className="cs-liquid-button" onClick={() => navigate('/monitor')}>
                Open Monitor
              </button>
            </RaisedCard>

            <RaisedCard>
              <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>Waitlist Management</div>
              <div style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                Active / Offered lists, offer upgrades, complete or cancel, live refresh.
              </div>
              <button className="cs-liquid-button" onClick={() => navigate('/waitlist')}>
                Manage Waitlist
              </button>
            </RaisedCard>

            <RaisedCard>
              <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>
                Agreement PDF verification
              </div>
              <div style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                Search by customer name to verify PDF + signature artifacts, and download the PDF.
              </div>
              {selectedCustomer ? (
                <div style={{ display: 'grid', gap: '0.75rem' }}>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button
                      className="cs-liquid-button cs-liquid-button--secondary"
                      onClick={() => {
                        setSelectedCustomer(null);
                        setCustomerDocs(null);
                        setDocHistoryBusy(false);
                        setDocLookupError(null);
                      }}
                    >
                      Back to customer list
                    </button>
                  </div>
                  <div style={{ fontWeight: 800 }}>
                    {selectedCustomer.name}
                    {"'"}s Visit and Agreement History
                  </div>
                  {docLookupError && (
                    <div style={{ color: '#fecaca', fontWeight: 700 }}>{docLookupError}</div>
                  )}
                  {docHistoryBusy ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <div className="inline-spinner" aria-label="Loading history" />
                      <div style={{ color: 'var(--text-muted)' }}>Loading history…</div>
                    </div>
                  ) : customerDocs ? (
                    customerDocs.documents.length === 0 ? (
                      <div style={{ color: 'var(--text-muted)' }}>No agreements found.</div>
                    ) : (
                      <table className="rooms-table">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Download</th>
                          </tr>
                        </thead>
                        <tbody>
                          {customerDocs.documents.map((d) => (
                            <tr key={d.id}>
                              <td className="room-number">
                                {d.visit_started_at
                                  ? new Date(d.visit_started_at).toLocaleString()
                                  : d.created_at
                                    ? new Date(d.created_at).toLocaleString()
                                    : '—'}
                              </td>
                              <td>
                                <button
                                  className="cs-liquid-button"
                                  disabled={!d.has_pdf}
                                  onClick={() => {
                                    fetch(getApiUrl(`/api/v1/documents/${d.id}/download`), {
                                      headers: { Authorization: `Bearer ${session.sessionToken}` },
                                    })
                                      .then(async (res) => {
                                        if (!res.ok) throw new Error('Download failed');
                                        const blob = await res.blob();
                                        const obj = URL.createObjectURL(blob);
                                        window.open(obj, '_blank', 'noopener,noreferrer');
                                        window.setTimeout(() => URL.revokeObjectURL(obj), 60_000);
                                      })
                                      .catch((e) =>
                                        setDocLookupError(
                                          e instanceof Error ? e.message : 'Download failed'
                                        )
                                      );
                                  }}
                                >
                                  Download PDF
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )
                  ) : null}
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button
                      className="cs-liquid-button cs-liquid-button--secondary"
                      onClick={() => {
                        setDocCustomerName('');
                        setDocLookup(null);
                        setDocLookupError(null);
                        navigate('/overview');
                      }}
                    >
                      Back to menu
                    </button>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      gap: '0.5rem',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                    }}
                  >
                    <input
                      value={docCustomerName}
                      onChange={(e) => setDocCustomerName(e.target.value)}
                      placeholder="customer name…"
                      style={{
                        flex: '1 1 320px',
                        padding: '0.5rem 0.75rem',
                        background: 'var(--bg)',
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                        color: 'var(--text)',
                      }}
                    />
                    <button
                      className="cs-liquid-button cs-liquid-button--secondary"
                      disabled={docLookupBusy || !docCustomerName.trim()}
                      onClick={() => {
                        const name = docCustomerName.trim();
                        if (!name) return;
                        const seq = ++searchSeqRef.current;
                        searchAbortRef.current?.abort();
                        const controller = new AbortController();
                        searchAbortRef.current = controller;
                        lastSearchTermRef.current = name;
                        setDocLookupBusy(true);
                        setDocLookupError(null);
                        apiJson<{ customers: any[] }>(
                          `/v1/documents/customers?name=${encodeURIComponent(name)}`,
                          {
                            sessionToken: session.sessionToken,
                            signal: controller.signal,
                          }
                        )
                          .then((data) => {
                            if (searchSeqRef.current !== seq) return;
                            setDocLookup({
                              customers: Array.isArray(data.customers)
                                ? (data.customers as any)
                                : [],
                            });
                          })
                          .catch((e) => {
                            if (controller.signal.aborted) return;
                            if (searchSeqRef.current !== seq) return;
                            setDocLookupError(e instanceof Error ? e.message : 'Failed to fetch');
                          })
                          .finally(() => {
                            if (searchSeqRef.current !== seq) return;
                            setDocLookupBusy(false);
                          });
                      }}
                    >
                      {docLookupBusy ? 'Searching…' : 'Search'}
                    </button>
                    {docLookupBusy && (
                      <div className="inline-spinner" aria-label="Searching" />
                    )}
                  </div>
                  {docLookupError && (
                    <div style={{ marginTop: '0.75rem', color: '#fecaca', fontWeight: 700 }}>
                      {docLookupError}
                    </div>
                  )}
                  {docLookup && (
                    <div style={{ marginTop: '0.75rem', display: 'grid', gap: '0.5rem' }}>
                      {docLookup.customers.length === 0 ? (
                        <div style={{ color: 'var(--text-muted)' }}>No customers found.</div>
                      ) : (
                        <table className="rooms-table">
                          <thead>
                            <tr>
                              <th>Name</th>
                              <th>DOB</th>
                              <th>Membership #</th>
                              <th>Last Visit</th>
                              <th>Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {docLookup.customers.map((c) => (
                              <tr key={c.id}>
                                <td className="room-number">{c.name}</td>
                                <td>{c.dob ? new Date(c.dob).toLocaleDateString() : '—'}</td>
                                <td>{c.membership_number ?? '—'}</td>
                                <td>
                                  {c.last_visit_at
                                    ? new Date(c.last_visit_at).toLocaleString()
                                    : '—'}
                                </td>
                                <td>
                                  <button
                                    className="cs-liquid-button"
                                    onClick={() => {
                                      setSelectedCustomer(c);
                                      setCustomerDocs(null);
                                      setDocHistoryBusy(true);
                                      setDocLookupError(null);
                                      apiJson<{ documents: any[] }>(
                                        `/v1/documents/by-customer/${c.id}`,
                                        { sessionToken: session.sessionToken }
                                      )
                                        .then((data) =>
                                          setCustomerDocs({
                                            documents: Array.isArray(data.documents)
                                              ? (data.documents as any)
                                              : [],
                                          })
                                        )
                                        .catch((e) =>
                                          setDocLookupError(
                                            e instanceof Error ? e.message : 'Failed to fetch'
                                          )
                                        )
                                        .finally(() => setDocHistoryBusy(false));
                                    }}
                                  >
                                    View history
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </>
              )}
            </RaisedCard>

            <RaisedCard>
              <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>Customer Admin Tools</div>
              <div style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                Search customers; admin can clear notes and waive past-due balance.
              </div>
              <button className="cs-liquid-button" onClick={() => navigate('/customers')}>
                Open Customer Tools
              </button>
            </RaisedCard>

            <RaisedCard>
              <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>Reports (Demo)</div>
              <div style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                Inventory summary + low-availability tiers; cash totals by method/register.
              </div>
              <button className="cs-liquid-button" onClick={() => navigate('/reports')}>
                Open Reports
              </button>
            </RaisedCard>
          </div>
        </PanelContent>
      </PanelShell>

      <PanelShell>
        <PanelHeader title="Low Availability (tiers < 5 available)" />
        <PanelContent padding="md">
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
                        <button
                          className="cs-liquid-button cs-liquid-button--secondary"
                          onClick={() => navigate('/monitor')}
                        >
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
        </PanelContent>
      </PanelShell>
    </div>
  );
}
