import { ReactNode } from 'react';
import { I18nProvider, t, type Language } from '../i18n';
import { ScreenShell } from '../components/ScreenShell';

export interface AgreementBypassScreenProps {
  customerPrimaryLanguage: Language | null | undefined;
  orientationOverlay: ReactNode;
  welcomeOverlay: ReactNode;
}

export function AgreementBypassScreen({
  customerPrimaryLanguage,
  orientationOverlay,
  welcomeOverlay,
}: AgreementBypassScreenProps) {
  return (
    <I18nProvider lang={customerPrimaryLanguage}>
      <ScreenShell backgroundVariant="steamroom1" showLogoWatermark={true} watermarkLayer="under">
        {orientationOverlay}
        {welcomeOverlay}
        <div className="active-content agreement-bypass-screen">
          <main className="main-content">
            <div className="cs-liquid-card agreement-bypass-card">
              <div className="agreement-bypass-title">
                {t(customerPrimaryLanguage, 'agreementTitle')}
              </div>
              <div className="agreement-bypass-body">
                Please wait while staff completes a physical agreement signature.
              </div>
            </div>
          </main>
        </div>
      </ScreenShell>
    </I18nProvider>
  );
}
