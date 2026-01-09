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
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ color: '#cbd5e1' }}>
          <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>{customerLabel}</div>
          {(newRoomNumber || offeredRoomNumber) && (
            <div style={{ fontSize: '0.9rem', color: '#94a3b8' }}>
              Upgrade to room {newRoomNumber || offeredRoomNumber}
            </div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
            background: '#0b1220',
            border: '1px solid #334155',
            borderRadius: '8px',
            padding: '0.75rem',
          }}
        >
          <div style={{ fontWeight: 700, color: '#e2e8f0' }}>Already Paid</div>
          {originalCharges.length > 0 ? (
            <>
              {originalCharges.map((item, idx) => (
                <div
                  key={`${item.description}-${idx}`}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    color: '#94a3b8',
                    fontStyle: 'italic',
                  }}
                >
                  <span>{item.description}</span>
                  <span>${item.amount.toFixed(2)}</span>
                </div>
              ))}
              {originalTotal !== null && (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    color: '#94a3b8',
                    fontStyle: 'italic',
                    fontWeight: 600,
                  }}
                >
                  <span>Original total</span>
                  <span>${originalTotal.toFixed(2)}</span>
                </div>
              )}
            </>
          ) : (
            <div style={{ color: '#94a3b8', fontStyle: 'italic' }}>All prior charges are settled.</div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
            background: '#0b1220',
            border: '1px solid #334155',
            borderRadius: '8px',
            padding: '0.75rem',
          }}
        >
          <div style={{ fontWeight: 700, color: '#e2e8f0' }}>New Charge</div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              color: '#f8fafc',
              fontWeight: 600,
            }}
          >
            <span>Upgrade Fee</span>
            <span>${upgradeFee !== null && Number.isFinite(upgradeFee) ? upgradeFee.toFixed(2) : '—'}</span>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: '#0b1220',
            border: '1px solid #334155',
            borderRadius: '8px',
            padding: '0.75rem',
          }}
        >
          <div style={{ fontWeight: 700, color: '#e2e8f0' }}>Total Due</div>
          <div style={{ fontWeight: 800, color: '#f59e0b' }}>${totalDue.toFixed(2)}</div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: '0.5rem',
          }}
        >
          <button
            onClick={onPayCreditSuccess}
            disabled={isSubmitting || !canComplete}
            style={{
              padding: '0.75rem 1rem',
              background: '#22c55e',
              color: '#0b1220',
              border: 'none',
              borderRadius: '8px',
              fontWeight: 700,
              cursor: isSubmitting || !canComplete ? 'not-allowed' : 'pointer',
            }}
          >
            Credit Success
          </button>
          <button
            onClick={onPayCashSuccess}
            disabled={isSubmitting || !canComplete}
            style={{
              padding: '0.75rem 1rem',
              background: '#38bdf8',
              color: '#0b1220',
              border: 'none',
              borderRadius: '8px',
              fontWeight: 700,
              cursor: isSubmitting || !canComplete ? 'not-allowed' : 'pointer',
            }}
          >
            Cash Success
          </button>
          <button
            onClick={onDecline}
            disabled={isSubmitting}
            style={{
              padding: '0.75rem 1rem',
              background: '#f87171',
              color: '#0b1220',
              border: 'none',
              borderRadius: '8px',
              fontWeight: 700,
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
            }}
          >
            Credit Decline
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div
            style={{
              fontSize: '0.9rem',
              color: paymentStatus === 'PAID' ? '#10b981' : '#f59e0b',
              fontWeight: 700,
            }}
          >
            Status: {paymentStatus === 'PAID' ? 'Paid' : 'Payment Due'}
          </div>
          <button
            onClick={onComplete}
            disabled={paymentStatus !== 'PAID' || isSubmitting || !canComplete}
            style={{
              padding: '0.75rem 1.25rem',
              background: paymentStatus === 'PAID' && canComplete ? '#10b981' : '#475569',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontWeight: 700,
              cursor: paymentStatus === 'PAID' && canComplete && !isSubmitting ? 'pointer' : 'not-allowed',
            }}
          >
            Complete Upgrade
          </button>
        </div>
      </div>
    </ModalFrame>
  );
}


