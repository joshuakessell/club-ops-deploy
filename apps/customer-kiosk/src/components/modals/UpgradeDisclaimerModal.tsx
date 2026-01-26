import { t, type Language } from '../../i18n';
import { KioskModal } from '../../views/KioskModal';
import { KioskModalActions } from '../../views/KioskModalActions';

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
  return (
    <KioskModal
      isOpen={isOpen}
      title={t(customerPrimaryLanguage, 'upgrade.title')}
      onClose={onClose}
    >
      <p>
        <strong>{t(customerPrimaryLanguage, 'upgrade.title')}</strong>
      </p>
      <ul className="ck-modal-list ck-modal-list--spaced">
        <li>{t(customerPrimaryLanguage, 'upgrade.bullet.feesApplyToRemaining')}</li>
        <li>{t(customerPrimaryLanguage, 'upgrade.bullet.noExtension')}</li>
        <li className="ck-modal-list__danger">
          {t(customerPrimaryLanguage, 'upgrade.bullet.noRefunds')}
        </li>
        <li>{t(customerPrimaryLanguage, 'upgrade.bullet.chargedWhenAccepted')}</li>
      </ul>
      <KioskModalActions>
        <button
          className="cs-liquid-button ck-modal-btn"
          onClick={() => void onAcknowledge()}
          disabled={isSubmitting}
        >
          {t(customerPrimaryLanguage, 'common.ok')}
        </button>
      </KioskModalActions>
    </KioskModal>
  );
}
