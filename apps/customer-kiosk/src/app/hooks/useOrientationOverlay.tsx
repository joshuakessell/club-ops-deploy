import { useEffect, useMemo, useState } from 'react';
import { t, type Language } from '../../i18n';

export function useOrientationOverlay(language?: Language | null) {
  const [isPortrait, setIsPortrait] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.innerHeight >= window.innerWidth;
  });

  useEffect(() => {
    const handleOrientation = () => {
      setIsPortrait(window.innerHeight >= window.innerWidth);
    };
    handleOrientation();
    window.addEventListener('resize', handleOrientation);
    window.addEventListener('orientationchange', handleOrientation);
    return () => {
      window.removeEventListener('resize', handleOrientation);
      window.removeEventListener('orientationchange', handleOrientation);
    };
  }, []);

  const orientationOverlay = useMemo(() => {
    if (isPortrait) return null;
    return (
      <div className="orientation-blocker">
        <div>
          <h1>{t(language, 'orientation.title')}</h1>
          <p>{t(language, 'orientation.body')}</p>
        </div>
      </div>
    );
  }, [isPortrait, language]);

  return { isPortrait, orientationOverlay };
}
