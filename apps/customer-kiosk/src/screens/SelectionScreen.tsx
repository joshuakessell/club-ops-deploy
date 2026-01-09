import { ReactNode } from 'react';
import { I18nProvider, t } from '../i18n';
import { ScreenShell } from '../components/ScreenShell';
import { getRentalDisplayName } from '../utils/display';
import { getMembershipStatus, type SessionState } from '../utils/membership';

const DISPLAY_PRICE_BY_RENTAL: Record<string, number> = {
  LOCKER: 24,
  GYM_LOCKER: 0,
  STANDARD: 30,
  DOUBLE: 40,
  SPECIAL: 50,
};

const SIX_MONTH_MEMBERSHIP_PRICE = 43;

function formatWholeDollars(amount: number): string {
  return `$${Math.round(amount)}`;
}

export interface SelectionScreenProps {
  session: SessionState;
  inventory: {
    rooms: Record<string, number>;
    lockers: number;
  } | null;
  proposedRentalType: string | null;
  proposedBy: 'CUSTOMER' | 'EMPLOYEE' | null;
  selectionConfirmed: boolean;
  selectionConfirmedBy: 'CUSTOMER' | 'EMPLOYEE' | null;
  selectedRental: string | null;
  isSubmitting: boolean;
  orientationOverlay: ReactNode;
  welcomeOverlay: ReactNode;
  onSelectRental: (rental: string) => void;
  onOpenMembershipModal: (intent: 'PURCHASE' | 'RENEW') => void;
}

export function SelectionScreen({
  session,
  inventory,
  proposedRentalType,
  proposedBy,
  selectionConfirmed,
  selectionConfirmedBy,
  selectedRental,
  isSubmitting,
  orientationOverlay,
  welcomeOverlay,
  onSelectRental,
  onOpenMembershipModal,
}: SelectionScreenProps) {
  return (
    <I18nProvider lang={session.customerPrimaryLanguage}>
      <ScreenShell backgroundVariant="steamroom1" showLogoWatermark={true} watermarkLayer="under">
        {orientationOverlay}
        {welcomeOverlay}
        <div className="active-content">
          <main className="main-content">
            <div className="customer-info">
              <h1 className="customer-name">
                {session.customerName
                  ? t(session.customerPrimaryLanguage, 'selection.welcomeWithName', {
                      name: session.customerName,
                    })
                  : t(session.customerPrimaryLanguage, 'welcome')}
              </h1>
            </div>

            {/* Membership Level - locked buttons */}
            <div className="membership-level-section">
              <p className="section-label">{t(session.customerPrimaryLanguage, 'membership.level')}</p>
              {(() => {
                const lang = session.customerPrimaryLanguage;
                const status = getMembershipStatus(session, Date.now());
                const isActive = status === 'ACTIVE';
                const isPending = status === 'PENDING';
                const isExpired = status === 'EXPIRED';
                const isNonMember = status === 'NON_MEMBER';

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <div
                      className="cs-liquid-button cs-liquid-button--disabled"
                      style={{
                        opacity: 1,
                        cursor: 'default',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.75rem',
                        padding: '0.9rem 1rem',
                      }}
                    >
                      <span style={{ fontWeight: 700 }}>
                        {isActive || isPending
                          ? t(lang, 'membership.member')
                          : t(lang, 'membership.nonMember')}
                      </span>
                      {isPending && (
                        <span
                          style={{
                            padding: '0.25rem 0.6rem',
                            borderRadius: '999px',
                            background: '#f59e0b',
                            color: 'black',
                            fontWeight: 800,
                            fontSize: '0.85rem',
                          }}
                        >
                          {t(lang, 'membership.pending')}
                        </span>
                      )}
                      {isExpired && !isPending && (
                        <span
                          style={{
                            padding: '0.25rem 0.6rem',
                            borderRadius: '999px',
                            background: '#ef4444',
                            color: 'white',
                            fontWeight: 700,
                            fontSize: '0.85rem',
                          }}
                        >
                          {t(lang, 'membership.expired')}
                        </span>
                      )}
                    </div>

                    {isNonMember && (
                      <button
                        className="cs-liquid-button"
                        onClick={() => onOpenMembershipModal('PURCHASE')}
                        disabled={isSubmitting}
                      >
                        {t(lang, 'membership.purchase6Month')} —{' '}
                        {formatWholeDollars(SIX_MONTH_MEMBERSHIP_PRICE)}
                      </button>
                    )}

                    {isExpired && (
                      <button
                        className="cs-liquid-button"
                        onClick={() => onOpenMembershipModal('RENEW')}
                        disabled={isSubmitting}
                      >
                        {t(lang, 'membership.renewMembership')} —{' '}
                        {formatWholeDollars(SIX_MONTH_MEMBERSHIP_PRICE)}
                      </button>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Past-due block message */}
            {session.pastDueBlocked && (
              <div className="past-due-block-message">
                <p>{t(session.customerPrimaryLanguage, 'pastDueBlocked')}</p>
              </div>
            )}

            {/* Selection State Display */}
            {proposedRentalType && (
              <div
                style={{
                  padding: '1rem',
                  marginBottom: '1rem',
                  background: selectionConfirmed
                    ? '#10b981'
                    : proposedBy === 'EMPLOYEE'
                      ? '#2563eb'
                      : '#334155',
                  borderRadius: '8px',
                  color: 'white',
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
                  {selectionConfirmed
                    ? `✓ ${t(session.customerPrimaryLanguage, 'selected')}: ${getRentalDisplayName(proposedRentalType, session.customerPrimaryLanguage)} (${selectionConfirmedBy === 'CUSTOMER' ? t(session.customerPrimaryLanguage, 'common.you') : t(session.customerPrimaryLanguage, 'common.staff')})`
                    : proposedBy === 'EMPLOYEE'
                      ? `${t(session.customerPrimaryLanguage, 'proposed')}: ${getRentalDisplayName(proposedRentalType, session.customerPrimaryLanguage)} (${t(session.customerPrimaryLanguage, 'selection.staffSuggestionHint')})`
                      : `${t(session.customerPrimaryLanguage, 'proposed')}: ${getRentalDisplayName(proposedRentalType, session.customerPrimaryLanguage)} (${t(session.customerPrimaryLanguage, 'selection.yourSelectionWaiting')})`}
                </div>
              </div>
            )}

            {/* Choose your experience */}
            <div className="experience-section">
              <p className="section-label">{t(session.customerPrimaryLanguage, 'experience.choose')}</p>
              <div className="experience-options">
                {session.allowedRentals.length > 0 ? (
                  session.allowedRentals.map((rental) => {
                    const availableCount =
                      inventory?.rooms[rental] ||
                      (rental === 'LOCKER' || rental === 'GYM_LOCKER' ? inventory?.lockers : 0) ||
                      0;
                    const showWarning = availableCount > 0 && availableCount <= 5;
                    const isUnavailable = availableCount === 0;
                    const isDisabled = session.pastDueBlocked;
                    const isSelected = proposedRentalType === rental && selectionConfirmed;
                    const isStaffProposed =
                      proposedBy === 'EMPLOYEE' &&
                      proposedRentalType === rental &&
                      !selectionConfirmed;
                    const isPulsing = isStaffProposed;
                    const isForced =
                      selectedRental === rental &&
                      selectionConfirmed &&
                      selectionConfirmedBy === 'EMPLOYEE';
                    const lang = session.customerPrimaryLanguage;

                    const displayName = getRentalDisplayName(rental, lang);
                    const displayPrice = DISPLAY_PRICE_BY_RENTAL[rental];
                    const displayNameWithPrice =
                      typeof displayPrice === 'number'
                        ? `${displayName} — ${formatWholeDollars(displayPrice)}`
                        : displayName;

                    return (
                      <button
                        key={rental}
                        className={`cs-liquid-button ${isSelected ? 'cs-liquid-button--selected' : ''} ${isStaffProposed ? 'cs-liquid-button--staff-proposed' : ''} ${isDisabled ? 'cs-liquid-button--disabled' : ''} ${isPulsing ? 'pulse-bright' : ''}`}
                        data-forced={isForced}
                        onClick={() => {
                          if (!isDisabled) {
                            void onSelectRental(rental);
                          }
                        }}
                        disabled={isDisabled}
                      >
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.5rem',
                            alignItems: 'center',
                          }}
                        >
                          <span>{displayNameWithPrice}</span>
                          {showWarning && !isUnavailable && (
                            <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>
                              {t(lang, 'availability.onlyAvailable', { count: availableCount })}
                            </span>
                          )}
                          {isUnavailable && (
                            <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>
                              {t(lang, 'availability.unavailable')}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="cs-liquid-button cs-liquid-button--disabled">
                    {t(session.customerPrimaryLanguage, 'noOptionsAvailable')}
                  </div>
                )}
              </div>
            </div>

          </main>
        </div>
      </ScreenShell>
    </I18nProvider>
  );
}

