import { t, type Language } from '../../i18n';
import { getRentalDisplayName } from '../../utils/display';
import type { CustomerConfirmationRequiredPayload } from '@club-ops/shared';

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
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={() => {}}>
      <div className="modal-content cs-liquid-card" onClick={(e) => e.stopPropagation()}>
        <h2>{t(customerPrimaryLanguage, 'confirmDifferent.title')}</h2>
        <div className="disclaimer-text">
          <p>
            {t(customerPrimaryLanguage, 'confirmDifferent.youRequested')}{' '}
            <strong>{getRentalDisplayName(data.requestedType, customerPrimaryLanguage)}</strong>
          </p>
          <p>
            {t(customerPrimaryLanguage, 'confirmDifferent.staffSelected')}{' '}
            <strong>
              {getRentalDisplayName(data.selectedType, customerPrimaryLanguage)}{' '}
              {data.selectedNumber}
            </strong>
          </p>
          <p>{t(customerPrimaryLanguage, 'confirmDifferent.question')}</p>
        </div>
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
          <button
            className="cs-liquid-button modal-ok-btn"
            onClick={() => void onAccept()}
            disabled={isSubmitting}
          >
            {t(customerPrimaryLanguage, 'common.accept')}
          </button>
          <button
            className="cs-liquid-button cs-liquid-button--danger modal-ok-btn"
            onClick={() => void onDecline()}
            disabled={isSubmitting}
          >
            {t(customerPrimaryLanguage, 'common.decline')}
          </button>
        </div>
      </div>
    </div>
  );
}
