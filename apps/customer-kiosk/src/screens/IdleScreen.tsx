import { ReactNode } from 'react';
import { I18nProvider, t, type Language } from '../i18n';
import { ScreenShell } from '../components/ScreenShell';

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
            <div
              style={{
                marginTop: '2rem',
                padding: '1.25rem',
                background: 'rgba(15,23,42,0.75)',
                border: '1px solid rgba(148,163,184,0.35)',
                borderRadius: '12px',
                maxWidth: '720px',
                textAlign: 'center',
                color: 'white',
              }}
            >
              <div style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.5rem' }}>
                {t(lang, 'kiosk.locked.title')}
              </div>
              <div style={{ fontSize: '1.05rem', opacity: 0.9 }}>
                {t(lang, 'kiosk.locked.body')}
              </div>
            </div>
          )}
        </div>
      </ScreenShell>
    </I18nProvider>
  );
}
