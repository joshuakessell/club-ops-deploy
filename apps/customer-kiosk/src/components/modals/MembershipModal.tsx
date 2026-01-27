import { t, type Language } from '../../i18n';
import { KioskModal } from '../../views/KioskModal';
import { KioskModalActions } from '../../views/KioskModalActions';

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
  return (
    <KioskModal
      isOpen={isOpen}
      title={t(customerPrimaryLanguage, 'membership.modal.title')}
      onClose={onClose}
    >
      <p>
        {intent === 'PURCHASE'
          ? t(customerPrimaryLanguage, 'membership.modal.body.purchase')
          : t(customerPrimaryLanguage, 'membership.modal.body.renew')}
      </p>
      <KioskModalActions>
        <button
          className="cs-liquid-button ck-modal-btn"
          onClick={() => void onContinue()}
          disabled={isSubmitting}
        >
          {t(customerPrimaryLanguage, 'common.continue')}
        </button>
        <button
          className="cs-liquid-button cs-liquid-button--secondary ck-modal-btn"
          onClick={onClose}
          disabled={isSubmitting}
        >
          {t(customerPrimaryLanguage, 'common.cancel')}
        </button>
      </KioskModalActions>
    </KioskModal>
  );
}
