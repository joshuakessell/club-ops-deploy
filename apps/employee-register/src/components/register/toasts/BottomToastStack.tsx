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
    <div className="er-bottom-toast-stack" aria-live="polite" aria-label="Notifications">
      {toasts.map((t) => {
        const tone = t.tone ?? 'info';
        return (
          <div
            key={t.id}
            className={[
              'cs-liquid-card',
              'er-bottom-toast',
              tone === 'warning' ? 'er-bottom-toast--warning' : 'er-bottom-toast--info',
            ].join(' ')}
            role="status"
          >
            <div className="er-bottom-toast-message">{t.message}</div>
            <button
              onClick={() => onDismiss(t.id)}
              className="cs-liquid-button cs-liquid-button--secondary er-bottom-toast-dismiss"
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
