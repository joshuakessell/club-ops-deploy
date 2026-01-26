import { ReactNode } from 'react';
import { I18nProvider, t, type Language } from '../i18n';
import { ScreenShell } from '../components/ScreenShell';
import { KioskMessageCard } from '../views/KioskMessageCard';

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
            <KioskMessageCard
              title={t(customerPrimaryLanguage, 'agreementTitle')}
              body="Please wait while staff completes a physical agreement signature."
            />
          </main>
        </div>
      </ScreenShell>
    </I18nProvider>
  );
}
