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
                <>
                  <div className="assignment-info">
                    <p className="assignment-resource">
                      {t(lang, assignedResourceType)}: {assignedResourceNumber}
                    </p>
                    {checkoutAt && (
                      <p className="checkout-time">
                        {t(lang, 'checkoutAt')}: {new Date(checkoutAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <p>{t(lang, 'assignmentComplete')}</p>
              )}

              <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'center' }}>
                <button
                  className="cs-liquid-button modal-ok-btn"
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

