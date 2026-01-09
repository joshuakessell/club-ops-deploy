import { useEffect, useMemo, useState } from 'react';

const API_BASE = '/api';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getErrorMessage(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const msg = value['message'];
  const err = value['error'];
  if (typeof msg === 'string' && msg.trim()) return msg;
  if (typeof err === 'string' && err.trim()) return err;
  return undefined;
}

type OfferableRoom = {
  id: string;
  number: string;
  type: string;
};

export function OfferUpgradeModal(props: {
  isOpen: boolean;
  onClose: () => void;
  sessionToken: string;
  waitlistId: string;
  desiredTier: 'STANDARD' | 'DOUBLE' | 'SPECIAL';
  customerLabel?: string;
  disabled?: boolean;
  onOffered: () => void;
}) {
  const { isOpen, onClose, sessionToken, waitlistId, desiredTier, customerLabel, disabled, onOffered } =
    props;

  const [rooms, setRooms] = useState<OfferableRoom[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const title = useMemo(() => {
    const label = customerLabel ? ` for ${customerLabel}` : '';
    return `Offer ${desiredTier} Upgrade${label}`;
  }, [customerLabel, desiredTier]);

  const fetchOfferable = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/v1/rooms/offerable?tier=${encodeURIComponent(desiredTier)}`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (!res.ok) {
        const payload: unknown = await res.json().catch(() => null);
        throw new Error(getErrorMessage(payload) || 'Failed to load offerable rooms');
      }
      const data: unknown = await res.json().catch(() => null);
      const list = isRecord(data) && Array.isArray(data.rooms) ? data.rooms : [];
      const rooms = list
        .filter(isRecord)
        .filter((r) => typeof r.id === 'string' && typeof r.number === 'string' && typeof r.type === 'string')
        .map((r) => ({ id: r.id as string, number: r.number as string, type: r.type as string }));
      setRooms(rooms);
      setSelectedRoomId(rooms[0]?.id ?? null);
    } catch (e) {
      setRooms([]);
      setSelectedRoomId(null);
      setError(e instanceof Error ? e.message : 'Failed to load offerable rooms');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    void fetchOfferable();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, desiredTier, waitlistId]);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    if (!selectedRoomId) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/v1/waitlist/${waitlistId}/offer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ roomId: selectedRoomId }),
      });
      if (!res.ok) {
        const payload: unknown = await res.json().catch(() => null);
        const msg = getErrorMessage(payload) || 'Failed to offer upgrade';
        // Conflicts should be recoverable by refreshing the list.
        if (res.status === 409) {
          setError(msg);
          await fetchOfferable();
          return;
        }
        throw new Error(msg);
      }

      onOffered();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to offer upgrade');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="offer-upgrade-modal-overlay" role="dialog" aria-label="Offer upgrade modal">
      <div className="offer-upgrade-modal cs-liquid-card">
        <div className="offer-upgrade-modal-header">
          <div className="offer-upgrade-modal-title">{title}</div>
          <button
            className="offer-upgrade-modal-close cs-liquid-button cs-liquid-button--secondary"
            onClick={onClose}
            aria-label="Close offer modal"
          >
            ×
          </button>
        </div>

        {disabled && (
          <div className="offer-upgrade-modal-note">Active session present — offering is disabled</div>
        )}

        {error && <div className="offer-upgrade-modal-error">{error}</div>}

        <div className="offer-upgrade-modal-body">
          <div className="offer-upgrade-modal-subtitle">Select a room to reserve for this offer:</div>

          {isLoading ? (
            <div className="offer-upgrade-modal-loading">Loading…</div>
          ) : rooms.length === 0 ? (
            <div className="offer-upgrade-modal-empty">No offerable rooms available.</div>
          ) : (
            <div className="offer-upgrade-room-list">
              {rooms.map((r) => (
                <button
                  key={r.id}
                  className={`offer-upgrade-room-item cs-liquid-button cs-liquid-button--secondary ${selectedRoomId === r.id ? 'cs-liquid-button--selected selected' : ''}`}
                  onClick={() => setSelectedRoomId(r.id)}
                  disabled={Boolean(disabled) || isLoading}
                >
                  Room {r.number}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="offer-upgrade-modal-actions">
          <button
            className="offer-upgrade-cancel cs-liquid-button cs-liquid-button--danger"
            onClick={onClose}
            disabled={isLoading}
          >
            Cancel
          </button>
          <button
            className="offer-upgrade-confirm cs-liquid-button"
            onClick={() => void handleConfirm()}
            disabled={Boolean(disabled) || isLoading || !selectedRoomId}
          >
            Offer Selected Room
          </button>
        </div>
      </div>
    </div>
  );
}


