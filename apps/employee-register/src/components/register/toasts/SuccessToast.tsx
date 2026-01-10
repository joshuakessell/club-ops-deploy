export interface SuccessToastProps {
  message: string | null;
  onDismiss: () => void;
  title?: string;
}

export function SuccessToast({ message, onDismiss, title = 'Success' }: SuccessToastProps) {
  if (!message) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: '1rem',
        right: '1rem',
        background: '#10b981',
        color: 'white',
        padding: '1rem',
        borderRadius: '8px',
        zIndex: 2000,
        maxWidth: '420px',
        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'start',
          marginBottom: '0.5rem',
          gap: '1rem',
        }}
      >
        <div style={{ fontWeight: 800 }}>{title}</div>
        <button
          onClick={onDismiss}
          className="cs-liquid-button cs-liquid-button--secondary"
          style={{
            fontSize: '1.25rem',
            cursor: 'pointer',
            padding: '0.2rem 0.55rem',
            lineHeight: 1,
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


