import { useEffect, useMemo, useState } from 'react';
import type { InventoryUpdatedPayload, WebSocketEvent } from '@club-ops/shared';
import type { StaffSession } from './LockScreen';
import { apiJson, wsBaseUrl } from './api';

type InventorySummaryResponse = {
  byType: Record<string, { clean: number; cleaning: number; dirty: number; total: number }>;
  overall: { clean: number; cleaning: number; dirty: number; total: number };
  lockers: { clean: number; cleaning: number; dirty: number; total: number };
};

type CashTotals = {
  date: string;
  total: number;
  byPaymentMethod: Record<string, number>;
  byRegister: Record<string, number>;
};

export function ReportsDemoView({ session }: { session: StaffSession }) {
  const [inventory, setInventory] = useState<InventorySummaryResponse | null>(null);
  const [cash, setCash] = useState<CashTotals | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const [inv, cashTotals] = await Promise.all([
      apiJson<InventorySummaryResponse>('/v1/inventory/summary'),
      apiJson<CashTotals>('/v1/admin/reports/cash-totals', { sessionToken: session.sessionToken }),
    ]);
    setInventory(inv);
    setCash(cashTotals);
  };

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load reports'));
    const ws = new WebSocket(wsBaseUrl());
    ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe', events: ['INVENTORY_UPDATED'] }));
    ws.onmessage = (event) => {
      try {
        const msg: WebSocketEvent = JSON.parse(event.data);
        if (msg.type === 'INVENTORY_UPDATED') {
          const payload = msg.payload as InventoryUpdatedPayload;
          setInventory(payload.inventory as unknown as InventorySummaryResponse);
        }
      } catch {
        // ignore
      }
    };
    return () => ws.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.sessionToken]);

  const lowTiers = useMemo(() => {
    const byType = inventory?.byType || {};
    return ['STANDARD', 'DOUBLE', 'SPECIAL']
      .map((t) => ({ tier: t, available: byType[t]?.clean ?? 0 }))
      .filter((x) => x.available < 5);
  }, [inventory]);

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      {error && (
        <div
          style={{
            marginBottom: '1rem',
            padding: '0.75rem',
            border: '1px solid var(--error)',
            borderRadius: 8,
            color: 'var(--error)',
          }}
        >
          {error}
        </div>
      )}

      <section className="panel" style={{ marginBottom: '1.5rem' }}>
        <div className="panel-header">
          <h2>Inventory Summary</h2>
        </div>
        <div className="panel-content" style={{ padding: '1.25rem' }}>
          <section
            className="stats-grid"
            style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 0 }}
          >
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
              <span className="stat-value">{inventory?.lockers.clean ?? '—'}</span>
              <span className="stat-label">Lockers Available</span>
            </div>
          </section>
        </div>
      </section>

      <section className="panel" style={{ marginBottom: '1.5rem' }}>
        <div className="panel-header">
          <h2>Low Availability Alerts</h2>
        </div>
        <div className="panel-content" style={{ padding: '1.25rem' }}>
          {lowTiers.length === 0 ? (
            <div style={{ color: 'var(--text-muted)' }}>No tiers under 5 available.</div>
          ) : (
            <table className="rooms-table">
              <thead>
                <tr>
                  <th>Tier</th>
                  <th>Available (Clean)</th>
                </tr>
              </thead>
              <tbody>
                {lowTiers.map((t) => (
                  <tr key={t.tier} style={{ background: 'rgba(245, 158, 11, 0.08)' }}>
                    <td className="room-number">{t.tier}</td>
                    <td style={{ fontWeight: 800, color: 'var(--warning)' }}>{t.available}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Cash Totals (Demo)</h2>
        </div>
        <div className="panel-content" style={{ padding: '1.25rem' }}>
          {!cash ? (
            <div style={{ color: 'var(--text-muted)' }}>Loading…</div>
          ) : (
            <>
              <div style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
                Date: {cash.date}
              </div>
              <section className="stats-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                <div className="stat-card">
                  <span className="stat-value">${cash.total.toFixed(2)}</span>
                  <span className="stat-label">Today Total</span>
                </div>
                <div className="stat-card stat-available">
                  <span className="stat-value">${(cash.byPaymentMethod.CASH || 0).toFixed(2)}</span>
                  <span className="stat-label">Cash</span>
                </div>
                <div className="stat-card stat-cleaning">
                  <span className="stat-value">
                    ${(cash.byPaymentMethod.CREDIT || 0).toFixed(2)}
                  </span>
                  <span className="stat-label">Credit</span>
                </div>
              </section>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                  gap: '1.5rem',
                  marginTop: '1.5rem',
                }}
              >
                <div className="csRaisedCard" style={{ padding: '1rem' }}>
                  <div style={{ fontWeight: 700, marginBottom: '0.75rem' }}>By Payment Method</div>
                  <table className="rooms-table">
                    <tbody>
                      {Object.entries(cash.byPaymentMethod).map(([k, v]) => (
                        <tr key={k}>
                          <td style={{ color: 'var(--text-muted)' }}>{k}</td>
                          <td style={{ fontWeight: 800 }}>${v.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="csRaisedCard" style={{ padding: '1rem' }}>
                  <div style={{ fontWeight: 700, marginBottom: '0.75rem' }}>By Register</div>
                  <table className="rooms-table">
                    <tbody>
                      {Object.entries(cash.byRegister).map(([k, v]) => (
                        <tr key={k}>
                          <td style={{ color: 'var(--text-muted)' }}>{k}</td>
                          <td style={{ fontWeight: 800 }}>${v.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
