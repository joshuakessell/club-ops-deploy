export type BottomToastTone = 'info' | 'warning';

export interface BottomToast {
  id: string;
  message: string;
  tone?: BottomToastTone;
}

export function BottomToastStack(props: {
  toasts: BottomToast[];
  onDismiss: (id: string) => void;
}) {
  const { toasts, onDismiss } = props;
  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        left: '50%',
        bottom: '1rem',
        transform: 'translateX(-50%)',
        zIndex: 2200,
        width: 'min(680px, 92vw)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        pointerEvents: 'none',
      }}
      aria-live="polite"
      aria-label="Notifications"
    >
      {toasts.map((t) => {
        const tone = t.tone ?? 'info';
        const bg = tone === 'warning' ? '#f59e0b' : '#111827';
        const border = tone === 'warning' ? '#f59e0b' : '#334155';
        return (
          <div
            key={t.id}
            className="cs-liquid-card"
            style={{
              pointerEvents: 'auto',
              background: bg,
              color: 'white',
              border: `1px solid ${border}`,
              padding: '0.75rem 0.85rem',
              borderRadius: '12px',
              boxShadow: '0 10px 30px rgba(0, 0, 0, 0.45)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '0.75rem',
            }}
            role="status"
          >
            <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>{t.message}</div>
            <button
              onClick={() => onDismiss(t.id)}
              className="cs-liquid-button cs-liquid-button--secondary"
              style={{
                fontSize: '0.95rem',
                cursor: 'pointer',
                padding: '0.25rem 0.6rem',
                lineHeight: 1,
              }}
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

