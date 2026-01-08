import { useCallback, useEffect, useMemo, useState } from 'react';
import { RoomStatus } from '@club-ops/shared';
import { getRoomTier, type RoomTier } from '../utils/getRoomTier';
import type { AvailabilityType } from './AvailabilityStatusBar';

export type AvailabilityModalType = AvailabilityType | null;

const API_BASE = '/api';

interface InventoryRoom {
  id: string;
  number: string;
  tier: RoomTier;
  status: RoomStatus;
  assignedTo?: string;
  assignedMemberName?: string;
  checkoutAt?: string;
}

interface InventoryLocker {
  id: string;
  number: string;
  status: RoomStatus;
  assignedTo?: string;
  assignedMemberName?: string;
  checkoutAt?: string;
}

interface InventoryDetailState {
  rooms: InventoryRoom[];
  lockers: InventoryLocker[];
}

export interface AvailabilityInventoryItem {
  id: string;
  number: string;
  kind: 'room' | 'locker';
  status: RoomStatus;
  assignedTo?: string;
  assignedMemberName?: string;
  checkoutAt?: string;
}

const GROUP_LABELS = ['Available', 'Cleaning', 'Dirty', 'Occupied'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRoomStatus(value: unknown): value is RoomStatus {
  return typeof value === 'string' && Object.values(RoomStatus).includes(value as RoomStatus);
}

function isRoomTier(value: unknown): value is RoomTier {
  return value === 'STANDARD' || value === 'DOUBLE' || value === 'SPECIAL';
}

function getGroupIndex(item: AvailabilityInventoryItem): number {
  const available = item.status === RoomStatus.CLEAN && !item.assignedTo;
  if (available) return 0;
  if (item.status === RoomStatus.CLEANING) return 1;
  if (item.status === RoomStatus.DIRTY) return 2;
  if (item.assignedTo || item.status === RoomStatus.OCCUPIED) return 3;
  return 0;
}

function parseNumberValue(value: string): number {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

export function sortInventoryItems<T extends AvailabilityInventoryItem>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const groupA = getGroupIndex(a);
    const groupB = getGroupIndex(b);
    if (groupA !== groupB) return groupA - groupB;

    if (groupA === 3) {
      const aCheckout = a.checkoutAt ? new Date(a.checkoutAt).getTime() : Number.POSITIVE_INFINITY;
      const bCheckout = b.checkoutAt ? new Date(b.checkoutAt).getTime() : Number.POSITIVE_INFINITY;
      if (aCheckout !== bCheckout) return aCheckout - bCheckout;
    }

    return parseNumberValue(a.number) - parseNumberValue(b.number);
  });
}

interface AvailabilityModalProps {
  isOpen: boolean;
  type: AvailabilityModalType;
  sessionToken: string;
  onClose: () => void;
}

export function AvailabilityModal({ isOpen, type, sessionToken, onClose }: AvailabilityModalProps) {
  const [inventory, setInventory] = useState<InventoryDetailState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchInventory = useCallback(
    async (signal?: AbortSignal) => {
      if (!sessionToken) return;
      setLoading(true);
      setError(null);
      setInventory(null);
      try {
        const response = await fetch(`${API_BASE}/v1/inventory/detailed`, {
          headers: {
            Authorization: `Bearer ${sessionToken}`,
          },
          signal,
        });

        if (signal?.aborted) return;

        if (!response.ok) {
          throw new Error(`Failed to load inventory (${response.status})`);
        }

        const data: unknown = await response.json().catch(() => null);

        if (signal?.aborted) return;
        if (!isRecord(data)) {
          throw new Error('Invalid inventory payload');
        }

        const rooms: InventoryRoom[] = (Array.isArray(data.rooms) ? data.rooms : [])
          .filter(isRecord)
          .filter((room) => typeof room.id === 'string' && typeof room.number === 'string')
          .map((room) => {
            const number = room.number as string;
            const status = isRoomStatus(room.status) ? room.status : RoomStatus.DIRTY;
            const tier = isRoomTier(room.tier) ? room.tier : getRoomTier(number);
            return {
              id: room.id as string,
              number,
              tier,
              status,
              assignedTo: typeof room.assignedTo === 'string' ? room.assignedTo : undefined,
              assignedMemberName:
                typeof room.assignedMemberName === 'string' ? room.assignedMemberName : undefined,
              checkoutAt: typeof room.checkoutAt === 'string' ? room.checkoutAt : undefined,
            };
          });

        const lockers: InventoryLocker[] = (Array.isArray(data.lockers) ? data.lockers : [])
          .filter(isRecord)
          .filter((locker) => typeof locker.id === 'string' && typeof locker.number === 'string')
          .map((locker) => ({
            id: locker.id as string,
            number: locker.number as string,
            status: isRoomStatus(locker.status) ? locker.status : RoomStatus.DIRTY,
            assignedTo: typeof locker.assignedTo === 'string' ? locker.assignedTo : undefined,
            assignedMemberName:
              typeof locker.assignedMemberName === 'string' ? locker.assignedMemberName : undefined,
            checkoutAt: typeof locker.checkoutAt === 'string' ? locker.checkoutAt : undefined,
          }));

        if (signal?.aborted) return;
        setInventory({ rooms, lockers });
      } catch (err) {
        if (signal?.aborted) return;
        setError(err instanceof Error ? err.message : 'Failed to load inventory');
      } finally {
        if (signal?.aborted) return;
        setLoading(false);
      }
    },
    [sessionToken]
  );

  useEffect(() => {
    if (!isOpen || !type || !sessionToken) return;
    const controller = new AbortController();
    void fetchInventory(controller.signal);
    return () => controller.abort();
  }, [fetchInventory, isOpen, sessionToken, type]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [isOpen, onClose]);

  const items = useMemo(() => {
    if (!inventory) return [];
    if (type === 'LOCKER') {
      return inventory.lockers.map((locker) => ({
        id: locker.id,
        number: locker.number,
        kind: 'locker' as const,
        status: locker.status,
        assignedTo: locker.assignedTo,
        assignedMemberName: locker.assignedMemberName,
        checkoutAt: locker.checkoutAt,
      }));
    }
    return inventory.rooms
      .filter((room) => room.tier === type)
      .map((room) => ({
        id: room.id,
        number: room.number,
        kind: 'room' as const,
        status: room.status,
        assignedTo: room.assignedTo,
        assignedMemberName: room.assignedMemberName,
        checkoutAt: room.checkoutAt,
      }));
  }, [inventory, type]);

  const sortedItems = useMemo(() => sortInventoryItems(items), [items]);

  const showLoading = loading && !inventory;

  if (!isOpen || !type || !sessionToken) return null;

  return (
    <div
      className="availability-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Availability modal: ${type}`}
    >
      <div className="availability-modal">
        <div className="availability-modal-header">
          <div className="availability-modal-title">Availability — {type}</div>
          <button
            type="button"
            className="availability-modal-close"
            onClick={onClose}
            aria-label="Close availability modal"
          >
            ×
          </button>
        </div>

        <div className="availability-modal-actions">
          <button
            type="button"
            className="availability-modal-refresh"
            onClick={() => void fetchInventory()}
            disabled={loading}
          >
            Refresh
          </button>
          <button type="button" className="availability-modal-close-btn" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="availability-modal-body">
          <div className="availability-modal-list">
            {showLoading && <div className="availability-modal-loading">Loading…</div>}
            {error && <div className="availability-modal-error">{error}</div>}
            {!showLoading && !error && sortedItems.length === 0 && (
              <div className="availability-modal-empty">No entries in this category.</div>
            )}
            {!showLoading &&
              !error &&
              sortedItems.map((item) => {
                const groupIndex = getGroupIndex(item);
                const hasCheckout = Boolean(item.checkoutAt);
                const checkoutLabel =
                  hasCheckout && item.checkoutAt
                    ? `Checkout: ${new Date(item.checkoutAt).toLocaleString()}`
                    : undefined;
                return (
                  <div className="availability-modal-row" key={`${item.kind}-${item.id}`}>
                    <div>
                      <div className="availability-modal-row-title">
                        {item.kind === 'room' ? 'Room' : 'Locker'} {item.number}
                      </div>
                      <div className="availability-modal-status">{GROUP_LABELS[groupIndex]}</div>
                    </div>
                    <div className="availability-modal-row-meta">
                      {groupIndex === 3 && item.assignedMemberName && (
                        <div className="availability-modal-subtext">
                          Member: {item.assignedMemberName}
                        </div>
                      )}
                      {groupIndex === 3 && checkoutLabel && (
                        <div className="availability-modal-subtext">{checkoutLabel}</div>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      </div>
    </div>
  );
}


