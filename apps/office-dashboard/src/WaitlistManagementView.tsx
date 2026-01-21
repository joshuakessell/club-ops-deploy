import { useEffect, useMemo, useState } from 'react';
import type { WebSocketEvent } from '@club-ops/shared';
import { useLaneSession } from '@club-ops/shared';
import { safeJsonParse } from '@club-ops/ui';
import type { StaffSession } from './LockScreen';
import { ApiError, apiJson, wsBaseUrl } from './api';
import { ReAuthModal } from './ReAuthModal';

type WaitlistEntry = {
  id: string;
  desiredTier: 'STANDARD' | 'DOUBLE' | 'SPECIAL';
  backupTier: string;
  status: 'ACTIVE' | 'OFFERED' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';
  createdAt: string;
  offeredAt: string | null;
  completedAt: string | null;
  displayIdentifier: string;
  currentRentalType: string;
};

type Room = { id: string; number: string; status: string; type: string };

function getRoomTierFromNumber(roomNumber: string): 'STANDARD' | 'DOUBLE' | 'SPECIAL' {
  const num = parseInt(roomNumber, 10);
  if (num === 201 || num === 232 || num === 256) return 'SPECIAL';
  if (
    num === 216 ||
    num === 218 ||
    num === 232 ||
    num === 252 ||
    num === 256 ||
    num === 262 ||
    num === 225
  )
    return 'DOUBLE';
  return 'STANDARD';
}

export function WaitlistManagementView({ session }: { session: StaffSession }) {
  const [active, setActive] = useState<WaitlistEntry[]>([]);
  const [offered, setOffered] = useState<WaitlistEntry[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<WaitlistEntry | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reauthFor, setReauthFor] = useState<null | {
    action: 'cancel' | 'complete';
    entryId: string;
    paymentIntentId?: string;
  }>(null);

  const load = async () => {
    const [a, o, r] = await Promise.all([
      apiJson<{ entries: WaitlistEntry[] }>('/v1/waitlist?status=ACTIVE', {
        sessionToken: session.sessionToken,
      }),
      apiJson<{ entries: WaitlistEntry[] }>('/v1/waitlist?status=OFFERED', {
        sessionToken: session.sessionToken,
      }),
      apiJson<{ rooms: Room[] }>('/v1/inventory/rooms'),
    ]);
    setActive(a.entries || []);
    setOffered(o.entries || []);
    setRooms((r.rooms || []).filter((x) => x.status === 'CLEAN')); // demo: only clean rooms
  };

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (msg.type === 'WAITLIST_UPDATED' || msg.type === 'INVENTORY_UPDATED') {
      load().catch(() => {});
    }
  }, [lastMessage]);

  const availableRoomsForEntry = useMemo(() => {
    if (!selectedEntry) return [];
    return rooms
      .filter((r) => getRoomTierFromNumber(r.number) === selectedEntry.desiredTier)
      .sort((a, b) => parseInt(a.number, 10) - parseInt(b.number, 10));
  }, [rooms, selectedEntry]);

  const offerUpgrade = async (entry: WaitlistEntry) => {
    try {
      setError(null);
      setBusy(entry.id);
      const roomId = selectedRoomId;
      if (!roomId) throw new Error('Select a room first');
      await apiJson(`/v1/waitlist/${entry.id}/offer`, {
        sessionToken: session.sessionToken,
        method: 'POST',
        body: { waitlistId: entry.id, roomId },
      });
      setSelectedEntry(null);
      setSelectedRoomId('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to offer');
    } finally {
      setBusy(null);
    }
  };

  const startUpgrade = async (entry: WaitlistEntry) => {
    try {
      setError(null);
      setBusy(entry.id);
      const roomId = selectedRoomId;
      if (!roomId) throw new Error('Select a room first');
      const result = await apiJson<{
        paymentIntentId: string;
        upgradeFee: number;
        newRoomNumber: string;
      }>('/v1/upgrades/fulfill', {
        sessionToken: session.sessionToken,
        method: 'POST',
        body: { waitlistId: entry.id, roomId, acknowledgedDisclaimer: true },
      });
      // Demo: immediately mark paid via button in UI; keep the paymentIntentId in the reauth payload for completion.
      setReauthFor({
        action: 'complete',
        entryId: entry.id,
        paymentIntentId: result.paymentIntentId,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start upgrade');
    } finally {
      setBusy(null);
    }
  };

  const cancelEntry = async (entry: WaitlistEntry) => {
    try {
      setError(null);
      setBusy(entry.id);
      await apiJson(`/v1/waitlist/${entry.id}/cancel`, {
        sessionToken: session.sessionToken,
        method: 'POST',
        body: { waitlistId: entry.id, reason: 'Cancelled in office dashboard' },
      });
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setReauthFor({ action: 'cancel', entryId: entry.id });
        return;
      }
      setError(e instanceof Error ? e.message : 'Failed to cancel');
    } finally {
      setBusy(null);
    }
  };

  const completeUpgradeAfterReauth = async (entryId: string, paymentIntentId: string) => {
    // Demo completion flow:
    // 1) mark-paid (no reauth)
    // 2) upgrades/complete (requires reauth)
    await apiJson(`/v1/payments/${paymentIntentId}/mark-paid`, {
      sessionToken: session.sessionToken,
      method: 'POST',
      body: {},
    });
    await apiJson('/v1/upgrades/complete', {
      sessionToken: session.sessionToken,
      method: 'POST',
      body: { waitlistId: entryId, paymentIntentId },
    });
  };

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      {reauthFor && (
        <ReAuthModal
          sessionToken={session.sessionToken}
          onCancel={() => setReauthFor(null)}
          onSuccess={async () => {
            try {
              setError(null);
              if (reauthFor.action === 'cancel') {
                await apiJson(`/v1/waitlist/${reauthFor.entryId}/cancel`, {
                  sessionToken: session.sessionToken,
                  method: 'POST',
                  body: { waitlistId: reauthFor.entryId, reason: 'Cancelled in office dashboard' },
                });
              }
              if (reauthFor.action === 'complete' && reauthFor.paymentIntentId) {
                await completeUpgradeAfterReauth(reauthFor.entryId, reauthFor.paymentIntentId);
              }
              setReauthFor(null);
              await load();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Action failed');
              setReauthFor(null);
            }
          }}
        />
      )}

      <section className="panel cs-liquid-card" style={{ marginBottom: '1.5rem' }}>
        <div className="panel-header">
          <h2>Waitlist Management</h2>
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

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: '1.5rem',
            }}
          >
            <div className="csRaisedCard cs-liquid-card" style={{ padding: '1rem' }}>
              <div style={{ fontWeight: 700, marginBottom: '0.75rem' }}>
                ACTIVE ({active.length})
              </div>
              {active.length === 0 ? (
                <div style={{ color: 'var(--text-muted)' }}>No active entries.</div>
              ) : (
                <table className="rooms-table">
                  <thead>
                    <tr>
                      <th>Identifier</th>
                      <th>Desired</th>
                      <th>Current</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {active.map((e) => (
                      <tr key={e.id}>
                        <td className="room-number">{e.displayIdentifier}</td>
                        <td>{e.desiredTier}</td>
                        <td>{e.currentRentalType}</td>
                        <td>
                          <button
                            className="cs-liquid-button cs-liquid-button--secondary"
                            onClick={() => setSelectedEntry(e)}
                            style={{ marginRight: 8 }}
                          >
                            Offer
                          </button>
                          <button
                            className="cs-liquid-button cs-liquid-button--secondary"
                            onClick={() => cancelEntry(e)}
                            disabled={busy === e.id}
                          >
                            Cancel
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="csRaisedCard cs-liquid-card" style={{ padding: '1rem' }}>
              <div style={{ fontWeight: 700, marginBottom: '0.75rem' }}>
                OFFERED ({offered.length})
              </div>
              {offered.length === 0 ? (
                <div style={{ color: 'var(--text-muted)' }}>No offered entries.</div>
              ) : (
                <table className="rooms-table">
                  <thead>
                    <tr>
                      <th>Identifier</th>
                      <th>Desired</th>
                      <th>Offered At</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {offered.map((e) => (
                      <tr key={e.id}>
                        <td className="room-number">{e.displayIdentifier}</td>
                        <td>{e.desiredTier}</td>
                        <td className="last-change">
                          {e.offeredAt ? new Date(e.offeredAt).toLocaleString() : '—'}
                        </td>
                        <td>
                          <button
                            className="cs-liquid-button cs-liquid-button--secondary"
                            onClick={() => setSelectedEntry(e)}
                            style={{ marginRight: 8 }}
                          >
                            Complete
                          </button>
                          <button
                            className="cs-liquid-button cs-liquid-button--secondary"
                            onClick={() => cancelEntry(e)}
                            disabled={busy === e.id}
                          >
                            Cancel
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="panel cs-liquid-card">
        <div className="panel-header">
          <h2>
            {selectedEntry
              ? `Selected: ${selectedEntry.displayIdentifier}`
              : 'Select an entry to act'}
          </h2>
        </div>
        <div className="panel-content" style={{ padding: '1.25rem' }}>
          {!selectedEntry ? (
            <div style={{ color: 'var(--text-muted)' }}>
              Pick an entry from ACTIVE (Offer) or OFFERED (Complete). Then select a room in the
              desired tier.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ color: 'var(--text-muted)' }}>
                  Desired:{' '}
                  <strong style={{ color: 'var(--text)' }}>{selectedEntry.desiredTier}</strong>
                </div>
                <select
                  value={selectedRoomId}
                  onChange={(e) => setSelectedRoomId(e.target.value)}
                  style={{
                    padding: '0.5rem 0.75rem',
                    background: 'var(--bg)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    color: 'var(--text)',
                    fontWeight: 600,
                    minWidth: 240,
                  }}
                >
                  <option value="">Select room…</option>
                  {availableRoomsForEntry.map((r) => (
                    <option key={r.id} value={r.id}>
                      Room {r.number} ({getRoomTierFromNumber(r.number)})
                    </option>
                  ))}
                </select>
                {selectedEntry.status === 'ACTIVE' ? (
                  <button
                    className="cs-liquid-button"
                    onClick={() => offerUpgrade(selectedEntry)}
                    disabled={busy === selectedEntry.id}
                  >
                    Offer Upgrade
                  </button>
                ) : (
                  <button
                    className="cs-liquid-button"
                    onClick={() => startUpgrade(selectedEntry)}
                    disabled={busy === selectedEntry.id}
                  >
                    Complete Upgrade (demo)
                  </button>
                )}
                <button
                  className="cs-liquid-button cs-liquid-button--secondary"
                  onClick={() => {
                    setSelectedEntry(null);
                    setSelectedRoomId('');
                  }}
                >
                  Clear Selection
                </button>
              </div>

              <div style={{ marginTop: '1rem', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                Note: “Complete Upgrade” uses the demo flow: create upgrade payment intent → mark
                paid → finalize upgrade (requires re-auth).
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
