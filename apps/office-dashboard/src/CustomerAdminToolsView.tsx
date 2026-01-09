import { useMemo, useState } from 'react';
import type { StaffSession } from './LockScreen';
import { ApiError, apiJson } from './api';
import { ReAuthModal } from './ReAuthModal';

type Customer = {
  id: string;
  name: string;
  membershipNumber: string | null;
  primaryLanguage: 'EN' | 'ES' | null;
  notes: string | null;
  pastDueBalance: number;
};

export function CustomerAdminToolsView({ session }: { session: StaffSession }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<null | {
    type: 'clearNotes' | 'waivePastDue';
  }>(null);

  const canSearch = q.trim().length >= 2;

  const runSearch = async () => {
    try {
      setError(null);
      setBusy(true);
      const data = await apiJson<{ customers: Customer[] }>(
        `/v1/admin/customers?search=${encodeURIComponent(q.trim())}`,
        { sessionToken: session.sessionToken }
      );
      setResults(data.customers || []);
      setSelected(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setBusy(false);
    }
  };

  const selectCustomer = (c: Customer) => {
    setSelected(c);
    setError(null);
  };

  const performAdminUpdate = async (action: 'clearNotes' | 'waivePastDue') => {
    if (!selected) return;
    const body = action === 'clearNotes' ? { notes: '' } : { pastDueBalance: 0 };

    try {
      setError(null);
      setBusy(true);
      const updated = await apiJson<Customer>(`/v1/admin/customers/${selected.id}`, {
        sessionToken: session.sessionToken,
        method: 'PATCH',
        body,
      });
      setSelected(updated);
      setResults((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setPendingAction({ type: action });
        setReauthOpen(true);
        return;
      }
      setError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  };

  const header = useMemo(() => {
    if (!selected) return 'Search customers';
    return `${selected.name}${selected.membershipNumber ? ` (${selected.membershipNumber})` : ''}`;
  }, [selected]);

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      {reauthOpen && (
        <ReAuthModal
          sessionToken={session.sessionToken}
          onCancel={() => {
            setReauthOpen(false);
            setPendingAction(null);
          }}
          onSuccess={async () => {
            setReauthOpen(false);
            if (pendingAction?.type) {
              await performAdminUpdate(pendingAction.type);
              setPendingAction(null);
            }
          }}
        />
      )}

      <section className="panel cs-liquid-card" style={{ marginBottom: '1.5rem' }}>
        <div className="panel-header">
          <h2>Customer Admin Tools</h2>
        </div>
        <div className="panel-content" style={{ padding: '1.25rem' }}>
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

          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="cs-liquid-search" style={{ minWidth: 360 }}>
              <input
                className="cs-liquid-input cs-liquid-search__input"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by name or membership #"
              />
              <div className="cs-liquid-search__icon">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M7.33333 12.6667C10.2789 12.6667 12.6667 10.2789 12.6667 7.33333C12.6667 4.38781 10.2789 2 7.33333 2C4.38781 2 2 4.38781 2 7.33333C2 10.2789 4.38781 12.6667 7.33333 12.6667Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M14 14L11.1 11.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </div>
            <button className="cs-liquid-button" disabled={!canSearch || busy} onClick={runSearch}>
              {busy ? 'Searching…' : 'Search'}
            </button>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              Admin can clear notes and waive past-due balance (requires re-auth).
            </div>
          </div>
        </div>
      </section>

      <div
        style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1.5rem' }}
      >
        <section className="panel cs-liquid-card">
          <div className="panel-header">
            <h2>Results ({results.length})</h2>
          </div>
          <div className="panel-content" style={{ padding: '1.25rem' }}>
            {results.length === 0 ? (
              <div style={{ color: 'var(--text-muted)' }}>
                {canSearch ? 'No results yet — run a search.' : 'Type at least 2 characters.'}
              </div>
            ) : (
              <table className="rooms-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Membership</th>
                    <th>Past Due</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => selectCustomer(c)}
                      style={{
                        cursor: 'pointer',
                        background: selected?.id === c.id ? 'rgba(43, 102, 184, 0.12)' : undefined,
                      }}
                    >
                      <td className="room-number">{c.name}</td>
                      <td>{c.membershipNumber || '—'}</td>
                      <td
                        style={{
                          color: c.pastDueBalance > 0 ? 'var(--warning)' : 'var(--text-muted)',
                          fontWeight: 700,
                        }}
                      >
                        ${c.pastDueBalance.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className="panel cs-liquid-card">
          <div className="panel-header">
            <h2>{header}</h2>
          </div>
          <div className="panel-content" style={{ padding: '1.25rem' }}>
            {!selected ? (
              <div className="placeholder">
                <span className="placeholder-icon">🗂️</span>
                <p>Select a customer to view/edit details.</p>
              </div>
            ) : (
              <>
                <table className="rooms-table" style={{ marginBottom: '1rem' }}>
                  <tbody>
                    <tr>
                      <td style={{ color: 'var(--text-muted)' }}>Customer ID</td>
                      <td style={{ fontFamily: 'monospace' }}>{selected.id}</td>
                    </tr>
                    <tr>
                      <td style={{ color: 'var(--text-muted)' }}>Primary Language</td>
                      <td>{selected.primaryLanguage || '—'}</td>
                    </tr>
                    <tr>
                      <td style={{ color: 'var(--text-muted)' }}>Past Due Balance</td>
                      <td
                        style={{
                          fontWeight: 800,
                          color: selected.pastDueBalance > 0 ? 'var(--warning)' : 'var(--text)',
                        }}
                      >
                        ${selected.pastDueBalance.toFixed(2)}
                      </td>
                    </tr>
                  </tbody>
                </table>

                <div className="csRaisedCard cs-liquid-card" style={{ padding: '1rem', marginBottom: '1rem' }}>
                  <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>Notes</div>
                  <pre
                    style={{
                      whiteSpace: 'pre-wrap',
                      margin: 0,
                      color: selected.notes ? 'var(--text)' : 'var(--text-muted)',
                    }}
                  >
                    {selected.notes?.trim() ? selected.notes : 'No notes.'}
                  </pre>
                  <div style={{ marginTop: '0.75rem' }}>
                    <button
                      className="cs-liquid-button cs-liquid-button--secondary"
                      disabled={busy}
                      onClick={() => performAdminUpdate('clearNotes')}
                    >
                      Clear Notes (admin)
                    </button>
                  </div>
                </div>

                <div className="csRaisedCard cs-liquid-card" style={{ padding: '1rem' }}>
                  <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>Past Due</div>
                  <div style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                    Waiving past due sets the customer’s past due balance to $0.00.
                  </div>
                  <button
                    className="btn-secondary"
                    disabled={busy || selected.pastDueBalance <= 0}
                    onClick={() => performAdminUpdate('waivePastDue')}
                  >
                    Waive Past Due (admin)
                  </button>
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
