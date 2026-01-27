import { t, type Language } from '../../i18n';
import { KioskModal } from '../../views/KioskModal';
import { KioskModalActions } from '../../views/KioskModalActions';

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
  return (
    <KioskModal
      isOpen={isOpen}
      title={t(customerPrimaryLanguage, 'renewal.title')}
      onClose={onClose}
    >
      <ul className="ck-modal-list">
        <li>
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
        <li className="ck-modal-list__warning">
          {t(customerPrimaryLanguage, 'renewal.bullet.approachingMax')}
        </li>
        <li>{t(customerPrimaryLanguage, 'renewal.bullet.finalExtension')}</li>
        <li>{t(customerPrimaryLanguage, 'renewal.bullet.feeNotChargedNow')}</li>
      </ul>
      <KioskModalActions>
        <button
          className="cs-liquid-button ck-modal-btn"
          onClick={() => void onProceed()}
          disabled={isSubmitting}
        >
          {t(customerPrimaryLanguage, 'common.ok')}
        </button>
      </KioskModalActions>
    </KioskModal>
  );
}
