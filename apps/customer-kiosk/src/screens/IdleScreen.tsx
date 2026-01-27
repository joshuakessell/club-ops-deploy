import { ReactNode } from 'react';
import whiteLogo from '../assets/logo_vector_transparent_hi.svg';
import { I18nProvider, t, type Language } from '../i18n';
import { ScreenShell } from '../components/ScreenShell';

export interface IdleScreenProps {
  customerPrimaryLanguage: Language | null | undefined;
  orientationOverlay: ReactNode;
}

export function IdleScreen({
  customerPrimaryLanguage,
  orientationOverlay,
}: IdleScreenProps) {
  return (
    <I18nProvider lang={customerPrimaryLanguage}>
      <ScreenShell backgroundVariant="steamroom1" showLogoWatermark={false}>
        {orientationOverlay}
        <div className="idle-content">
          <img
            src={whiteLogo}
            alt={t(customerPrimaryLanguage, 'brand.clubName')}
            className="logo-idle"
          />
        </div>
      </ScreenShell>
    </I18nProvider>
  );
}
