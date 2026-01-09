import { t, type Language } from '../../i18n';
import { getRentalDisplayName } from '../../utils/display';

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
  onBackupSelection,
  onClose,
}: WaitlistModalProps) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content cs-liquid-card" onClick={(e) => e.stopPropagation()}>
        <h2>{t(customerPrimaryLanguage, 'waitlist.modalTitle')}</h2>
        <div className="disclaimer-text">
          <p>
            {t(customerPrimaryLanguage, 'waitlist.currentlyUnavailable', {
              rental: getRentalDisplayName(desiredType, customerPrimaryLanguage),
            })}
          </p>
          {position !== null && (
            <div
              style={{
                marginTop: '1rem',
                padding: '0.75rem',
                background: '#1e293b',
                borderRadius: '6px',
              }}
            >
              <p style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
                {t(customerPrimaryLanguage, 'waitlist.infoTitle')}
              </p>
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
                <p style={{ color: '#f59e0b', marginTop: '0.5rem' }}>
                  {t(customerPrimaryLanguage, 'waitlist.upgradeFee')}:{' '}
                  <strong>${upgradeFee.toFixed(2)}</strong>
                </p>
              )}
            </div>
          )}
          <p style={{ marginTop: '1rem' }}>
            {t(customerPrimaryLanguage, 'waitlist.instructions')}
          </p>
          <p style={{ fontSize: '0.875rem', color: '#94a3b8', marginTop: '0.5rem' }}>
            {t(customerPrimaryLanguage, 'waitlist.noteChargedBackup')}
          </p>
        </div>
        <div style={{ marginTop: '1.5rem' }}>
          <p style={{ fontWeight: 600, marginBottom: '0.75rem' }}>
            {t(customerPrimaryLanguage, 'waitlist.selectBackup')}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
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
                    className="cs-liquid-button modal-ok-btn"
                    onClick={() => onBackupSelection(rental)}
                    disabled={!isAvailable || isSubmitting}
                    style={{
                      opacity: isAvailable ? 1 : 0.5,
                      cursor: isAvailable && !isSubmitting ? 'pointer' : 'not-allowed',
                    }}
                  >
                    {getRentalDisplayName(rental, customerPrimaryLanguage)}
                    {!isAvailable &&
                      ` ${t(customerPrimaryLanguage, 'waitlist.unavailableSuffix')}`}
                  </button>
                );
              })}
          </div>
        </div>
        <button
          className="cs-liquid-button cs-liquid-button--secondary modal-ok-btn"
          onClick={onClose}
          disabled={isSubmitting}
          style={{ marginTop: '1rem' }}
        >
          {t(customerPrimaryLanguage, 'common.cancel')}
        </button>
      </div>
    </div>
  );
}

