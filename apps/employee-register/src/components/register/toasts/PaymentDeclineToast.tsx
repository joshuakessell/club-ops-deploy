export interface PaymentDeclineToastProps {
  message: string | null;
  onDismiss: () => void;
}

export function PaymentDeclineToast({ message, onDismiss }: PaymentDeclineToastProps) {
  if (!message) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: '1rem',
        right: '1rem',
        background: '#ef4444',
        color: 'white',
        padding: '1rem',
        borderRadius: '8px',
        zIndex: 2000,
        maxWidth: '400px',
        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'start',
          marginBottom: '0.5rem',
        }}
      >
        <div style={{ fontWeight: 600 }}>Payment Declined</div>
        <button
          onClick={onDismiss}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'white',
            fontSize: '1.25rem',
            cursor: 'pointer',
            padding: 0,
            marginLeft: '1rem',
          }}
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
      <div style={{ fontSize: '0.875rem' }}>{message}</div>
    </div>
  );
}

