import { useEffect, useState } from 'react';
import { isRecord, readJson } from '@club-ops/ui';
import { API_BASE } from '../shared/api';
import type { HealthStatus } from '../shared/types';

export function useHealthStatus(lane: string) {
  const [health, setHealth] = useState<HealthStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    let intervalId: number | null = null;

    const checkHealth = async () => {
      try {
        const res = await fetch(`${API_BASE}/health`);
        const data = await readJson<unknown>(res);
        if (
          !cancelled &&
          isRecord(data) &&
          typeof data.status === 'string' &&
          typeof data.timestamp === 'string' &&
          typeof data.uptime === 'number'
        ) {
          setHealth({ status: data.status, timestamp: data.timestamp, uptime: data.uptime });
        }
      } catch (err) {
        if (!cancelled) {
          setHealth({
            status: 'down',
            timestamp: new Date().toISOString(),
            uptime: 0,
          });
        }
        console.error('Health check failed:', err);
      }
    };

    void checkHealth();
    intervalId = window.setInterval(() => {
      void checkHealth();
    }, 5000);

    return () => {
      cancelled = true;
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, [lane]);

  return { health };
}
