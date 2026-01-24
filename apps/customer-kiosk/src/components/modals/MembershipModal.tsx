import { t, type Language } from '../../i18n';

export interface MembershipModalProps {
  isOpen: boolean;
  customerPrimaryLanguage: Language | null | undefined;
  intent: 'PURCHASE' | 'RENEW';
  onContinue: () => void;
  onClose: () => void;
  isSubmitting: boolean;
}

export function MembershipModal({
  isOpen,
  customerPrimaryLanguage,
  intent,
  onContinue,
  onClose,
  isSubmitting,
}: MembershipModalProps) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content cs-liquid-card" onClick={(e) => e.stopPropagation()}>
        <h2>{t(customerPrimaryLanguage, 'membership.modal.title')}</h2>
        <div className="disclaimer-text">
          <p>
            {intent === 'PURCHASE'
              ? t(customerPrimaryLanguage, 'membership.modal.body.purchase')
              : t(customerPrimaryLanguage, 'membership.modal.body.renew')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
          <button
            className="cs-liquid-button modal-ok-btn"
            onClick={() => void onContinue()}
            disabled={isSubmitting}
          >
            {t(customerPrimaryLanguage, 'common.continue')}
          </button>
          <button
            className="cs-liquid-button cs-liquid-button--secondary modal-ok-btn"
            onClick={onClose}
            disabled={isSubmitting}
          >
            {t(customerPrimaryLanguage, 'common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
