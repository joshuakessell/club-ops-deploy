import { ReactNode } from 'react';
import { I18nProvider, t, type Language } from '../i18n';
import { ScreenShell } from '../components/ScreenShell';
import { KioskMessageCard } from '../views/KioskMessageCard';

export interface IdleScreenProps {
  sessionId: string | null;
  kioskAcknowledgedAt: string | null | undefined;
  customerPrimaryLanguage: Language | null | undefined;
  orientationOverlay: ReactNode;
}

export function IdleScreen({
  sessionId,
  kioskAcknowledgedAt,
  customerPrimaryLanguage,
  orientationOverlay,
}: IdleScreenProps) {
  const lang = customerPrimaryLanguage;
  const locked = !!sessionId && !!kioskAcknowledgedAt;
  return (
    <I18nProvider lang={customerPrimaryLanguage}>
      <ScreenShell backgroundVariant="steamroom1" showLogoWatermark={true} watermarkLayer="under">
        {orientationOverlay}
        <div className="idle-content" onClick={() => locked && alert(t(lang, 'kiosk.locked.body'))}>
          {locked && (
            <KioskMessageCard
              tone="muted"
              size="compact"
              className="ck-message-card--spaced"
              title={t(lang, 'kiosk.locked.title')}
              body={t(lang, 'kiosk.locked.body')}
            />
          )}
        </div>
      </ScreenShell>
    </I18nProvider>
  );
}
