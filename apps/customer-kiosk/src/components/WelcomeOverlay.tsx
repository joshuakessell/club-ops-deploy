import { t, type Language } from '../i18n';

export function WelcomeOverlay({
  isOpen,
  language,
  customerName,
  onDismiss,
}: {
  isOpen: boolean;
  language?: Language | null;
  customerName?: string | null;
  onDismiss: () => void;
}) {
  if (!isOpen) return null;
  return (
    <div
      className="welcome-overlay"
      onClick={onDismiss}
      role="dialog"
      aria-label={t(language, 'a11y.welcomeDialog')}
    >
      <div className="welcome-overlay-content">
        <div className="welcome-overlay-message">
          {t(language, 'welcome')}
          {customerName ? `, ${customerName}` : ''}
        </div>
      </div>
    </div>
  );
}
