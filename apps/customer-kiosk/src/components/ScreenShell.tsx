import { type ReactNode } from 'react';
import whiteLogo from '../assets/logo_vector_transparent_hi.svg';

interface ScreenShellProps {
  children: ReactNode;
  backgroundVariant?: 'steamroom1' | 'steamroom2' | 'none';
  showLogoWatermark?: boolean;
  watermarkLayer?: 'over' | 'under';
}

export function ScreenShell({
  children,
  backgroundVariant = 'steamroom1',
  showLogoWatermark = true,
  watermarkLayer = 'under',
}: ScreenShellProps) {
  const watermarkClass = `cs-kiosk-watermark ${watermarkLayer === 'under' ? 'cs-kiosk-watermark--under' : 'cs-kiosk-watermark--over'}`;

  return (
    <div className={`cs-screen cs-kiosk-bg cs-kiosk-bg--${backgroundVariant}`}>
      <div className="cs-screen-overlay" />
      {showLogoWatermark && (
        <div className={watermarkClass}>
          <img src={whiteLogo} alt="Club Dallas" className="cs-kiosk-watermark__img" />
        </div>
      )}
      <div className="cs-kiosk-stage">{children}</div>
    </div>
  );
}
