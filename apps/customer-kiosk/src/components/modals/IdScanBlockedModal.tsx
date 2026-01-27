import { t, type Language } from '../../i18n';
import { KioskModal } from '../../views/KioskModal';
import { KioskModalActions } from '../../views/KioskModalActions';

export interface IdScanBlockedModalProps {
  isOpen: boolean;
  issue: 'ID_EXPIRED' | 'UNDERAGE' | null;
  customerPrimaryLanguage: Language | null | undefined;
  onAcknowledge: () => void;
  isSubmitting: boolean;
}

export function IdScanBlockedModal({
  isOpen,
  issue,
  customerPrimaryLanguage,
  onAcknowledge,
  isSubmitting,
}: IdScanBlockedModalProps) {
  if (!issue) return null;

  const titleKey = issue === 'ID_EXPIRED' ? 'idScan.expired.title' : 'idScan.underage.title';
  const bodyKey = issue === 'ID_EXPIRED' ? 'idScan.expired.body' : 'idScan.underage.body';

  return (
    <KioskModal isOpen={isOpen} title={t(customerPrimaryLanguage, titleKey)} onClose={onAcknowledge}>
      <p>{t(customerPrimaryLanguage, bodyKey)}</p>
      <KioskModalActions>
        <button
          className="cs-liquid-button ck-modal-btn"
          onClick={onAcknowledge}
          disabled={isSubmitting}
        >
          {t(customerPrimaryLanguage, 'common.ok')}
        </button>
      </KioskModalActions>
    </KioskModal>
  );
}
