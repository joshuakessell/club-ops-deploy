import { useEffect, useMemo, useState } from 'react';

type DetailedRoom = {
  id: string;
  number: string;
  status: string;
};

export interface RoomCleaningPanelProps {
  sessionToken: string;
  staffId: string;
  onSuccess: (message: string) => void;
}

export function RoomCleaningPanel({ sessionToken, staffId, onSuccess }: RoomCleaningPanelProps) {
  const [rooms, setRooms] = useState<DetailedRoom[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRoomIds, setSelectedRoomIds] = useState<Set<string>>(new Set());
  const [activeList, setActiveList] = useState<'DIRTY' | 'CLEANING' | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const dirtyRooms = useMemo(
    () => rooms.filter((r) => r.status === 'DIRTY').sort((a, b) => a.number.localeCompare(b.number)),
    [rooms]
  );

  const cleaningRooms = useMemo(
    () => rooms.filter((r) => r.status === 'CLEANING').sort((a, b) => a.number.localeCompare(b.number)),
    [rooms]
  );

  const selectedRooms = useMemo(() => {
    const ids = selectedRoomIds;
    return rooms.filter((r) => ids.has(r.id)).sort((a, b) => a.number.localeCompare(b.number));
  }, [rooms, selectedRoomIds]);

  // Reset + fetch per mount
  useEffect(() => {
    let mounted = true;
    setRooms([]);
    setError(null);
    setSelectedRoomIds(new Set());
    setActiveList(null);
    setIsSubmitting(false);

    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/v1/inventory/detailed', {
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (!res.ok) throw new Error('Failed to load inventory');
        const data = (await res.json()) as { rooms?: Array<Record<string, unknown>> };
        const roomsRaw = Array.isArray(data.rooms) ? data.rooms : [];
        const relevant: DetailedRoom[] = roomsRaw
          .filter(
            (r): r is { id: string; number: string; status: string } =>
              typeof r?.id === 'string' && typeof r?.number === 'string' && typeof r?.status === 'string'
          )
          .map((r) => ({ id: r.id, number: r.number, status: r.status }))
          .filter((r) => r.status === 'CLEANING' || r.status === 'DIRTY');
        if (!mounted) return;
        setRooms(relevant);
      } catch (e) {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : 'Failed to load inventory');
        setRooms([]);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [sessionToken]);

  const toggleRoom = (roomId: string, source: 'DIRTY' | 'CLEANING') => {
    // Prevent mixed-status batch: selecting in one list clears the other.
    const switchingLists = Boolean(activeList && activeList !== source);
    const base = switchingLists ? new Set<string>() : new Set(selectedRoomIds);
    if (base.has(roomId)) base.delete(roomId);
    else base.add(roomId);

    setSelectedRoomIds(base);
    setActiveList(base.size === 0 ? null : source);
  };

  const handleConfirm = async () => {
    if (selectedRoomIds.size === 0) return;
    if (!activeList) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const targetStatus = activeList === 'DIRTY' ? 'CLEANING' : 'CLEAN';
      const res = await fetch('/api/v1/cleaning/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          roomIds: Array.from(selectedRoomIds),
          targetStatus,
          staffId,
          override: false,
        }),
      });
      if (!res.ok) throw new Error('Failed to update room statuses');
      onSuccess(targetStatus === 'CLEANING' ? 'Cleaning started' : 'Rooms marked CLEAN');
      // Reset selection after success
      setSelectedRoomIds(new Set());
      setActiveList(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update room statuses');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="cs-liquid-card er-main-panel-card">
      <div style={{ fontWeight: 900, fontSize: '1.1rem', marginBottom: '0.75rem' }}>Room Cleaning</div>

      {error && (
        <div
          style={{
            marginBottom: '0.75rem',
            padding: '0.75rem',
            background: 'rgba(239, 68, 68, 0.18)',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            borderRadius: 12,
            color: '#fecaca',
            fontWeight: 700,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ fontWeight: 900, marginBottom: '0.75rem' }}>Select rooms to begin or finish cleaning</div>

      {loading ? (
        <div style={{ padding: '0.75rem', color: '#94a3b8' }}>Loading…</div>
      ) : dirtyRooms.length === 0 && cleaningRooms.length === 0 ? (
        <div style={{ padding: '0.75rem', color: '#94a3b8' }}>No DIRTY or CLEANING rooms</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.75rem' }}>
          <div>
            <div className="er-text-sm" style={{ color: '#94a3b8', fontWeight: 800, marginBottom: '0.5rem' }}>
              DIRTY (ready to begin cleaning)
            </div>
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              {dirtyRooms.length === 0 ? (
                <div style={{ padding: '0.5rem', color: '#94a3b8' }}>None</div>
              ) : (
                dirtyRooms.map((r) => {
                  const selected = selectedRoomIds.has(r.id);
                  const disabled = activeList === 'CLEANING';
                  return (
                    <button
                      key={r.id}
                      type="button"
                      className={[
                        'cs-liquid-button',
                        selected ? 'cs-liquid-button--selected' : 'cs-liquid-button--secondary',
                      ].join(' ')}
                      aria-pressed={selected}
                      disabled={disabled || isSubmitting}
                      onClick={() => toggleRoom(r.id, 'DIRTY')}
                      style={{ justifyContent: 'space-between', padding: '0.75rem' }}
                    >
                      <span style={{ fontWeight: 900 }}>Room {r.number}</span>
                      <span style={{ color: 'rgba(148, 163, 184, 0.95)' }}>{selected ? 'Selected' : 'DIRTY'}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div>
            <div className="er-text-sm" style={{ color: '#94a3b8', fontWeight: 800, marginBottom: '0.5rem' }}>
              CLEANING (ready to finish cleaning)
            </div>
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              {cleaningRooms.length === 0 ? (
                <div style={{ padding: '0.5rem', color: '#94a3b8' }}>None</div>
              ) : (
                cleaningRooms.map((r) => {
                  const selected = selectedRoomIds.has(r.id);
                  const disabled = activeList === 'DIRTY';
                  return (
                    <button
                      key={r.id}
                      type="button"
                      className={[
                        'cs-liquid-button',
                        selected ? 'cs-liquid-button--selected' : 'cs-liquid-button--secondary',
                      ].join(' ')}
                      aria-pressed={selected}
                      disabled={disabled || isSubmitting}
                      onClick={() => toggleRoom(r.id, 'CLEANING')}
                      style={{ justifyContent: 'space-between', padding: '0.75rem' }}
                    >
                      <span style={{ fontWeight: 900 }}>Room {r.number}</span>
                      <span style={{ color: 'rgba(148, 163, 184, 0.95)' }}>{selected ? 'Selected' : 'CLEANING'}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {selectedRooms.length > 0 && (
        <div className="er-surface" style={{ padding: '0.75rem', borderRadius: 12, marginTop: '0.75rem' }}>
          <div className="er-text-sm" style={{ fontWeight: 900, marginBottom: '0.25rem' }}>
            Selected:
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {selectedRooms.map((r) => (
              <span key={r.id} className="er-text-sm" style={{ fontWeight: 800, color: '#fff' }}>
                Room {r.number}
              </span>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
            <button
              type="button"
              className="cs-liquid-button"
              onClick={() => void handleConfirm()}
              disabled={isSubmitting || selectedRoomIds.size === 0 || !activeList}
            >
              {activeList === 'DIRTY' ? 'Begin Cleaning' : 'Finish Cleaning'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

