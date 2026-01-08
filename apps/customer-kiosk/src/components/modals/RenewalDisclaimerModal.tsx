import { t, type Language } from '../../i18n';

export interface RenewalDisclaimerModalProps {
  isOpen: boolean;
  customerPrimaryLanguage: Language | null | undefined;
  blockEndsAt?: string | null;
  onClose: () => void;
  onProceed: () => void;
  isSubmitting: boolean;
}

export function RenewalDisclaimerModal({
  isOpen,
  customerPrimaryLanguage,
  blockEndsAt,
  onClose,
  onProceed,
  isSubmitting,
}: RenewalDisclaimerModalProps) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2>{t(customerPrimaryLanguage, 'renewal.title')}</h2>
        <div className="disclaimer-text">
          <ul style={{ listStyle: 'disc', paddingLeft: '1.5rem', textAlign: 'left' }}>
            <li style={{ marginBottom: '0.5rem' }}>
              {t(customerPrimaryLanguage, 'renewal.bullet.extendsStay')}
              {blockEndsAt && (
                <span>
                  {' '}
                  {t(customerPrimaryLanguage, 'renewal.currentCheckout', {
                    time: new Date(blockEndsAt).toLocaleString(),
                  })}
                </span>
              )}
            </li>
            <li style={{ marginBottom: '0.5rem', color: '#f59e0b', fontWeight: 600 }}>
              {t(customerPrimaryLanguage, 'renewal.bullet.approachingMax')}
            </li>
            <li style={{ marginBottom: '0.5rem' }}>
              {t(customerPrimaryLanguage, 'renewal.bullet.finalExtension')}
            </li>
            <li style={{ marginBottom: '0.5rem' }}>
              {t(customerPrimaryLanguage, 'renewal.bullet.feeNotChargedNow')}
            </li>
          </ul>
        </div>
        <button
          className="btn-liquid-glass modal-ok-btn"
          onClick={() => void onProceed()}
          disabled={isSubmitting}
        >
          {t(customerPrimaryLanguage, 'common.ok')}
        </button>
      </div>
    </div>
  );
}

