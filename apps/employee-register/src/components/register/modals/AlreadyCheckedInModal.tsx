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
      <div className="er-modal-lead">
        {customerLabel ? <div className="er-modal-lead-title">{customerLabel}</div> : null}
        <div className="u-leading-relaxed">
          This customer currently has an active check-in. Please use the current visit (or check
          them out) instead of starting a new check-in.
        </div>
      </div>

      <div className="er-modal-grid-tight u-mb-16">
        <div>
          <div className="er-text-sm er-text-muted">Assigned</div>
          <div className="u-fw-800">{assignedLabel}</div>
        </div>
        <div className="er-modal-grid-split">
          <div>
            <div className="er-text-sm er-text-muted">Check-in</div>
            <div className="u-fw-700">{checkinAtLabel}</div>
          </div>
          <div>
            <div className="er-text-sm er-text-muted">Checkout</div>
            <div className="u-fw-700">
              {checkoutAtLabel}{' '}
              {activeCheckin?.overdue ? <span className="u-text-warning">(overdue)</span> : null}
            </div>
          </div>
        </div>
        {activeCheckin?.waitlist ? (
          <div>
            <div className="er-text-sm er-text-muted">Pending upgrade request</div>
            <div className="u-fw-800">
              {activeCheckin.waitlist.desiredTier} (backup: {activeCheckin.waitlist.backupTier}) •{' '}
              {activeCheckin.waitlist.status}
            </div>
          </div>
        ) : null}
      </div>

      <button
        onClick={onClose}
        className="cs-liquid-button er-modal-action-btn er-modal-action-btn--strong"
      >
        OK
      </button>
    </ModalFrame>
  );
}
