import { useEffect, useMemo, useState } from 'react';
import { ModalFrame } from './ModalFrame';

type Step = 'select' | 'confirm';

type DetailedRoom = {
  id: string;
  number: string;
  status: string;
};

export interface RoomCleaningModalProps {
  isOpen: boolean;
  sessionToken: string;
  staffId: string;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

export function RoomCleaningModal({ isOpen, sessionToken, staffId, onClose, onSuccess }: RoomCleaningModalProps) {
  const [step, setStep] = useState<Step>('select');
  const [rooms, setRooms] = useState<DetailedRoom[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRoomIds, setSelectedRoomIds] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedRooms = useMemo(() => {
    const ids = selectedRoomIds;
    return rooms.filter((r) => ids.has(r.id)).sort((a, b) => a.number.localeCompare(b.number));
  }, [rooms, selectedRoomIds]);

  useEffect(() => {
    if (!isOpen) return;
    setStep('select');
    setRooms([]);
    setError(null);
    setSelectedRoomIds(new Set());
    setIsSubmitting(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
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
        const cleaningRooms: DetailedRoom[] = roomsRaw
          .filter((r) => typeof r?.id === 'string' && typeof r?.number === 'string' && typeof r?.status === 'string')
          .map((r) => ({ id: r.id as string, number: r.number as string, status: r.status as string }))
          .filter((r) => r.status === 'CLEANING');
        setRooms(cleaningRooms);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load inventory');
        setRooms([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [isOpen, sessionToken]);

  const toggleRoom = (roomId: string) => {
    setSelectedRoomIds((prev) => {
      const next = new Set(prev);
      if (next.has(roomId)) next.delete(roomId);
      else next.add(roomId);
      return next;
    });
  };

  const handleConfirm = async () => {
    if (selectedRoomIds.size === 0) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/cleaning/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          roomIds: Array.from(selectedRoomIds),
          targetStatus: 'CLEAN',
          staffId,
          override: false,
        }),
      });
      if (!res.ok) throw new Error('Failed to update room statuses');
      onClose();
      onSuccess('Rooms marked CLEAN');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update room statuses');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalFrame isOpen={isOpen} title="Room Cleaning" onClose={onClose} maxWidth="760px">
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

      {step === 'select' ? (
        <>
          <div style={{ fontWeight: 900, marginBottom: '0.75rem' }}>Rooms currently cleaning</div>
          {loading ? (
            <div style={{ padding: '0.75rem', color: '#94a3b8' }}>Loading…</div>
          ) : rooms.length === 0 ? (
            <div style={{ padding: '0.75rem', color: '#94a3b8' }}>No rooms in CLEANING</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.5rem' }}>
              {rooms.map((r) => {
                const selected = selectedRoomIds.has(r.id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    className={[
                      'cs-liquid-button',
                      selected ? 'cs-liquid-button--selected' : 'cs-liquid-button--secondary',
                    ].join(' ')}
                    aria-pressed={selected}
                    onClick={() => toggleRoom(r.id)}
                    style={{ justifyContent: 'space-between', padding: '0.75rem' }}
                  >
                    <span style={{ fontWeight: 900 }}>Room {r.number}</span>
                    <span style={{ color: 'rgba(148, 163, 184, 0.95)' }}>{selected ? 'Selected' : 'CLEANING'}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
            <button
              type="button"
              className="cs-liquid-button"
              disabled={selectedRoomIds.size === 0 || isSubmitting}
              onClick={() => setStep('confirm')}
            >
              Continue
            </button>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontWeight: 900, marginBottom: '0.5rem' }}>Confirm finish cleaning</div>
          <div style={{ color: '#94a3b8', marginBottom: '0.75rem' }}>
            Mark the following rooms as <strong>CLEAN</strong>:
          </div>
          <div className="er-surface" style={{ padding: '0.75rem', borderRadius: 12, marginBottom: '1rem' }}>
            {selectedRooms.map((r) => (
              <div key={r.id} style={{ fontWeight: 800, padding: '0.25rem 0' }}>
                Room {r.number}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button
              type="button"
              className="cs-liquid-button cs-liquid-button--secondary"
              onClick={() => setStep('select')}
              disabled={isSubmitting}
            >
              Back
            </button>
            <button
              type="button"
              className="cs-liquid-button"
              onClick={() => void handleConfirm()}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Confirming…' : 'Confirm'}
            </button>
          </div>
        </>
      )}
    </ModalFrame>
  );
}


