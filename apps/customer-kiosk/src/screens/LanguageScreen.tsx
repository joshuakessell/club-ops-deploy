import { ReactNode } from 'react';
import { I18nProvider, t, type Language } from '../i18n';
import { ScreenShell } from '../components/ScreenShell';

export interface LanguageScreenProps {
  customerPrimaryLanguage: Language | null | undefined;
  onSelectLanguage: (lang: 'EN' | 'ES') => void;
  isSubmitting: boolean;
  highlightedLanguage?: 'EN' | 'ES' | null;
  orientationOverlay: ReactNode;
  welcomeOverlay: ReactNode;
}

export function LanguageScreen({
  customerPrimaryLanguage,
  onSelectLanguage,
  isSubmitting,
  highlightedLanguage = null,
  orientationOverlay,
  welcomeOverlay,
}: LanguageScreenProps) {
  return (
    <I18nProvider lang={customerPrimaryLanguage}>
      <ScreenShell backgroundVariant="steamroom1" showLogoWatermark={true} watermarkLayer="under">
        {orientationOverlay}
        {welcomeOverlay}
        <div className="active-content">
          <main className="main-content">
            <div className="language-selection-screen">
              <h1 className="language-title">{t(null, 'selectLanguage')}</h1>
              <div className="language-options">
                <button
                  className={[
                    'language-option',
                    'cs-liquid-button',
                    'cs-liquid-button--pill',
                    highlightedLanguage === 'EN' ? 'ck-option-highlight' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => void onSelectLanguage('EN')}
                  disabled={isSubmitting}
                >
                  {t(null, 'english')}
                </button>
                <button
                  className={[
                    'language-option',
                    'cs-liquid-button',
                    'cs-liquid-button--pill',
                    highlightedLanguage === 'ES' ? 'ck-option-highlight' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => void onSelectLanguage('ES')}
                  disabled={isSubmitting}
                >
                  {t(null, 'spanish')}
                </button>
              </div>
            </div>
          </main>
        </div>
      </ScreenShell>
    </I18nProvider>
  );
}

