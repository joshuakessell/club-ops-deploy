import { t, type Language } from '../../i18n';

export interface UpgradeDisclaimerModalProps {
  isOpen: boolean;
  customerPrimaryLanguage: Language | null | undefined;
  onClose: () => void;
  onAcknowledge: () => void;
  isSubmitting: boolean;
}

export function UpgradeDisclaimerModal({
  isOpen,
  customerPrimaryLanguage,
  onClose,
  onAcknowledge,
  isSubmitting,
}: UpgradeDisclaimerModalProps) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2>{t(customerPrimaryLanguage, 'upgrade.title')}</h2>
        <div className="disclaimer-text">
          <p>
            <strong>{t(customerPrimaryLanguage, 'upgrade.title')}</strong>
          </p>
          <ul
            style={{
              listStyle: 'disc',
              paddingLeft: '1.5rem',
              textAlign: 'left',
              marginTop: '1rem',
            }}
          >
            <li style={{ marginBottom: '0.5rem' }}>
              {t(customerPrimaryLanguage, 'upgrade.bullet.feesApplyToRemaining')}
            </li>
            <li style={{ marginBottom: '0.5rem' }}>
              {t(customerPrimaryLanguage, 'upgrade.bullet.noExtension')}
            </li>
            <li style={{ marginBottom: '0.5rem', fontWeight: 600, color: '#ef4444' }}>
              {t(customerPrimaryLanguage, 'upgrade.bullet.noRefunds')}
            </li>
            <li style={{ marginBottom: '0.5rem' }}>
              {t(customerPrimaryLanguage, 'upgrade.bullet.chargedWhenAccepted')}
            </li>
          </ul>
        </div>
        <button
          className="btn-liquid-glass modal-ok-btn"
          onClick={() => void onAcknowledge()}
          disabled={isSubmitting}
        >
          {t(customerPrimaryLanguage, 'common.ok')}
        </button>
      </div>
    </div>
  );
}

