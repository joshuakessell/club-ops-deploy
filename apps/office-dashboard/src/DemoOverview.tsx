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

      <section className="panel" style={{ marginBottom: '1.5rem' }}>
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
            <div className="csRaisedCard" style={{ padding: '1rem' }}>
              <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>Live Lane Monitor</div>
              <div style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                Pick lane 1 or 2; see employee + customer mirrored state with live WS updates.
              </div>
              <button className="btn-primary" onClick={() => navigate('/monitor')}>
                Open Monitor
              </button>
            </div>

            <div className="csRaisedCard" style={{ padding: '1rem' }}>
              <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>Waitlist Management</div>
              <div style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                Active / Offered lists, offer upgrades, complete or cancel, live refresh.
              </div>
              <button className="btn-primary" onClick={() => navigate('/waitlist')}>
                Manage Waitlist
              </button>
            </div>

            <div className="csRaisedCard" style={{ padding: '1rem' }}>
              <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>Customer Admin Tools</div>
              <div style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                Search customers; admin can clear notes and waive past-due balance.
              </div>
              <button className="btn-primary" onClick={() => navigate('/customers')}>
                Open Customer Tools
              </button>
            </div>

            <div className="csRaisedCard" style={{ padding: '1rem' }}>
              <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>Reports (Demo)</div>
              <div style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                Inventory summary + low-availability tiers; cash totals by method/register.
              </div>
              <button className="btn-primary" onClick={() => navigate('/reports')}>
                Open Reports
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
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
                        <button className="btn-secondary" onClick={() => navigate('/monitor')}>
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
