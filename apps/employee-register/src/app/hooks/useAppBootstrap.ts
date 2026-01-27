import { useEffect } from 'react';
import { closeAllLaneSessionClients } from '@club-ops/shared';

export function useAppBootstrap() {
  useEffect(() => {
    return () => {
      closeAllLaneSessionClients();
    };
  }, []);
}
