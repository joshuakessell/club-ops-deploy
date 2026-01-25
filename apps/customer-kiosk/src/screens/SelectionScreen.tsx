import { ReactNode } from 'react';
import { I18nProvider, t } from '../i18n';
import { ScreenShell } from '../components/ScreenShell';
import { getRentalDisplayName } from '../utils/display';
import { getMembershipStatus, type SessionState } from '../utils/membership';

function formatMembershipDate(
  yyyyMmDd: string,
  lang: SessionState['customerPrimaryLanguage']
): string {
  const locale = lang === 'ES' ? 'es-US' : 'en-US';
  const d = new Date(`${yyyyMmDd}T00:00:00Z`);
  // Guard against invalid payloads; fall back to raw string.
  if (!Number.isFinite(d.getTime())) return yyyyMmDd;
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric' }).format(
    d
  );
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
  membershipChoice: 'ONE_TIME' | 'SIX_MONTH' | null;
  onSelectOneTimeMembership: () => void;
  onSelectSixMonthMembership: () => void;
  highlightedMembershipChoice?: 'ONE_TIME' | 'SIX_MONTH' | null;
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
  membershipChoice,
  onSelectOneTimeMembership,
  onSelectSixMonthMembership,
  highlightedMembershipChoice = null,
}: SelectionScreenProps) {
  const lang = session.customerPrimaryLanguage;
  const membershipStatus = getMembershipStatus(session, Date.now());
  const isMember = membershipStatus === 'ACTIVE' || membershipStatus === 'PENDING';
  const isNonMember = !isMember;

  const prereqsSatisfied = isMember || membershipChoice !== null;
  const canInteract =
    !isSubmitting &&
    !session.pastDueBlocked &&
    !selectionConfirmed &&
    !!session.customerPrimaryLanguage;

  const activeStep: 'MEMBERSHIP' | 'RENTAL' | null = (() => {
    if (!canInteract) return null;
    if (!isMember && !membershipChoice) return 'MEMBERSHIP';
    return 'RENTAL';
  })();

  const rentalOrder = ['LOCKER', 'GYM_LOCKER', 'STANDARD', 'DOUBLE', 'SPECIAL'] as const;
  const allowedSet = new Set(session.allowedRentals);
  const rentalsToShow = rentalOrder.filter((r) => allowedSet.has(r));

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

            {/* Defensive fallback: if language isn't selected yet, block interactions and instruct the customer. */}
            {!session.customerPrimaryLanguage && (
              <div className="past-due-block-message">
                <p>{t('EN', 'selectLanguage')}</p>
              </div>
            )}

            {/* Past-due block message */}
            {session.pastDueBlocked && (
              <div className="past-due-block-message">
                <p>{t(session.customerPrimaryLanguage, 'pastDueBlocked')}</p>
              </div>
            )}

            {/* Staff suggestion: membership */}
            {highlightedMembershipChoice && !membershipChoice && (
              <div
                style={{
                  padding: '1rem',
                  marginBottom: '1rem',
                  background: '#2563eb',
                  borderRadius: '8px',
                  color: 'white',
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
                  {t(session.customerPrimaryLanguage, 'proposed')}:{' '}
                  {t(
                    session.customerPrimaryLanguage,
                    highlightedMembershipChoice === 'ONE_TIME'
                      ? 'membership.oneTimeOption'
                      : 'membership.sixMonthOption'
                  )}{' '}
                  ({t(session.customerPrimaryLanguage, 'selection.staffSuggestionHint')})
                </div>
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
                      : `${t(session.customerPrimaryLanguage, 'selected')}: ${getRentalDisplayName(proposedRentalType, session.customerPrimaryLanguage)} (${t(session.customerPrimaryLanguage, 'common.you')})`}
                </div>
              </div>
            )}

            <div className="purchase-cards">
              {/* Membership card */}
              <div className="ck-step-wrap">
                {activeStep === 'MEMBERSHIP' && (
                  <>
                    <div className="ck-step-helper-text ck-glow-text">
                      {t(lang, 'guidance.pleaseSelectOne')}
                    </div>
                    <div className="ck-arrow ck-arrow--step ck-arrow--bounce-x" aria-hidden="true">
                      ▶
                    </div>
                  </>
                )}
                <section
                  className={`cs-liquid-card purchase-card purchase-card--membership ${activeStep === 'MEMBERSHIP' ? 'ck-step-active' : ''}`}
                >
                  <div className="purchase-card__header">
                    <div className="purchase-card__title">{t(lang, 'membership')}</div>
                    <div className="purchase-card__status">
                      {isMember ? t(lang, 'membership.member') : t(lang, 'membership.nonMember')}
                    </div>
                  </div>

                  {isMember ? (
                    <div className="purchase-card__body">
                      <p className="purchase-card__message">
                        {t(lang, 'membership.thankYouMember')}
                      </p>
                      {session.membershipValidUntil && (
                        <p className="purchase-card__message">
                          {t(lang, 'membership.expiresOn', {
                            date: formatMembershipDate(session.membershipValidUntil, lang),
                          })}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="purchase-card__body">
                      <div className="membership-option-stack">
                        <button
                          className={[
                            'cs-liquid-button',
                            'kiosk-option-button',
                            membershipChoice === 'ONE_TIME' ? 'cs-liquid-button--selected' : '',
                            highlightedMembershipChoice === 'ONE_TIME'
                              ? 'cs-liquid-button--staff-proposed'
                              : '',
                            highlightedMembershipChoice === 'ONE_TIME' ? 'ck-option-highlight' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onClick={() => {
                            if (!canInteract) return;
                            onSelectOneTimeMembership();
                          }}
                          disabled={!canInteract}
                        >
                          <span className="kiosk-option-title">
                            {t(lang, 'membership.oneTimeOption')}
                          </span>
                        </button>

                        <button
                          className={[
                            'cs-liquid-button',
                            'kiosk-option-button',
                            membershipChoice === 'SIX_MONTH' ? 'cs-liquid-button--selected' : '',
                            highlightedMembershipChoice === 'SIX_MONTH'
                              ? 'cs-liquid-button--staff-proposed'
                              : '',
                            highlightedMembershipChoice === 'SIX_MONTH'
                              ? 'ck-option-highlight'
                              : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onClick={() => {
                            if (!canInteract) return;
                            onSelectSixMonthMembership();
                          }}
                          disabled={!canInteract}
                        >
                          <span className="kiosk-option-title">
                            {t(lang, 'membership.sixMonthOption')}
                          </span>
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              </div>

              {/* Rental card */}
              <div className="ck-step-wrap">
                {activeStep === 'RENTAL' && (
                  <>
                    <div className="ck-step-helper-text ck-glow-text">
                      {t(lang, 'guidance.pleaseSelectOne')}
                    </div>
                    <div className="ck-arrow ck-arrow--step ck-arrow--bounce-x" aria-hidden="true">
                      ▶
                    </div>
                  </>
                )}
                <section
                  className={`cs-liquid-card purchase-card purchase-card--rental ${activeStep === 'RENTAL' ? 'ck-step-active' : ''}`}
                >
                  <div className="purchase-card__header">
                    <div className="purchase-card__title">{t(lang, 'rental.title')}</div>
                  </div>

                  <div className="purchase-card__body">
                    {rentalsToShow.length > 0 ? (
                      <div className="rental-grid">
                        {rentalsToShow.map((rental) => {
                          const availableCount =
                            inventory?.rooms?.[rental] ??
                            (rental === 'LOCKER' || rental === 'GYM_LOCKER'
                              ? inventory?.lockers
                              : undefined);
                          const showWarning =
                            typeof availableCount === 'number' &&
                            availableCount > 0 &&
                            availableCount <= 5;
                          const isUnavailable = availableCount === 0;
                          const isDisabled =
                            !session.customerPrimaryLanguage ||
                            session.pastDueBlocked ||
                            (isNonMember && !membershipChoice) ||
                            selectionConfirmed;
                          // Show the customer's chosen rental as selected even while waiting for attendant approval,
                          // so the UI gives immediate visual feedback before/under the pending overlay.
                          const isSelected =
                            proposedRentalType === rental &&
                            (selectionConfirmed || proposedBy === 'CUSTOMER');
                          const isStaffProposed =
                            proposedBy === 'EMPLOYEE' &&
                            proposedRentalType === rental &&
                            !selectionConfirmed &&
                            prereqsSatisfied;
                          const isPulsing = isStaffProposed;
                          const isForced =
                            selectedRental === rental &&
                            selectionConfirmed &&
                            selectionConfirmedBy === 'EMPLOYEE';

                          const displayName = getRentalDisplayName(rental, lang);

                          const span2 =
                            rental === 'LOCKER' || rental === 'GYM_LOCKER' || rental === 'STANDARD';

                          return (
                            <button
                              key={rental}
                              className={`cs-liquid-button kiosk-option-button ${span2 ? 'span-2' : ''} ${isSelected ? 'cs-liquid-button--selected' : ''} ${isStaffProposed ? 'cs-liquid-button--staff-proposed' : ''} ${isDisabled ? 'cs-liquid-button--disabled' : ''} ${isPulsing ? 'pulse-bright' : ''}`}
                              data-forced={isForced}
                              onClick={() => {
                                if (isDisabled) return;
                                void onSelectRental(rental);
                              }}
                              disabled={isDisabled}
                            >
                              <div className="kiosk-option-stack">
                                <span className="kiosk-option-title">{displayName}</span>
                                {showWarning &&
                                  !isUnavailable &&
                                  typeof availableCount === 'number' && (
                                    <span className="kiosk-option-subtext">
                                      {t(lang, 'availability.onlyAvailable', {
                                        count: availableCount,
                                      })}
                                    </span>
                                  )}
                                {isUnavailable && typeof availableCount === 'number' && (
                                  <span className="kiosk-option-subtext">
                                    {t(lang, 'availability.joinWaitlist')}
                                  </span>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="cs-liquid-button cs-liquid-button--disabled">
                        {t(lang, 'noOptionsAvailable')}
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </div>
          </main>
        </div>

      </ScreenShell>
    </I18nProvider>
  );
}
