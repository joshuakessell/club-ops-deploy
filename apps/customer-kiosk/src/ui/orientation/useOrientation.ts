import { useEffect, useState } from 'react';

export type DeviceOrientation = 'portrait' | 'landscape';

type OrientationState = {
  orientation: DeviceOrientation;
  width: number;
  height: number;
};

function computeOrientation(): OrientationState {
  const width = window.innerWidth;
  const height = window.innerHeight;

  const portraitQuery = window.matchMedia?.('(orientation: portrait)');
  const landscapeQuery = window.matchMedia?.('(orientation: landscape)');

  let orientation: DeviceOrientation;
  if (portraitQuery?.matches) orientation = 'portrait';
  else if (landscapeQuery?.matches) orientation = 'landscape';
  else orientation = width >= height ? 'landscape' : 'portrait';

  return { orientation, width, height };
}

export function useOrientation(): OrientationState {
  const [state, setState] = useState<OrientationState>(() => {
    if (typeof window === 'undefined') return { orientation: 'portrait', width: 0, height: 0 };
    return computeOrientation();
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let raf = 0;
    const update = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = 0;
        setState((prev) => {
          const next = computeOrientation();
          if (
            prev.orientation === next.orientation &&
            prev.width === next.width &&
            prev.height === next.height
          ) {
            return prev;
          }
          return next;
        });
      });
    };

    update();
    window.addEventListener('resize', update, { passive: true });
    window.addEventListener('orientationchange', update, { passive: true });

    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return state;
}

