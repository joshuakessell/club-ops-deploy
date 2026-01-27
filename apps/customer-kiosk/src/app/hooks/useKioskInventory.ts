import { useCallback, useEffect, useState } from 'react';
import { isRecord, readJson } from '@club-ops/ui';

interface HealthStatus {
  status: string;
  timestamp: string;
  uptime: number;
}

type InventoryState = {
  rooms: Record<string, number>;
  lockers: number;
} | null;

export function useKioskInventory({
  apiBase,
  enabled,
}: {
  apiBase: string;
  enabled: boolean;
}) {
  const [, setHealth] = useState<HealthStatus | null>(null);
  const [inventory, setInventory] = useState<InventoryState>(null);

  const refreshInventory = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/v1/inventory/available`);
      if (!res.ok) return;
      const data: unknown = await res.json();
      if (isRecord(data) && isRecord(data.rooms) && typeof data.lockers === 'number') {
        setInventory({ rooms: data.rooms as Record<string, number>, lockers: data.lockers });
      }
    } catch {
      // Best-effort; inventory will retry on interval.
    }
  }, [apiBase]);

  const applyInventoryUpdate = useCallback((payload: unknown) => {
    if (!payload || typeof payload !== 'object') return;
    const inventoryPayload = (payload as { inventory?: unknown }).inventory;
    if (!inventoryPayload || typeof inventoryPayload !== 'object') return;
    const byType = (inventoryPayload as { byType?: Record<string, { clean: number }> }).byType;
    const lockers = (inventoryPayload as { lockers?: { clean?: number } }).lockers;
    if (!byType) return;

    const rooms: Record<string, number> = {};
    Object.entries(byType).forEach(([type, summary]) => {
      rooms[type] = summary.clean;
    });
    setInventory({ rooms, lockers: lockers?.clean || 0 });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${apiBase}/health`);
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
        console.error('Health check failed:', err);
      }
    })();

    void refreshInventory();

    return () => {
      cancelled = true;
    };
  }, [apiBase, enabled, refreshInventory]);

  useEffect(() => {
    if (!enabled) return;
    const intervalId = window.setInterval(() => {
      void refreshInventory();
    }, 10000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [enabled, refreshInventory]);

  return { inventory, refreshInventory, applyInventoryUpdate };
}
