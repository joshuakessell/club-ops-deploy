import { type ReactNode } from 'react';
import logoImage from '../assets/the-clubs-logo.png';

interface ScreenShellProps {
  children: ReactNode;
  backgroundVariant?: 'steamroom1' | 'steamroom2' | 'none';
  showLogoWatermark?: boolean;
}

export function ScreenShell({ 
  children, 
  backgroundVariant = 'steamroom1',
  showLogoWatermark = true 
}: ScreenShellProps) {
  return (
    <div className={`cs-screen cs-kiosk-bg cs-kiosk-bg--${backgroundVariant}`}>
      <div className="cs-screen-overlay" />
      {showLogoWatermark && (
        <div className="cs-kiosk-watermark">
          <img src={logoImage} alt="Club Dallas" className="cs-kiosk-watermark__img" />
        </div>
      )}
      <div className="cs-kiosk-stage">
        {children}
      </div>
    </div>
  );
}

