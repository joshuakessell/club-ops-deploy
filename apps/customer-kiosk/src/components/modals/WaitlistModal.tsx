import { t, type Language } from '../../i18n';
import { getRentalDisplayName } from '../../utils/display';
import { KioskModal } from '../../views/KioskModal';
import { KioskModalActions } from '../../views/KioskModalActions';

export interface WaitlistModalProps {
  isOpen: boolean;
  customerPrimaryLanguage: Language | null | undefined;
  desiredType: string;
  allowedRentals: string[];
  inventory: {
    rooms: Record<string, number>;
    lockers: number;
  } | null;
  position: number | null;
  eta: string | null;
  upgradeFee: number | null;
  isSubmitting: boolean;
  highlightedBackupRental?: string | null;
  onBackupSelection: (rental: string) => void;
  onClose: () => void;
}

export function WaitlistModal({
  isOpen,
  customerPrimaryLanguage,
  desiredType,
  allowedRentals,
  inventory,
  position,
  eta,
  upgradeFee,
  isSubmitting,
  highlightedBackupRental = null,
  onBackupSelection,
  onClose,
}: WaitlistModalProps) {
  return (
    <KioskModal
      isOpen={isOpen}
      title={t(customerPrimaryLanguage, 'waitlist.modalTitle')}
      onClose={onClose}
    >
      <p>
        {t(customerPrimaryLanguage, 'waitlist.currentlyUnavailable', {
          rental: getRentalDisplayName(desiredType, customerPrimaryLanguage),
        })}
      </p>
      {position !== null && (
        <div className="ck-modal-info-box">
          <p className="ck-modal-info-title">{t(customerPrimaryLanguage, 'waitlist.infoTitle')}</p>
          <p>
            {t(customerPrimaryLanguage, 'waitlist.position')}: <strong>#{position}</strong>
          </p>
          {eta ? (
            <p>
              {t(customerPrimaryLanguage, 'waitlist.estimatedReady')}:{' '}
              <strong>{new Date(eta).toLocaleString()}</strong>
            </p>
          ) : (
            <p>
              {t(customerPrimaryLanguage, 'waitlist.estimatedReady')}:{' '}
              <strong>{t(customerPrimaryLanguage, 'waitlist.unknown')}</strong>
            </p>
          )}
          {upgradeFee !== null && upgradeFee > 0 && (
            <p className="ck-modal-info-warning">
              {t(customerPrimaryLanguage, 'waitlist.upgradeFee')}:{' '}
              <strong>${upgradeFee.toFixed(2)}</strong>
            </p>
          )}
        </div>
      )}
      <p className="ck-modal-spaced">{t(customerPrimaryLanguage, 'waitlist.instructions')}</p>
      <p className="ck-modal-note">{t(customerPrimaryLanguage, 'waitlist.noteChargedBackup')}</p>
      <div className="ck-modal-section">
        <p className="ck-modal-section-title">
          {t(customerPrimaryLanguage, 'waitlist.selectBackup')}
        </p>
        <div className="ck-modal-stack">
          {allowedRentals
            .filter((rental) => rental !== desiredType)
            .map((rental) => {
              const availableCount =
                inventory?.rooms[rental] ||
                (rental === 'LOCKER' || rental === 'GYM_LOCKER' ? inventory?.lockers : 0) ||
                0;
              const isAvailable = availableCount > 0;

              return (
                <button
                  key={rental}
                  className={[
                    'cs-liquid-button',
                    'ck-modal-btn',
                    highlightedBackupRental === rental ? 'ck-option-highlight' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => onBackupSelection(rental)}
                  disabled={!isAvailable || isSubmitting}
                  style={{
                    opacity: isAvailable ? 1 : 0.5,
                    cursor: isAvailable && !isSubmitting ? 'pointer' : 'not-allowed',
                  }}
                >
                  {getRentalDisplayName(rental, customerPrimaryLanguage)}
                  {!isAvailable && ` ${t(customerPrimaryLanguage, 'waitlist.unavailableSuffix')}`}
                </button>
              );
            })}
        </div>
      </div>
      <KioskModalActions>
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
