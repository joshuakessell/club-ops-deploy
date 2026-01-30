export interface SuccessToastProps {
  message: string | null;
  onDismiss: () => void;
  title?: string;
}

export function SuccessToast({ message, onDismiss, title = 'Success' }: SuccessToastProps) {
  if (!message) return null;

  return (
    <div
      className="er-toast-overlay"
      role="dialog"
      aria-label={title}
      onClick={onDismiss}
    >
      <div
        className="cs-liquid-card er-toast-card er-toast-card--success"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="er-toast-header">
          <div className="er-toast-title">{title}</div>
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
