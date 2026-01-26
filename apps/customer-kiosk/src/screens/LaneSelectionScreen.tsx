import { ReactNode } from 'react';
import { I18nProvider, t } from '../i18n';
import { ScreenShell } from '../components/ScreenShell';

export interface LaneSelectionScreenProps {
  orientationOverlay: ReactNode;
  onSelectLane: (lane: 'lane-1' | 'lane-2') => void;
}

export function LaneSelectionScreen({ orientationOverlay, onSelectLane }: LaneSelectionScreenProps) {
  return (
    <I18nProvider lang={null}>
      <ScreenShell backgroundVariant="steamroom1" showLogoWatermark={true} watermarkLayer="under">
        {orientationOverlay}
        <div className="active-content">
          <main className="main-content">
            <div className="lane-selection-screen">
              <h1 className="lane-title">{t(null, 'lane.selectTitle')}</h1>
              <p className="lane-subtitle">{t(null, 'lane.selectSubtitle')}</p>
              <div className="lane-options">
                <button
                  className={['lane-option', 'cs-liquid-button'].join(' ')}
                  onClick={() => onSelectLane('lane-1')}
                >
                  <span className="lane-option__title">{t(null, 'lane.lane1')}</span>
                  <span className="lane-option__subtitle">{t(null, 'lane.register1')}</span>
                </button>
                <button
                  className={['lane-option', 'cs-liquid-button'].join(' ')}
                  onClick={() => onSelectLane('lane-2')}
                >
                  <span className="lane-option__title">{t(null, 'lane.lane2')}</span>
                  <span className="lane-option__subtitle">{t(null, 'lane.register2')}</span>
                </button>
              </div>
            </div>
          </main>
        </div>
      </ScreenShell>
    </I18nProvider>
  );
}
