import { ReactNode } from 'react';
import { I18nProvider, t, type Language } from '../i18n';
import { ScreenShell } from '../components/ScreenShell';

export interface CompleteScreenProps {
  customerPrimaryLanguage: Language | null | undefined;
  assignedResourceType?: 'room' | 'locker';
  assignedResourceNumber?: string;
  checkoutAt?: string;
  isSubmitting: boolean;
  orientationOverlay: ReactNode;
  welcomeOverlay: ReactNode;
  onComplete: () => void;
}

export function CompleteScreen({
  customerPrimaryLanguage,
  assignedResourceType,
  assignedResourceNumber,
  checkoutAt,
  isSubmitting,
  orientationOverlay,
  welcomeOverlay,
  onComplete,
}: CompleteScreenProps) {
  const lang = customerPrimaryLanguage;
  const locale = lang ?? undefined;

  const checkoutDate = checkoutAt ? new Date(checkoutAt) : null;
  const hasValidCheckoutDate = checkoutDate != null && !Number.isNaN(checkoutDate.getTime());
  const checkoutTimeText = hasValidCheckoutDate
    ? checkoutDate.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
    : null;
  const checkoutDateText = hasValidCheckoutDate
    ? checkoutDate.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' })
    : null;

  return (
    <I18nProvider lang={lang}>
      <ScreenShell backgroundVariant="steamroom1" showLogoWatermark={true}>
        {orientationOverlay}
        {welcomeOverlay}
        <div className="active-content">
          <main className="main-content">
            <div className="complete-screen">
              <h1>{t(lang, 'thankYou')}</h1>
              {assignedResourceType && assignedResourceNumber ? (
                <div className="assignment-info cs-liquid-card">
                  <div className="assignment-row">
                    <div className="assignment-label">{t(lang, assignedResourceType)}</div>
                    <div className="assignment-value">{assignedResourceNumber}</div>
                  </div>

                  {checkoutAt && (
                    <div className="assignment-row assignment-row--checkout">
                      <div className="assignment-label">{t(lang, 'checkoutAt')}</div>
                      <div className="assignment-value assignment-value--time">
                        {checkoutTimeText ?? new Date(checkoutAt).toLocaleString(locale)}
                      </div>
                      {checkoutDateText && <div className="assignment-subvalue">{checkoutDateText}</div>}
                    </div>
                  )}
                </div>
              ) : (
                <p>{t(lang, 'assignmentComplete')}</p>
              )}

              <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'center' }}>
                <button
                  className="cs-liquid-button modal-ok-btn complete-ok-btn"
                  onClick={onComplete}
                  disabled={isSubmitting}
                >
                  {t(lang, 'common.ok')}
                </button>
              </div>
            </div>
          </main>
        </div>
      </ScreenShell>
    </I18nProvider>
  );
}

