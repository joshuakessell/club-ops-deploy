import { ModalFrame } from './ModalFrame';

export interface PastDuePaymentModalProps {
  isOpen: boolean;
  quote: {
    total: number;
    lineItems: Array<{ description: string; amount: number }>;
    messages: string[];
  };
  onPayInSquare: (
    outcome: 'CASH_SUCCESS' | 'CREDIT_SUCCESS' | 'CREDIT_DECLINE',
    declineReason?: string
  ) => void;
  onManagerBypass: () => void;
  onClose: () => void;
  isSubmitting: boolean;
}

export function PastDuePaymentModal({
  isOpen,
  quote,
  onPayInSquare,
  onManagerBypass,
  onClose,
  isSubmitting,
}: PastDuePaymentModalProps) {
  return (
    <ModalFrame
      isOpen={isOpen}
      title={`Past Due Balance: $${quote.total.toFixed(2)}`}
      onClose={onClose}
    >
      <p style={{ marginBottom: '1.5rem', color: '#94a3b8' }}>
        Customer has a past due balance. Please process payment or bypass.
      </p>

      {(quote.lineItems.length > 0 || quote.messages.length > 0) && (
        <div
          className="cs-liquid-card glass-effect"
          style={{ padding: '0.75rem', marginBottom: '1rem', display: 'grid', gap: '0.5rem' }}
        >
          {quote.lineItems.length > 0 && (
            <div style={{ display: 'grid', gap: '0.35rem' }}>
              {quote.lineItems.map((li, idx) => (
                <div
                  key={`${li.description}-${idx}`}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                    color: '#e2e8f0',
                    fontWeight: 700,
                  }}
                >
                  <span style={{ color: '#cbd5e1' }}>{li.description}</span>
                  <span>${li.amount.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}

          {quote.messages.length > 0 && (
            <div style={{ display: 'grid', gap: '0.25rem' }}>
              {quote.messages.map((m, idx) => (
                <div key={idx} style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
                  {m}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
          marginBottom: '1rem',
        }}
      >
        <button
          onClick={() => onPayInSquare('CREDIT_SUCCESS')}
          disabled={isSubmitting}
          className="cs-liquid-button"
          style={{
            padding: '0.75rem',
            fontSize: '1rem',
            fontWeight: 600,
            cursor: isSubmitting ? 'not-allowed' : 'pointer',
          }}
        >
          Credit Success
        </button>
        <button
          onClick={() => onPayInSquare('CASH_SUCCESS')}
          disabled={isSubmitting}
          className="cs-liquid-button"
          style={{
            padding: '0.75rem',
            fontSize: '1rem',
            fontWeight: 600,
            cursor: isSubmitting ? 'not-allowed' : 'pointer',
          }}
        >
          Cash Success
        </button>
        <button
          onClick={() => onPayInSquare('CREDIT_DECLINE', 'Card declined')}
          disabled={isSubmitting}
          className="cs-liquid-button cs-liquid-button--danger"
          style={{
            padding: '0.75rem',
            fontSize: '1rem',
            fontWeight: 600,
            cursor: isSubmitting ? 'not-allowed' : 'pointer',
          }}
        >
          Credit Decline
        </button>
        <button
          onClick={onManagerBypass}
          disabled={isSubmitting}
          className="cs-liquid-button cs-liquid-button--secondary"
          style={{
            padding: '0.75rem',
            fontSize: '1rem',
            fontWeight: 600,
            cursor: isSubmitting ? 'not-allowed' : 'pointer',
          }}
        >
          Manager Bypass
        </button>
      </div>
      <button
        onClick={onClose}
        className="cs-liquid-button cs-liquid-button--danger"
        style={{
          width: '100%',
          padding: '0.75rem',
          cursor: 'pointer',
        }}
      >
        Cancel
      </button>
    </ModalFrame>
  );
}
