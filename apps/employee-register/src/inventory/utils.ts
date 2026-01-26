import { RoomStatus } from '@club-ops/shared';
import type { AlertLevel, DetailedRoom, GroupedRoom, RoomGroup } from './types';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export async function readJson<T>(response: Response): Promise<T> {
  const data: unknown = await response.json();
  return data as T;
}

export function getMsUntil(iso: string | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return t - nowMs;
}

export function formatDurationHuman(msUntil: number): { label: string; isOverdue: boolean } {
  const isOverdue = msUntil < 0;
  const minutesTotalRaw = Math.max(0, Math.ceil(Math.abs(msUntil) / (60 * 1000)));
  const minutesTotal = minutesTotalRaw;
  const hours = Math.floor(minutesTotal / 60);
  const minutes = minutesTotal % 60;

  if (hours <= 0) {
    return { label: `${minutesTotal} mins`, isOverdue };
  }
  if (minutes === 0) {
    return { label: `${hours} hr`, isOverdue };
  }
  return { label: `${hours} hr ${minutes} mins`, isOverdue };
}

export function formatTimeOfDay(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function isUuid(value: string | undefined | null): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export const ROOM_TYPE_LABELS: Record<string, string> = {
  SPECIAL: 'Special Rooms',
  DOUBLE: 'Double Rooms',
  STANDARD: 'Standard Rooms',
  LOCKER: 'Lockers',
};

const DUE_SOON_MS = 30 * 60 * 1000;

export function alertLevelFromMsUntil(msUntil: number | null | undefined): AlertLevel {
  if (msUntil === null || msUntil === undefined) return null;
  if (!Number.isFinite(msUntil)) return null;
  if (msUntil < 0) return 'danger';
  if (msUntil <= DUE_SOON_MS) return 'warning';
  return null;
}

export function groupRooms(
  rooms: DetailedRoom[],
  waitlistEntries: Array<{ desiredTier: string; status: string }> = [],
  nowMs: number
): GroupedRoom[] {
  const waitlistTiers = new Set(
    waitlistEntries
      .filter((e) => e.status === 'ACTIVE' || e.status === 'OFFERED')
      .map((e) => e.desiredTier)
  );

  return rooms.map((room) => {
    const isWaitlistMatch =
      waitlistTiers.has(room.tier) && room.status === RoomStatus.CLEAN && !room.assignedTo;

    if (isWaitlistMatch) {
      return { room, group: 'upgradeRequest' as RoomGroup, isWaitlistMatch: true };
    }

    if (room.status === RoomStatus.CLEAN && !room.assignedTo) {
      return { room, group: 'available' as RoomGroup };
    }

    if (room.assignedTo || room.status === RoomStatus.OCCUPIED) {
      return {
        room,
        group: 'occupied' as RoomGroup,
        msUntilCheckout: getMsUntil(room.checkoutAt, nowMs),
      };
    }

    if (room.status === RoomStatus.CLEANING) {
      return { room, group: 'cleaning' as RoomGroup };
    }

    if (room.status === RoomStatus.DIRTY) {
      return { room, group: 'dirty' as RoomGroup };
    }

    return { room, group: 'available' as RoomGroup };
  });
}

export function sortGroupedRooms(grouped: GroupedRoom[]): GroupedRoom[] {
  return grouped.sort((a, b) => {
    const groupOrder: Record<RoomGroup, number> = {
      upgradeRequest: 0,
      available: 1,
      occupied: 2,
      cleaning: 3,
      dirty: 4,
    };

    if (groupOrder[a.group] !== groupOrder[b.group]) {
      return groupOrder[a.group] - groupOrder[b.group];
    }

    if (a.group === 'available' || a.group === 'upgradeRequest') {
      return parseInt(a.room.number) - parseInt(b.room.number);
    }

    if (a.group === 'cleaning' || a.group === 'dirty') {
      return parseInt(a.room.number) - parseInt(b.room.number);
    }

    const aMs = a.msUntilCheckout ?? null;
    const bMs = b.msUntilCheckout ?? null;
    const aLevel = alertLevelFromMsUntil(aMs);
    const bLevel = alertLevelFromMsUntil(bMs);
    const rank = (lvl: AlertLevel) => (lvl === 'danger' ? 0 : lvl === 'warning' ? 1 : 2);

    if (rank(aLevel) !== rank(bLevel)) return rank(aLevel) - rank(bLevel);

    const aTime = a.room.checkoutAt
      ? new Date(a.room.checkoutAt).getTime()
      : Number.POSITIVE_INFINITY;
    const bTime = b.room.checkoutAt
      ? new Date(b.room.checkoutAt).getTime()
      : Number.POSITIVE_INFINITY;
    if (aTime !== bTime) return aTime - bTime;

    return parseInt(a.room.number) - parseInt(b.room.number);
  });
}
