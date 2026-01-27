import { useCallback, useEffect, useState } from 'react';

type LaneId = 'lane-1' | 'lane-2';

export function useKioskLane() {
  const [lane, setLane] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const pathMatch = window.location.pathname.match(/\/register-(\d+)/);
    if (pathMatch) {
      return `lane-${pathMatch[1]}`;
    }

    const params = new URLSearchParams(window.location.search);
    const queryLane = params.get('lane');
    if (queryLane && /^lane-\d+$/.test(queryLane)) {
      return queryLane;
    }

    return null;
  });

  useEffect(() => {
    try {
      if (lane) {
        sessionStorage.setItem('lane', lane);
      } else {
        sessionStorage.removeItem('lane');
      }
    } catch {
      // Ignore if sessionStorage unavailable
    }
  }, [lane]);

  const buildRegisterPath = useCallback((laneId: LaneId) => {
    const laneNumber = laneId.replace('lane-', '');
    if (typeof window === 'undefined') return `/register-${laneNumber}`;
    const currentPath = window.location.pathname || '/';
    const basePath = currentPath.endsWith('/') ? currentPath : `${currentPath}/`;
    return `${basePath}register-${laneNumber}`;
  }, []);

  const handleLaneSelection = useCallback(
    (laneId: LaneId) => {
      setLane(laneId);
      if (typeof window === 'undefined') return;
      const targetPath = buildRegisterPath(laneId);
      window.history.replaceState({}, '', targetPath);
    },
    [buildRegisterPath]
  );

  return { lane, handleLaneSelection };
}
