import { useCallback, useEffect, useRef, useState } from 'react';
import { isRecord, readJson } from '@club-ops/ui';
import { API_BASE } from '../shared/api';
import type { StaffSession } from '../shared/types';

type RegisterSession = {
  employeeId: string;
  employeeName: string;
  registerNumber: number;
  deviceId: string;
};

export type WaitlistEntry = {
  id: string;
  visitId: string;
  checkinBlockId: string;
  customerId?: string;
  desiredTier: string;
  backupTier: string;
  status: string;
  createdAt: string;
  checkinAt?: string;
  checkoutAt?: string;
  offeredAt?: string;
  roomId?: string | null;
  offeredRoomNumber?: string | null;
  displayIdentifier: string;
  currentRentalType: string;
  customerName?: string;
};

export type InventoryAvailable = {
  rooms: Record<string, number>;
  rawRooms: Record<string, number>;
  waitlistDemand: Record<string, number>;
  lockers: number;
};

type Params = {
  session: StaffSession | null;
  registerSession: RegisterSession | null;
  onUnauthorized?: () => void;
};

export function useWaitlistDataState({ session, registerSession, onUnauthorized }: Params) {
  const [waitlistEntries, setWaitlistEntries] = useState<WaitlistEntry[]>([]);
  const [inventoryAvailable, setInventoryAvailable] = useState<InventoryAvailable | null>(null);
  const [showWaitlistModal, setShowWaitlistModal] = useState(false);

  const fetchWaitlistRef = useRef<(() => Promise<void>) | null>(null);
  const fetchInventoryAvailableRef = useRef<(() => Promise<void>) | null>(null);

  const fetchWaitlist = async () => {
    if (!session?.sessionToken || !registerSession) return;

    try {
      const [activeResponse, offeredResponse] = await Promise.all([
        fetch(`${API_BASE}/v1/waitlist?status=ACTIVE`, {
          headers: {
            Authorization: `Bearer ${session.sessionToken}`,
          },
        }),
        fetch(`${API_BASE}/v1/waitlist?status=OFFERED`, {
          headers: {
            Authorization: `Bearer ${session.sessionToken}`,
          },
        }),
      ]);

      if (activeResponse.status === 401 || offeredResponse.status === 401) {
        localStorage.removeItem('staff_session');
        onUnauthorized?.();
        return;
      }

      const allEntries: WaitlistEntry[] = [];

      if (activeResponse.ok) {
        const activeData = await readJson<{ entries?: WaitlistEntry[] }>(activeResponse);
        allEntries.push(...(activeData.entries || []));
      }

      if (offeredResponse.ok) {
        const offeredData = await readJson<{ entries?: WaitlistEntry[] }>(offeredResponse);
        allEntries.push(...(offeredData.entries || []));
      }

      const statusPriority = (status: string): number =>
        status === 'OFFERED' ? 2 : status === 'ACTIVE' ? 1 : 0;

      const byId = new Map<string, WaitlistEntry>();
      for (const entry of allEntries) {
        const existing = byId.get(entry.id);
        if (!existing) {
          byId.set(entry.id, entry);
          continue;
        }
        if (statusPriority(entry.status) >= statusPriority(existing.status)) {
          byId.set(entry.id, entry);
        }
      }

      const deduped = Array.from(byId.values());

      deduped.sort((a, b) => {
        const at = new Date(a.createdAt).getTime();
        const bt = new Date(b.createdAt).getTime();
        return at - bt;
      });

      setWaitlistEntries(deduped);
    } catch (error) {
      console.error('Failed to fetch waitlist:', error);
    }
  };

  const fetchInventoryAvailable = async () => {
    try {
      const res = await fetch(`${API_BASE}/v1/inventory/available`);
      if (!res.ok) return;
      const data: unknown = await res.json().catch(() => null);
      if (
        isRecord(data) &&
        isRecord(data.rooms) &&
        isRecord(data.rawRooms) &&
        isRecord(data.waitlistDemand)
      ) {
        const lockersRaw = data['lockers'];
        const lockers =
          typeof lockersRaw === 'number'
            ? lockersRaw
            : typeof lockersRaw === 'string'
              ? Number(lockersRaw)
              : 0;
        setInventoryAvailable({
          rooms: data.rooms as Record<string, number>,
          rawRooms: data.rawRooms as Record<string, number>,
          waitlistDemand: data.waitlistDemand as Record<string, number>,
          lockers: Number.isFinite(lockers) ? lockers : 0,
        });
      }
    } catch (error) {
      console.error('Failed to fetch inventory available:', error);
    }
  };

  fetchWaitlistRef.current = fetchWaitlist;
  fetchInventoryAvailableRef.current = fetchInventoryAvailable;

  const refreshInventoryAvailable = useCallback(() => {
    void fetchInventoryAvailableRef.current?.();
  }, []);

  const refreshWaitlistAndInventory = useCallback(() => {
    void fetchWaitlistRef.current?.();
    void fetchInventoryAvailableRef.current?.();
  }, []);

  useEffect(() => {
    if (session?.sessionToken && registerSession) {
      void fetchWaitlistRef.current?.();
      void fetchInventoryAvailableRef.current?.();
    }
  }, [registerSession, session?.sessionToken]);

  useEffect(() => {
    if (!session?.sessionToken || !registerSession) return;
    const interval = window.setInterval(() => {
      void fetchWaitlistRef.current?.();
      void fetchInventoryAvailableRef.current?.();
    }, 60000);
    return () => window.clearInterval(interval);
  }, [registerSession, session?.sessionToken]);

  return {
    waitlistEntries,
    inventoryAvailable,
    showWaitlistModal,
    setShowWaitlistModal,
    refreshWaitlistAndInventory,
    refreshInventoryAvailable,
  };
}
