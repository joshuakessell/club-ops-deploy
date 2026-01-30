import { ModalFrame } from './ModalFrame';

export interface UpgradePaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  customerLabel: string;
  newRoomNumber?: string | null;
  offeredRoomNumber?: string | null;
  originalCharges: Array<{ description: string; amount: number }>;
  originalTotal: number | null;
  upgradeFee: number | null;
  paymentStatus: 'DUE' | 'PAID' | null;
  isSubmitting: boolean;
  canComplete: boolean;
  onPayCreditSuccess: () => void;
  onPayCashSuccess: () => void;
  onDecline: () => void;
  onComplete: () => void;
}

export function UpgradePaymentModal({
  isOpen,
  onClose,
  customerLabel,
  newRoomNumber,
  offeredRoomNumber,
  originalCharges,
  originalTotal,
  upgradeFee,
  paymentStatus,
  isSubmitting,
  canComplete,
  onPayCreditSuccess,
  onPayCashSuccess,
  onDecline,
  onComplete,
}: UpgradePaymentModalProps) {
  const totalDue = typeof upgradeFee === 'number' && Number.isFinite(upgradeFee) ? upgradeFee : 0;

  return (
    <ModalFrame isOpen={isOpen} title="Upgrade Payment Quote" onClose={onClose} maxWidth="560px">
      <div className="er-upgrade-stack">
        <div className="er-upgrade-header">
          <div className="er-upgrade-header-name">{customerLabel}</div>
          {(newRoomNumber || offeredRoomNumber) && (
            <div className="er-upgrade-header-sub">
              Upgrade to room {newRoomNumber || offeredRoomNumber}
            </div>
          )}
        </div>

        <div className="cs-liquid-card er-upgrade-card">
          <div className="er-upgrade-card-title">Already Paid</div>
          {originalCharges.length > 0 ? (
            <>
              {originalCharges.map((item, idx) => (
                <div
                  key={`${item.description}-${idx}`}
                  className="er-upgrade-row er-upgrade-row-muted"
                >
                  <span>{item.description}</span>
                  <span>${item.amount.toFixed(2)}</span>
                </div>
              ))}
              {originalTotal !== null && (
                <div
                  className="er-upgrade-row er-upgrade-row-muted er-upgrade-row-strong"
                >
                  <span>Original total</span>
                  <span>${originalTotal.toFixed(2)}</span>
                </div>
              )}
            </>
          ) : (
            <div className="er-upgrade-row-muted">All prior charges are settled.</div>
          )}
        </div>

        <div className="cs-liquid-card er-upgrade-card">
          <div className="er-upgrade-card-title">New Charge</div>
          <div className="er-upgrade-row er-upgrade-row-bright">
            <span>Upgrade Fee</span>
            <span>
              ${upgradeFee !== null && Number.isFinite(upgradeFee) ? upgradeFee.toFixed(2) : '—'}
            </span>
          </div>
        </div>

        <div className="cs-liquid-card er-upgrade-total">
          <div className="er-upgrade-card-title">Total Due</div>
          <div className="er-upgrade-total-amount">${totalDue.toFixed(2)}</div>
        </div>

        <div className="er-upgrade-actions">
          <button
            onClick={onPayCreditSuccess}
            disabled={isSubmitting || !canComplete}
            className="cs-liquid-button er-upgrade-action-btn"
          >
            Credit Success
          </button>
          <button
            onClick={onPayCashSuccess}
            disabled={isSubmitting || !canComplete}
            className="cs-liquid-button er-upgrade-action-btn"
          >
            Cash Success
          </button>
          <button
            onClick={onDecline}
            disabled={isSubmitting}
            className="cs-liquid-button cs-liquid-button--danger er-upgrade-action-btn"
          >
            Credit Decline
          </button>
        </div>

        <div className="er-upgrade-footer">
          <div
            className={[
              'er-upgrade-status',
              paymentStatus === 'PAID' ? 'er-upgrade-status--paid' : 'er-upgrade-status--due',
            ].join(' ')}
          >
            Status: {paymentStatus === 'PAID' ? 'Paid' : 'Payment Due'}
          </div>
          <button
            onClick={onComplete}
            disabled={paymentStatus !== 'PAID' || isSubmitting || !canComplete}
            className={[
              'cs-liquid-button',
              paymentStatus === 'PAID'
                ? 'cs-liquid-button--selected'
                : 'cs-liquid-button--secondary',
              'er-upgrade-complete-btn',
            ].join(' ')}
          >
            Complete Upgrade
          </button>
        </div>
      </div>
    </ModalFrame>
  );
}
