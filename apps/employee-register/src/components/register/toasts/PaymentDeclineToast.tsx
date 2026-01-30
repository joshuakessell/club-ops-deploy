export interface PaymentDeclineToastProps {
  message: string | null;
  onDismiss: () => void;
}

export function PaymentDeclineToast({ message, onDismiss }: PaymentDeclineToastProps) {
  if (!message) return null;

  return (
    <div
      className="er-toast-overlay"
      role="dialog"
      aria-label="Payment Declined"
      onClick={onDismiss}
    >
      <div
        className="cs-liquid-card er-toast-card er-toast-card--danger"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="er-toast-header">
          <div className="er-toast-title">Payment Declined</div>
          <button
            onClick={onDismiss}
            className="cs-liquid-button cs-liquid-button--secondary er-toast-dismiss"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
        <div className="er-toast-message">{message}</div>
      </div>
    </div>
  );
}
