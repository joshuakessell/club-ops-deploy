import { t, type Language } from '../../i18n';
import { getRentalDisplayName } from '../../utils/display';
import type { CustomerConfirmationRequiredPayload } from '@club-ops/shared';
import { KioskModal } from '../../views/KioskModal';
import { KioskModalActions } from '../../views/KioskModalActions';

export interface CustomerConfirmationModalProps {
  isOpen: boolean;
  customerPrimaryLanguage: Language | null | undefined;
  data: CustomerConfirmationRequiredPayload;
  onAccept: () => void;
  onDecline: () => void;
  isSubmitting: boolean;
}

export function CustomerConfirmationModal({
  isOpen,
  customerPrimaryLanguage,
  data,
  onAccept,
  onDecline,
  isSubmitting,
}: CustomerConfirmationModalProps) {
  return (
    <KioskModal
      isOpen={isOpen}
      title={t(customerPrimaryLanguage, 'confirmDifferent.title')}
      closeOnOverlayClick={false}
    >
      <p>
        {t(customerPrimaryLanguage, 'confirmDifferent.youRequested')}{' '}
        <strong>{getRentalDisplayName(data.requestedType, customerPrimaryLanguage)}</strong>
      </p>
      <p>
        {t(customerPrimaryLanguage, 'confirmDifferent.staffSelected')}{' '}
        <strong>
          {getRentalDisplayName(data.selectedType, customerPrimaryLanguage)} {data.selectedNumber}
        </strong>
      </p>
      <p>{t(customerPrimaryLanguage, 'confirmDifferent.question')}</p>
      <KioskModalActions>
        <button
          className="cs-liquid-button ck-modal-btn"
          onClick={() => void onAccept()}
          disabled={isSubmitting}
        >
          {t(customerPrimaryLanguage, 'common.accept')}
        </button>
        <button
          className="cs-liquid-button cs-liquid-button--danger ck-modal-btn"
          onClick={() => void onDecline()}
          disabled={isSubmitting}
        >
          {t(customerPrimaryLanguage, 'common.decline')}
        </button>
      </KioskModalActions>
    </KioskModal>
  );
}
