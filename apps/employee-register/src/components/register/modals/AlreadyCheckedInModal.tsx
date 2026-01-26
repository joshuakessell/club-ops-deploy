import { ModalFrame } from './ModalFrame';

export type ActiveCheckinDetails = {
  visitId: string;
  rentalType: string | null;
  assignedResourceType: 'room' | 'locker' | null;
  assignedResourceNumber: string | null;
  checkinAt: string | null;
  checkoutAt: string | null;
  currentTotalHours?: number | null;
  overdue: boolean | null;
  waitlist: null | {
    id: string;
    desiredTier: string;
    backupTier: string;
    status: string;
  };
};

export interface AlreadyCheckedInModalProps {
  isOpen: boolean;
  customerLabel?: string | null;
  activeCheckin: ActiveCheckinDetails | null;
  onClose: () => void;
}

export function AlreadyCheckedInModal({
  isOpen,
  customerLabel,
  activeCheckin,
  onClose,
}: AlreadyCheckedInModalProps) {
  const assignedLabel =
    activeCheckin?.assignedResourceType && activeCheckin?.assignedResourceNumber
      ? `${activeCheckin.assignedResourceType === 'room' ? 'Room' : 'Locker'} ${
          activeCheckin.assignedResourceNumber
        }`
      : '—';

  const checkoutAtLabel = activeCheckin?.checkoutAt
    ? new Date(activeCheckin.checkoutAt).toLocaleString()
    : '—';
  const checkinAtLabel = activeCheckin?.checkinAt
    ? new Date(activeCheckin.checkinAt).toLocaleString()
    : '—';

  return (
    <ModalFrame isOpen={isOpen} title="Already Checked In" onClose={onClose}>
      <div style={{ marginBottom: '1rem', color: '#e2e8f0' }}>
        {customerLabel ? (
          <div style={{ fontWeight: 800, marginBottom: '0.5rem' }}>{customerLabel}</div>
        ) : null}
        <div style={{ lineHeight: 1.5 }}>
          This customer currently has an active check-in. Please use the current visit (or check
          them out) instead of starting a new check-in.
        </div>
      </div>

      <div style={{ display: 'grid', gap: '0.6rem', marginBottom: '1rem' }}>
        <div>
          <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Assigned</div>
          <div style={{ fontWeight: 800 }}>{assignedLabel}</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div>
            <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Check-in</div>
            <div style={{ fontWeight: 700 }}>{checkinAtLabel}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Checkout</div>
            <div style={{ fontWeight: 700 }}>
              {checkoutAtLabel}{' '}
              {activeCheckin?.overdue ? <span style={{ color: '#f59e0b' }}>(overdue)</span> : null}
            </div>
          </div>
        </div>
        {activeCheckin?.waitlist ? (
          <div>
            <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Pending upgrade request</div>
            <div style={{ fontWeight: 800 }}>
              {activeCheckin.waitlist.desiredTier} (backup: {activeCheckin.waitlist.backupTier}) •{' '}
              {activeCheckin.waitlist.status}
            </div>
          </div>
        ) : null}
      </div>

      <button
        onClick={onClose}
        className="cs-liquid-button"
        style={{ width: '100%', padding: '0.75rem', fontSize: '1rem', fontWeight: 800 }}
      >
        OK
      </button>
    </ModalFrame>
  );
}
