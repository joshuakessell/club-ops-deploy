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
      closeOnOverlayClick={false}
      showCloseButton={false}
    >
      <p className="er-text-muted u-mb-24">
        Customer has a past due balance. Please process payment or bypass.
      </p>

      {(quote.lineItems.length > 0 || quote.messages.length > 0) && (
        <div className="cs-liquid-card glass-effect er-pastdue-card">
          {quote.lineItems.length > 0 && (
            <div className="er-grid-gap-6">
              {quote.lineItems.map((li, idx) => (
                <div
                  key={`${li.description}-${idx}`}
                  className="u-flex u-justify-between u-gap-12 u-fw-700 er-text-soft"
                >
                  <span className="er-text-weak">{li.description}</span>
                  <span>${li.amount.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}

          {quote.messages.length > 0 && (
            <div className="u-grid u-gap-4">
              {quote.messages.map((m, idx) => (
                <div key={idx} className="er-text-sm er-text-muted">
                  {m}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="u-flex u-flex-col u-gap-12 u-mb-16">
        <button
          onClick={() => onPayInSquare('CREDIT_SUCCESS')}
          disabled={isSubmitting}
          className="cs-liquid-button"
          className="cs-liquid-button er-modal-button"
        >
          Credit Success
        </button>
        <button
          onClick={() => onPayInSquare('CASH_SUCCESS')}
          disabled={isSubmitting}
          className="cs-liquid-button"
          className="cs-liquid-button er-modal-button"
        >
          Cash Success
        </button>
        <button
          onClick={() => onPayInSquare('CREDIT_DECLINE', 'Card declined')}
          disabled={isSubmitting}
          className="cs-liquid-button cs-liquid-button--danger"
          className="cs-liquid-button cs-liquid-button--danger er-modal-button"
        >
          Credit Decline
        </button>
        <button
          onClick={onManagerBypass}
          disabled={isSubmitting}
          className="cs-liquid-button cs-liquid-button--secondary"
          className="cs-liquid-button cs-liquid-button--secondary er-modal-button"
        >
          Manager Bypass
        </button>
      </div>
    </ModalFrame>
  );
}
