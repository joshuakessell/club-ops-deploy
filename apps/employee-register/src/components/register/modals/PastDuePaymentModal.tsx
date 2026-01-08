import { ModalFrame } from './ModalFrame';

export interface PastDuePaymentModalProps {
  isOpen: boolean;
  quote: {
    total: number;
    lineItems: Array<{ description: string; amount: number }>;
    messages: string[];
  };
  onPayInSquare: (outcome: 'CASH_SUCCESS' | 'CREDIT_SUCCESS' | 'CREDIT_DECLINE', declineReason?: string) => void;
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
    <ModalFrame isOpen={isOpen} title={`Past Due Balance: $${quote.total.toFixed(2)}`} onClose={onClose}>
      <p style={{ marginBottom: '1.5rem', color: '#94a3b8' }}>
        Customer has a past due balance. Please process payment or bypass.
      </p>
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
          style={{
            padding: '0.75rem',
            background: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
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
          style={{
            padding: '0.75rem',
            background: '#10b981',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
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
          style={{
            padding: '0.75rem',
            background: '#ef4444',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
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
          style={{
            padding: '0.75rem',
            background: 'transparent',
            color: '#94a3b8',
            border: '1px solid #475569',
            borderRadius: '6px',
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
        style={{
          width: '100%',
          padding: '0.75rem',
          background: 'transparent',
          color: '#94a3b8',
          border: '1px solid #475569',
          borderRadius: '6px',
          cursor: 'pointer',
        }}
      >
        Cancel
      </button>
    </ModalFrame>
  );
}

