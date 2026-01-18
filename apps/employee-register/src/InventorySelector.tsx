import { useState, useEffect, useMemo, type CSSProperties } from 'react';
import { RoomStatus } from '@club-ops/shared';
import { safeJsonParse, useReconnectingWebSocket } from '@club-ops/ui';
import { getRoomTier } from './utils/getRoomTier';
import { ModalFrame } from './components/register/modals/ModalFrame';

const INVENTORY_COLUMN_HEADER_STYLE: CSSProperties = {
  fontWeight: 700,
  marginBottom: '0.5rem',
  paddingBottom: '0.25rem',
  borderBottom: '1px solid #334155',
  minHeight: '28px',
  display: 'flex',
  alignItems: 'center',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function readJson<T>(response: Response): Promise<T> {
  const data: unknown = await response.json();
  return data as T;
}

function getMsUntil(iso: string | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return t - nowMs;
}

function formatCountdownHMM5Min(msUntil: number): { label: string; isOverdue: boolean } {
  const isOverdue = msUntil < 0;
  // Display in 5-minute increments and update on a 5-minute tick.
  // Example: 3 hours 20 minutes => "320"
  const minutesTotalRaw = Math.max(0, Math.ceil(Math.abs(msUntil) / (60 * 1000)));
  const minutesTotal = Math.ceil(minutesTotalRaw / 5) * 5;
  const hours = Math.floor(minutesTotal / 60);
  const minutes = minutesTotal % 60;
  const hmm = `${String(hours)}${String(minutes).padStart(2, '0')}`;
  return { label: hmm, isOverdue };
}

function formatDurationHuman(msUntil: number): { label: string; isOverdue: boolean } {
  const isOverdue = msUntil < 0;
  const minutesTotalRaw = Math.max(0, Math.ceil(Math.abs(msUntil) / (60 * 1000)));
  const minutesTotal = minutesTotalRaw; // Do not round; show exact minutes (based on tick cadence).
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

function formatTimeOfDay(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

interface DetailedRoom {
  id: string;
  number: string;
  tier: string; // STANDARD, DOUBLE, SPECIAL
  status: RoomStatus;
  floor: number;
  lastStatusChange: string;
  assignedTo?: string;
  assignedMemberName?: string;
  overrideFlag: boolean;
  checkinAt?: string;
  checkoutAt?: string;
  occupancyId?: string;
}

interface DetailedLocker {
  id: string;
  number: string;
  status: RoomStatus;
  assignedTo?: string;
  assignedMemberName?: string;
  checkinAt?: string;
  checkoutAt?: string;
  occupancyId?: string;
}

interface DetailedInventory {
  rooms: DetailedRoom[];
  lockers: DetailedLocker[];
}

interface InventorySelectorProps {
  customerSelectedType: string | null; // LOCKER, STANDARD, DOUBLE, SPECIAL
  waitlistDesiredTier?: string | null;
  waitlistBackupType?: string | null;
  onSelect: (type: 'room' | 'locker', id: string, number: string, tier: string) => void;
  selectedItem: { type: 'room' | 'locker'; id: string; number: string; tier: string } | null;
  onClearSelection?: () => void;
  sessionId: string | null;
  lane: string;
  sessionToken: string;
  filterQuery?: string;
  forcedExpandedSection?: 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL' | null;
  onExpandedSectionChange?: (next: 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL' | null) => void;
  disableSelection?: boolean;
  onAlertSummaryChange?: (summary: { hasLate: boolean; hasNearing: boolean }) => void;
  /**
   * When provided, inventory can request an inline checkout flow (rendered on the main home tab panel),
   * rather than opening a modal within the drawer.
   */
  onRequestCheckout?: (prefill: { occupancyId?: string; number: string }) => void;
  /** External refresh nonce to force inventory refetch (e.g. after an inline checkout completes). */
  externalRefreshNonce?: number;
}

// Map room types to display names
const ROOM_TYPE_LABELS: Record<string, string> = {
  SPECIAL: 'Special Rooms',
  DOUBLE: 'Double Rooms',
  STANDARD: 'Standard Rooms',
  LOCKER: 'Lockers',
};

// Group rooms by availability status (standard view ordering)
type RoomGroup = 'upgradeRequest' | 'available' | 'occupied' | 'cleaning' | 'dirty';

interface GroupedRoom {
  room: DetailedRoom;
  group: RoomGroup;
  msUntilCheckout?: number | null;
  isWaitlistMatch?: boolean; // True if room matches pending waitlist upgrade
}

type AlertLevel = 'danger' | 'warning' | null;

const DUE_SOON_MS = 30 * 60 * 1000;

function alertLevelFromMsUntil(msUntil: number | null | undefined): AlertLevel {
  if (msUntil === null || msUntil === undefined) return null;
  if (!Number.isFinite(msUntil)) return null;
  if (msUntil < 0) return 'danger';
  if (msUntil <= DUE_SOON_MS) return 'warning';
  return null;
}

function maxAlert(a: AlertLevel, b: AlertLevel): AlertLevel {
  if (a === 'danger' || b === 'danger') return 'danger';
  if (a === 'warning' || b === 'warning') return 'warning';
  return null;
}

function groupRooms(
  rooms: DetailedRoom[],
  waitlistEntries: Array<{ desiredTier: string; status: string }> = [],
  nowMs: number
): GroupedRoom[] {
  // Create set of tiers with active waitlist entries
  const waitlistTiers = new Set(
    waitlistEntries
      .filter((e) => e.status === 'ACTIVE' || e.status === 'OFFERED')
      .map((e) => e.desiredTier)
  );

  return rooms.map((room) => {
    const isWaitlistMatch =
      waitlistTiers.has(room.tier) && room.status === RoomStatus.CLEAN && !room.assignedTo;

    // Upgrade request: room matches waitlist tier and is available
    if (isWaitlistMatch) {
      return { room, group: 'upgradeRequest' as RoomGroup, isWaitlistMatch: true };
    }

    // Available: CLEAN status and not assigned
    if (room.status === RoomStatus.CLEAN && !room.assignedTo) {
      return { room, group: 'available' as RoomGroup };
    }

    // Occupied: assigned or OCCUPIED status (show countdown if checkoutAt is present)
    if (room.assignedTo || room.status === RoomStatus.OCCUPIED) {
      return {
        room,
        group: 'occupied' as RoomGroup,
        msUntilCheckout: getMsUntil(room.checkoutAt, nowMs),
      };
    }

    // Cleaning: CLEANING status
    if (room.status === RoomStatus.CLEANING) {
      return { room, group: 'cleaning' as RoomGroup };
    }

    // Dirty: DIRTY status
    if (room.status === RoomStatus.DIRTY) {
      return { room, group: 'dirty' as RoomGroup };
    }

    // Default to available for other cases
    return { room, group: 'available' as RoomGroup };
  });
}

function sortGroupedRooms(grouped: GroupedRoom[]): GroupedRoom[] {
  return grouped.sort((a, b) => {
    // Group order: upgradeRequest, available, occupied, cleaning, dirty
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

    // Within available: sort by room number ascending
    if (a.group === 'available' || a.group === 'upgradeRequest') {
      return parseInt(a.room.number) - parseInt(b.room.number);
    }

    // Within cleaning/dirty: sort by room number ascending
    if (a.group === 'cleaning' || a.group === 'dirty') {
      return parseInt(a.room.number) - parseInt(b.room.number);
    }

    // Within occupied: sort by checkout_at ascending (closest checkout first; missing checkoutAt last)
    if (a.group === 'occupied') {
      const aMs = a.msUntilCheckout ?? null;
      const bMs = b.msUntilCheckout ?? null;
      const aLevel = alertLevelFromMsUntil(aMs);
      const bLevel = alertLevelFromMsUntil(bMs);

      // Overdue first, then due-soon, then normal.
      const rank = (lvl: AlertLevel) => (lvl === 'danger' ? 0 : lvl === 'warning' ? 1 : 2);
      if (rank(aLevel) !== rank(bLevel)) return rank(aLevel) - rank(bLevel);

      // Within overdue: most overdue first (more negative).
      if (aLevel === 'danger' && bLevel === 'danger') return (aMs ?? 0) - (bMs ?? 0);

      // Within due-soon: soonest first.
      if (aLevel === 'warning' && bLevel === 'warning') return (aMs ?? 0) - (bMs ?? 0);

      // Otherwise: closest checkout first; missing checkoutAt last.
      const aTime = a.room.checkoutAt ? new Date(a.room.checkoutAt).getTime() : Number.POSITIVE_INFINITY;
      const bTime = b.room.checkoutAt ? new Date(b.room.checkoutAt).getTime() : Number.POSITIVE_INFINITY;
      return aTime - bTime;
    }

    return 0;
  });
}

export function InventorySelector({
  customerSelectedType,
  waitlistDesiredTier: _waitlistDesiredTier,
  waitlistBackupType,
  onSelect,
  selectedItem,
  onClearSelection,
  sessionId: _sessionId,
  lane,
  sessionToken,
  filterQuery,
  forcedExpandedSection,
  onExpandedSectionChange,
  disableSelection = false,
  onAlertSummaryChange,
  onRequestCheckout,
  externalRefreshNonce,
}: InventorySelectorProps) {
  // When there's no active lane session, treat inventory as a lookup tool (occupied-only details),
  // not an assignment picker.
  const occupancyLookupMode = !_sessionId;

  const [inventory, setInventory] = useState<DetailedInventory | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [uncontrolledExpandedSection, setUncontrolledExpandedSection] = useState<
    'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL' | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [localFilterQuery, setLocalFilterQuery] = useState('');
  const [occupancyDetails, setOccupancyDetails] = useState<{
    type: 'room' | 'locker';
    number: string;
    occupancyId?: string;
    customerName?: string;
    checkinAt?: string;
    checkoutAt?: string;
  } | null>(null);
  const waitlistEntries: Array<{ desiredTier: string; status: string }> = useMemo(() => [], []);

  const API_BASE = '/api';

  // Live countdown tick (UI-only; does not refetch)
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws?lane=${encodeURIComponent(lane)}`;

  useReconnectingWebSocket({
    url: wsUrl,
    onOpenSendJson: [
      {
        type: 'subscribe',
        events: ['ROOM_STATUS_CHANGED', 'INVENTORY_UPDATED', 'ROOM_ASSIGNED', 'ROOM_RELEASED'],
      },
    ],
    onMessage: (event) => {
      const parsed = safeJsonParse<unknown>(String(event.data));
      if (!isRecord(parsed) || typeof parsed.type !== 'string') return;
      const t = parsed.type;
      if (t === 'ROOM_STATUS_CHANGED' || t === 'INVENTORY_UPDATED' || t === 'ROOM_ASSIGNED' || t === 'ROOM_RELEASED') {
        setRefreshTrigger((prev) => prev + 1);
      }
    },
  });

  // Determine which section to auto-expand
  useEffect(() => {
    if (!customerSelectedType) return;

    const sectionToExpand = waitlistBackupType || customerSelectedType;
    if (
      sectionToExpand === 'LOCKER' ||
      sectionToExpand === 'STANDARD' ||
      sectionToExpand === 'DOUBLE' ||
      sectionToExpand === 'SPECIAL'
    ) {
      if (forcedExpandedSection !== undefined) {
        onExpandedSectionChange?.(sectionToExpand);
      } else {
        setUncontrolledExpandedSection(sectionToExpand);
        onExpandedSectionChange?.(sectionToExpand);
      }
    }
  }, [customerSelectedType, waitlistBackupType, forcedExpandedSection, onExpandedSectionChange]);

  // Fetch inventory
  useEffect(() => {
    let mounted = true;

    async function fetchInventory() {
      try {
        setLoading(true);
        // Use detailed inventory endpoint to get all statuses
        const response = await fetch(`${API_BASE}/v1/inventory/detailed`, {
          headers: {
            Authorization: `Bearer ${sessionToken}`,
          },
        });

        if (!response.ok) {
          throw new Error('Failed to fetch inventory');
        }

        const data = await readJson<{ rooms?: unknown[]; lockers?: unknown[] }>(response);
        if (mounted) {
          // Transform detailed inventory response
          const rooms: DetailedRoom[] = (Array.isArray(data.rooms) ? data.rooms : [])
            .filter(isRecord)
            .filter(
              (room) =>
                typeof room.id === 'string' &&
                typeof room.number === 'string' &&
                typeof room.status === 'string'
            )
            .map((room) => ({
              id: room.id as string,
              number: room.number as string,
              tier: getRoomTier(room.number as string), // Compute tier from room number
              status: room.status as RoomStatus,
              floor: typeof room.floor === 'number' ? room.floor : 1,
              lastStatusChange:
                typeof room.lastStatusChange === 'string'
                  ? room.lastStatusChange
                  : new Date().toISOString(),
              assignedTo: typeof room.assignedTo === 'string' ? room.assignedTo : undefined,
              assignedMemberName:
                typeof room.assignedMemberName === 'string' ? room.assignedMemberName : undefined,
              overrideFlag: typeof room.overrideFlag === 'boolean' ? room.overrideFlag : false,
              checkinAt: typeof room.checkinAt === 'string' ? room.checkinAt : undefined,
              checkoutAt: typeof room.checkoutAt === 'string' ? room.checkoutAt : undefined,
              occupancyId: typeof room.occupancyId === 'string' ? room.occupancyId : undefined,
            }));

          const lockers: DetailedLocker[] = (Array.isArray(data.lockers) ? data.lockers : [])
            .filter(isRecord)
            .filter(
              (locker) =>
                typeof locker.id === 'string' &&
                typeof locker.number === 'string' &&
                typeof locker.status === 'string'
            )
            .map((locker) => ({
              id: locker.id as string,
              number: locker.number as string,
              status: locker.status as RoomStatus,
              assignedTo: typeof locker.assignedTo === 'string' ? locker.assignedTo : undefined,
              assignedMemberName:
                typeof locker.assignedMemberName === 'string'
                  ? locker.assignedMemberName
                  : undefined,
              checkinAt: typeof locker.checkinAt === 'string' ? locker.checkinAt : undefined,
              checkoutAt: typeof locker.checkoutAt === 'string' ? locker.checkoutAt : undefined,
              occupancyId: typeof locker.occupancyId === 'string' ? locker.occupancyId : undefined,
            }));

          setInventory({ rooms, lockers });
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load inventory');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void fetchInventory();

    return () => {
      mounted = false;
    };
  }, [sessionToken, refreshTrigger, externalRefreshNonce]);

  // Auto-select first available when customer selects type
  useEffect(() => {
    if (occupancyLookupMode) return;
    if (!inventory || !customerSelectedType || selectedItem) return;

    const sectionToUse = waitlistBackupType || customerSelectedType;
    let firstAvailable: {
      type: 'room' | 'locker';
      id: string;
      number: string;
      tier: string;
    } | null = null;

    if (sectionToUse === 'LOCKER') {
      const availableLockers = inventory.lockers
        .filter((l) => l.status === RoomStatus.CLEAN && !l.assignedTo)
        .sort((a, b) => parseInt(a.number) - parseInt(b.number));

      const first = availableLockers[0];
      if (first) {
        firstAvailable = {
          type: 'locker',
          id: first.id,
          number: first.number,
          tier: 'LOCKER',
        };
      }
    } else {
      const roomsOfType = inventory.rooms.filter((r) => r.tier === sectionToUse);
      const grouped = groupRooms(roomsOfType, waitlistEntries, nowMs);
      const sorted = sortGroupedRooms(grouped);
      const firstAvailableRoom = sorted.find(
        (g) => g.group === 'available' || g.group === 'upgradeRequest'
      );

      if (firstAvailableRoom) {
        firstAvailable = {
          type: 'room',
          id: firstAvailableRoom.room.id,
          number: firstAvailableRoom.room.number,
          tier: firstAvailableRoom.room.tier,
        };
      }
    }

    if (firstAvailable) {
      onSelect(firstAvailable.type, firstAvailable.id, firstAvailable.number, firstAvailable.tier);
    }
  }, [
    inventory,
    customerSelectedType,
    waitlistBackupType,
    selectedItem,
    onSelect,
    waitlistEntries,
    nowMs,
    occupancyLookupMode,
  ]);

  // Group rooms by tier (must be before conditional returns to follow React hooks rules)
  const effectiveFilterQuery = filterQuery !== undefined ? filterQuery : localFilterQuery;
  const query = effectiveFilterQuery.trim().toLowerCase();

  const matchesQuery = useMemo(() => {
    if (!query) return () => true;
    return (number: string, assignedMemberName?: string) => {
      const num = String(number ?? '').toLowerCase();
      const name = String(assignedMemberName ?? '').toLowerCase();
      return num.includes(query) || name.includes(query);
    };
  }, [query]);

  const roomsByTier = useMemo(() => {
    if (!inventory) {
      return { SPECIAL: [], DOUBLE: [], STANDARD: [] };
    }
    const grouped: Record<'SPECIAL' | 'DOUBLE' | 'STANDARD', DetailedRoom[]> = {
      SPECIAL: [],
      DOUBLE: [],
      STANDARD: [],
    };

    for (const room of inventory.rooms) {
      if (room.tier === 'SPECIAL' || room.tier === 'DOUBLE' || room.tier === 'STANDARD') {
        if (matchesQuery(room.number, room.assignedMemberName)) {
          grouped[room.tier].push(room);
        }
      }
    }

    return grouped;
  }, [inventory?.rooms, matchesQuery]);

  const filteredLockers = useMemo(() => {
    if (!inventory) return [];
    return inventory.lockers.filter((l) => matchesQuery(l.number, l.assignedMemberName));
  }, [inventory?.lockers, matchesQuery]);

  const expandedSection =
    forcedExpandedSection !== undefined ? forcedExpandedSection : uncontrolledExpandedSection;

  const setExpandedSection = (next: typeof expandedSection) => {
    onExpandedSectionChange?.(next);
    if (forcedExpandedSection === undefined) {
      setUncontrolledExpandedSection(next);
    }
  };

  const setActiveSection = (section: 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL') => {
    setExpandedSection(section);
  };

  const activeSection: 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL' = (expandedSection ??
    'LOCKER') as 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL';

  const openOccupancyDetails = (payload: {
    type: 'room' | 'locker';
    number: string;
    occupancyId?: string;
    customerName?: string;
    checkinAt?: string;
    checkoutAt?: string;
  }) => {
    setOccupancyDetails(payload);
  };

  const handleRoomClick = (room: DetailedRoom) => {
    const isOccupied = !!room.assignedTo || room.status === RoomStatus.OCCUPIED;
    if (isOccupied) {
      openOccupancyDetails({
        type: 'room',
        number: room.number,
        occupancyId: room.occupancyId,
        customerName: room.assignedMemberName || room.assignedTo,
        checkinAt: room.checkinAt,
        checkoutAt: room.checkoutAt,
      });
      return;
    }
    if (occupancyLookupMode) return;
    if (disableSelection) return;
    onSelect('room', room.id, room.number, room.tier);
  };

  const handleLockerClick = (locker: DetailedLocker) => {
    const isOccupied = !!locker.assignedTo || locker.status === RoomStatus.OCCUPIED;
    if (isOccupied) {
      openOccupancyDetails({
        type: 'locker',
        number: locker.number,
        occupancyId: locker.occupancyId,
        customerName: locker.assignedMemberName || locker.assignedTo,
        checkinAt: locker.checkinAt,
        checkoutAt: locker.checkoutAt,
      });
      return;
    }
    if (occupancyLookupMode) return;
    if (disableSelection) return;
    onSelect('locker', locker.id, locker.number, 'LOCKER');
  };

  // Overall alert summary for drawer handle tinting.
  // NOTE: Must be defined before any early returns to preserve hook order.
  useEffect(() => {
    if (!inventory || !onAlertSummaryChange) return;

    let hasLate = false;
    let hasNearing = false;

    for (const r of inventory.rooms) {
      const isOccupied = !!r.assignedTo || r.status === RoomStatus.OCCUPIED;
      if (!isOccupied) continue;
      const lvl = alertLevelFromMsUntil(getMsUntil(r.checkoutAt, nowMs));
      if (lvl === 'danger') hasLate = true;
      if (lvl === 'warning') hasNearing = true;
      if (hasLate && hasNearing) break;
    }
    if (!hasLate) {
      for (const l of inventory.lockers) {
        const isOccupied = !!l.assignedTo || l.status === RoomStatus.OCCUPIED;
        if (!isOccupied) continue;
        const lvl = alertLevelFromMsUntil(getMsUntil(l.checkoutAt, nowMs));
        if (lvl === 'danger') hasLate = true;
        if (lvl === 'warning') hasNearing = true;
        if (hasLate && hasNearing) break;
      }
    }

    onAlertSummaryChange({ hasLate, hasNearing });
  }, [inventory, nowMs, onAlertSummaryChange]);

  if (loading) {
    return <div style={{ padding: '1rem', textAlign: 'center' }}>Loading inventory...</div>;
  }

  if (error) {
    return <div style={{ padding: '1rem', color: '#ef4444' }}>Error: {error}</div>;
  }

  if (!inventory) {
    return null;
  }

  const selectionLockedToType: 'room' | 'locker' | null = selectedItem?.type ?? null;
  const [searchHighlight, setSearchHighlight] = useState<null | { type: 'room' | 'locker'; id: string }>(null);

  useEffect(() => {
    if (!query) {
      setSearchHighlight(null);
      return;
    }

    // Prefer first match across sections: LOCKER → STANDARD → DOUBLE → SPECIAL
    const locker = filteredLockers[0];
    if (locker) {
      setExpandedSection('LOCKER');
      setSearchHighlight({ type: 'locker', id: locker.id });
      return;
    }

    const standard = roomsByTier.STANDARD[0];
    if (standard) {
      setExpandedSection('STANDARD');
      setSearchHighlight({ type: 'room', id: standard.id });
      return;
    }

    const dbl = roomsByTier.DOUBLE[0];
    if (dbl) {
      setExpandedSection('DOUBLE');
      setSearchHighlight({ type: 'room', id: dbl.id });
      return;
    }

    const special = roomsByTier.SPECIAL[0];
    if (special) {
      setExpandedSection('SPECIAL');
      setSearchHighlight({ type: 'room', id: special.id });
      return;
    }

    setSearchHighlight(null);
  }, [query, filteredLockers, roomsByTier, setExpandedSection]);

  return (
    <>
      <div
        className="cs-liquid-card"
        style={{
          padding: '1rem',
          height: '100%',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <h2 style={{ margin: 0, marginBottom: '0.75rem', fontSize: '1.25rem', fontWeight: 800 }}>
          Inventory
        </h2>

        {!occupancyLookupMode && !disableSelection && selectedItem && onClearSelection && (
          <button
            className="cs-liquid-button cs-liquid-button--secondary"
            onClick={onClearSelection}
            style={{ width: '100%', marginBottom: '0.75rem', padding: '0.6rem', fontWeight: 800 }}
          >
            Clear selection (currently {selectedItem.type === 'room' ? 'Room' : 'Locker'} {selectedItem.number})
          </button>
        )}

        {/* Single card layout: left buttons + right scrollable list pane */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(140px, 40%) minmax(0, 1fr)',
            gap: '0.75rem',
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', minWidth: 0 }}>
            {([
              ['LOCKER', ROOM_TYPE_LABELS.LOCKER],
              ['STANDARD', 'Standard'],
              ['DOUBLE', 'Double'],
              ['SPECIAL', 'Special'],
            ] as const).map(([tier, label]) => (
              <button
                key={tier}
                type="button"
                className={[
                  'cs-liquid-button',
                  activeSection === tier ? 'cs-liquid-button--selected' : 'cs-liquid-button--secondary',
                ].join(' ')}
                onClick={() => setActiveSection(tier)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '0.65rem 0.75rem',
                  fontWeight: 800,
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <div style={{ minWidth: 0, minHeight: 0, overflowY: 'auto', paddingRight: '0.25rem' }}>
            {activeSection === 'LOCKER' ? (
              <LockerSection
                lockers={filteredLockers}
                onSelectLocker={handleLockerClick}
                selectedItem={selectedItem}
                nowMs={nowMs}
                disableSelection={disableSelection || selectionLockedToType === 'room'}
                occupancyLookupMode={occupancyLookupMode}
                highlightId={searchHighlight?.type === 'locker' ? searchHighlight.id : null}
              />
            ) : (
              <InventorySection
                title={activeSection === 'STANDARD' ? 'Standard' : activeSection === 'DOUBLE' ? 'Double' : 'Special'}
                rooms={
                  activeSection === 'STANDARD'
                    ? roomsByTier.STANDARD
                    : activeSection === 'DOUBLE'
                      ? roomsByTier.DOUBLE
                      : roomsByTier.SPECIAL
                }
                onSelectRoom={handleRoomClick}
                selectedItem={selectedItem}
                waitlistEntries={waitlistEntries}
                nowMs={nowMs}
                disableSelection={disableSelection || selectionLockedToType === 'locker'}
                occupancyLookupMode={occupancyLookupMode}
                highlightId={searchHighlight?.type === 'room' ? searchHighlight.id : null}
              />
            )}
          </div>
        </div>

        {/* Search pinned at the bottom of the same card */}
        <div style={{ marginTop: '0.75rem', flexShrink: 0 }}>
          <div style={{ margin: 0, marginBottom: '0.35rem', fontSize: '1.25rem', fontWeight: 800 }}>
            Search
          </div>
          <div className="cs-liquid-search">
            <input
              className="cs-liquid-input cs-liquid-search__input"
              type="text"
              placeholder="Search by name or number..."
              value={effectiveFilterQuery}
              onChange={(e) => setLocalFilterQuery(e.target.value)}
              aria-label="Inventory search"
              disabled={filterQuery !== undefined}
            />
            <div className="cs-liquid-search__icon">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M7.33333 12.6667C10.2789 12.6667 12.6667 10.2789 12.6667 7.33333C12.6667 4.38781 10.2789 2 7.33333 2C4.38781 2 2 4.38781 2 7.33333C2 10.2789 4.38781 12.6667 7.33333 12.6667Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M14 14L11.1 11.1"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>
        </div>
      </div>

      <ModalFrame
        isOpen={!!occupancyDetails}
        title={
          occupancyDetails
            ? `${occupancyDetails.type === 'room' ? 'Room' : 'Locker'} ${occupancyDetails.number}`
            : 'Occupancy'
        }
        onClose={() => setOccupancyDetails(null)}
        maxWidth="420px"
        maxHeight="50vh"
      >
        {occupancyDetails && (
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <div
              style={{
                textAlign: 'center',
                fontSize: '1.5rem',
                fontWeight: 600,
              }}
            >
              {occupancyDetails.customerName || '—'}
            </div>

            <div className="er-surface" style={{ padding: '0.75rem', borderRadius: 12 }}>
              <div className="er-text-sm" style={{ color: '#94a3b8', marginBottom: '0.25rem' }}>
                Check-in
              </div>
              <div style={{ fontWeight: 800 }}>
                {occupancyDetails.checkinAt ? new Date(occupancyDetails.checkinAt).toLocaleString() : '—'}
              </div>
            </div>

            <div className="er-surface" style={{ padding: '0.75rem', borderRadius: 12 }}>
              <div className="er-text-sm" style={{ color: '#94a3b8', marginBottom: '0.25rem' }}>
                Checkout
              </div>
              <div style={{ fontWeight: 800 }}>
                {occupancyDetails.checkoutAt ? new Date(occupancyDetails.checkoutAt).toLocaleString() : '—'}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <button
                type="button"
                className="cs-liquid-button"
                onClick={() => {
                  onRequestCheckout?.({
                    occupancyId: occupancyDetails.occupancyId,
                    number: occupancyDetails.number,
                  });
                  setOccupancyDetails(null);
                }}
              >
                Checkout
              </button>
            </div>
          </div>
        )}
      </ModalFrame>
    </>
  );
}

interface InventorySectionProps {
  title: string;
  rooms: DetailedRoom[];
  onSelectRoom: (room: DetailedRoom) => void;
  selectedItem: { type: 'room' | 'locker'; id: string; number: string; tier: string } | null;
  nowMs: number;
  disableSelection?: boolean;
  occupancyLookupMode?: boolean;
  highlightId?: string | null;
}

function InventorySection({
  title,
  rooms,
  onSelectRoom,
  selectedItem,
  waitlistEntries = [],
  nowMs,
  disableSelection = false,
  occupancyLookupMode = false,
  highlightId = null,
}: InventorySectionProps & { waitlistEntries?: Array<{ desiredTier: string; status: string }> }) {
  const grouped = useMemo(() => {
    const groupedRooms = groupRooms(rooms, waitlistEntries, nowMs);
    return sortGroupedRooms(groupedRooms);
  }, [rooms, waitlistEntries, nowMs]);

  const upgradeRequests = grouped.filter((g) => g.group === 'upgradeRequest');
  const available = grouped.filter((g) => g.group === 'available');
  const occupied = grouped.filter((g) => g.group === 'occupied');
  const cleaning = grouped.filter((g) => g.group === 'cleaning');
  const dirty = grouped.filter((g) => g.group === 'dirty');
  const availableForDisplay = [...upgradeRequests, ...available];
  const allowAvailableSelection = !disableSelection && !occupancyLookupMode;

  const sectionAlertLevel = useMemo(() => {
    let level: AlertLevel = null;
    for (const r of rooms) {
      const isOccupied = !!r.assignedTo || r.status === RoomStatus.OCCUPIED;
      if (!isOccupied) continue;
      const ms = getMsUntil(r.checkoutAt, nowMs);
      level = maxAlert(level, alertLevelFromMsUntil(ms));
      if (level === 'danger') return 'danger';
    }
    return level;
  }, [nowMs, rooms]);

  const sectionCounts = useMemo(() => {
    const availableCount = rooms.filter((r) => r.status === RoomStatus.CLEAN && !r.assignedTo).length;
    let nearing = 0;
    let late = 0;
    for (const r of rooms) {
      const isOccupied = !!r.assignedTo || r.status === RoomStatus.OCCUPIED;
      if (!isOccupied) continue;
      const lvl = alertLevelFromMsUntil(getMsUntil(r.checkoutAt, nowMs));
      if (lvl === 'danger') late += 1;
      else if (lvl === 'warning') nearing += 1;
    }
    return { availableCount, nearing, late };
  }, [nowMs, rooms]);

  return (
    <div>
      <div style={{ marginBottom: '0.75rem' }}>
        <div style={{ fontWeight: 900, fontSize: '1.05rem' }}>{title}</div>
        <div className="er-text-sm er-inv-meta" style={{ fontWeight: 800, marginTop: '0.25rem' }}>
          Available: {sectionCounts.availableCount}
          {sectionCounts.nearing > 0 ? ` • Nearing: ${sectionCounts.nearing}` : ''}
          {sectionCounts.late > 0 ? ` • Late: ${sectionCounts.late}` : ''}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {/* Occupied */}
        <div style={{ minWidth: 0 }}>
          <div className="er-text-sm" style={{ color: '#94a3b8', ...INVENTORY_COLUMN_HEADER_STYLE }}>
            🔒 Occupied
          </div>
          {occupied.length > 0 ? (
            occupied.map(({ room }) => (
              <RoomItem
                key={room.id}
                room={room}
                isSelectable={true}
                isSelected={false}
                isHighlighted={highlightId === room.id}
                onClick={() => onSelectRoom(room)}
                nowMs={nowMs}
              />
            ))
          ) : (
            <div style={{ padding: '0.75rem', color: '#94a3b8', textAlign: 'center' }}>None</div>
          )}
        </div>

        {/* Dirty / Cleaning */}
        <div style={{ minWidth: 0 }}>
          <div className="er-text-sm" style={{ color: '#94a3b8', ...INVENTORY_COLUMN_HEADER_STYLE }}>
            🧹 Dirty / Cleaning
          </div>
          {cleaning.map(({ room }) => (
            <RoomItem
              key={room.id}
              room={room}
              isSelectable={false}
              isSelected={false}
              isHighlighted={highlightId === room.id}
              nowMs={nowMs}
            />
          ))}
          {dirty.map(({ room }) => (
            <RoomItem
              key={room.id}
              room={room}
              isSelectable={false}
              isSelected={false}
              isHighlighted={highlightId === room.id}
              nowMs={nowMs}
            />
          ))}
          {cleaning.length === 0 && dirty.length === 0 && (
            <div style={{ padding: '0.75rem', color: '#94a3b8', textAlign: 'center' }}>None</div>
          )}
        </div>

        {/* Available */}
        <div style={{ minWidth: 0 }}>
          <div className="er-text-sm" style={{ color: '#10b981', ...INVENTORY_COLUMN_HEADER_STYLE }}>
            ✓ Available
          </div>
          {availableForDisplay.length > 0 ? (
            availableForDisplay.map(({ room, isWaitlistMatch }) => (
              <RoomItem
                key={room.id}
                room={room}
                isSelectable={allowAvailableSelection}
                isSelected={selectedItem?.type === 'room' && selectedItem.id === room.id}
                isHighlighted={highlightId === room.id}
                onClick={() => {
                  if (!allowAvailableSelection) return;
                  onSelectRoom(room);
                }}
                isWaitlistMatch={isWaitlistMatch}
                nowMs={nowMs}
              />
            ))
          ) : (
            <div style={{ padding: '0.75rem', color: '#94a3b8', textAlign: 'center' }}>None</div>
          )}
        </div>
      </div>
    </div>
  );
}

interface RoomItemProps {
  room: DetailedRoom;
  isSelectable: boolean;
  isSelected: boolean;
  isHighlighted?: boolean;
  onClick?: () => void;
  isWaitlistMatch?: boolean;
  nowMs: number;
}

function RoomItem({
  room,
  isSelectable,
  isSelected,
  isHighlighted = false,
  onClick,
  isWaitlistMatch,
  nowMs,
}: RoomItemProps) {
  const isOccupied = !!room.assignedTo || room.status === RoomStatus.OCCUPIED;
  const isCleaning = room.status === RoomStatus.CLEANING;
  const isDirty = room.status === RoomStatus.DIRTY;
  const msUntil = isOccupied ? getMsUntil(room.checkoutAt, nowMs) : null;
  const duration = msUntil !== null ? formatDurationHuman(msUntil) : null;
  const checkoutTime = isOccupied ? formatTimeOfDay(room.checkoutAt) : null;
  const customerLabel = room.assignedMemberName || room.assignedTo || null;
  const dueLevel = isOccupied ? alertLevelFromMsUntil(msUntil) : null;

  return (
    <button
      type="button"
      className={[
        'cs-liquid-card',
        'er-inv-item',
        isWaitlistMatch ? 'er-inv-item--waitlist' : '',
        isSelected ? 'er-inv-item--selected' : '',
        isHighlighted ? 'er-inv-item--highlight' : '',
        dueLevel === 'danger' ? 'er-inv-item--danger' : dueLevel === 'warning' ? 'er-inv-item--warning' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={isSelectable ? onClick : undefined}
      disabled={!isSelectable}
      aria-disabled={!isSelectable}
    >
      {isOccupied ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.25rem 0.75rem' }}>
          <div className="er-text-lg" style={{ fontWeight: 900, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            Room {room.number}
          </div>
          <div className="er-text-md er-inv-meta" style={{ fontWeight: 900, whiteSpace: 'nowrap' }}>
            Checkout: {checkoutTime ?? '—'}
          </div>

          <div className="er-text-md er-inv-meta" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {customerLabel ?? '—'}
          </div>
          <div
            className="er-text-md"
            style={{
              fontWeight: 900,
              color: duration?.isOverdue ? '#ef4444' : duration ? 'rgba(148, 163, 184, 0.95)' : 'rgba(148, 163, 184, 0.95)',
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
            }}
          >
            ({duration ? (duration.isOverdue ? `Overdue ${duration.label}` : duration.label) : '—'})
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ minWidth: 0, overflow: 'hidden' }}>
            <div
              className="er-text-lg"
              style={{
                fontWeight: 800,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              Room {room.number}
            </div>
            {!isCleaning && !isDirty && isWaitlistMatch && (
              <div className="er-text-sm" style={{ color: '#f59e0b', marginTop: '0.25rem', fontWeight: 800 }}>
                Upgrade Request
              </div>
            )}
            {isCleaning && (
              <div className="er-text-sm" style={{ color: '#94a3b8', marginTop: '0.25rem', fontWeight: 800 }}>
                Cleaning
              </div>
            )}
            {!isCleaning && isDirty && (
              <div className="er-text-sm" style={{ color: '#ef4444', marginTop: '0.25rem', fontWeight: 900 }}>
                Dirty
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {isSelected && <span className="er-text-xl">✓</span>}
          </div>
        </div>
      )}
    </button>
  );
}

interface LockerSectionProps {
  lockers: DetailedLocker[];
  onSelectLocker: (locker: DetailedLocker) => void;
  selectedItem: { type: 'room' | 'locker'; id: string; number: string; tier: string } | null;
  nowMs: number;
  disableSelection?: boolean;
  occupancyLookupMode?: boolean;
  highlightId?: string | null;
}

function LockerSection({
  lockers,
  onSelectLocker,
  selectedItem,
  nowMs,
  disableSelection = false,
  occupancyLookupMode = false,
  highlightId = null,
}: LockerSectionProps) {
  const availableCount = lockers.filter(
    (l) => l.status === RoomStatus.CLEAN && !l.assignedTo
  ).length;
  const availableLockers = useMemo(
    () =>
      lockers
        .filter((l) => l.status === RoomStatus.CLEAN && !l.assignedTo)
        .sort((a, b) => parseInt(a.number) - parseInt(b.number)),
    [lockers]
  );
  const occupiedLockers = useMemo(
    () =>
      lockers
        .filter((l) => !!l.assignedTo || l.status === RoomStatus.OCCUPIED)
        .sort((a, b) => {
          const aMs = getMsUntil(a.checkoutAt, nowMs);
          const bMs = getMsUntil(b.checkoutAt, nowMs);
          const aLevel = alertLevelFromMsUntil(aMs);
          const bLevel = alertLevelFromMsUntil(bMs);
          const rank = (lvl: AlertLevel) => (lvl === 'danger' ? 0 : lvl === 'warning' ? 1 : 2);
          if (rank(aLevel) !== rank(bLevel)) return rank(aLevel) - rank(bLevel);
          if (aLevel === 'danger' && bLevel === 'danger') return (aMs ?? 0) - (bMs ?? 0);
          if (aLevel === 'warning' && bLevel === 'warning') return (aMs ?? 0) - (bMs ?? 0);
          const aTime = a.checkoutAt ? new Date(a.checkoutAt).getTime() : Number.POSITIVE_INFINITY;
          const bTime = b.checkoutAt ? new Date(b.checkoutAt).getTime() : Number.POSITIVE_INFINITY;
          return aTime - bTime;
        }),
    [lockers, nowMs]
  );

  const sectionAlertLevel = useMemo(() => {
    let level: AlertLevel = null;
    for (const l of occupiedLockers) {
      level = maxAlert(level, alertLevelFromMsUntil(getMsUntil(l.checkoutAt, nowMs)));
      if (level === 'danger') return 'danger';
    }
    return level;
  }, [nowMs, occupiedLockers]);

  const sectionCounts = useMemo(() => {
    let nearing = 0;
    let late = 0;
    for (const l of occupiedLockers) {
      const lvl = alertLevelFromMsUntil(getMsUntil(l.checkoutAt, nowMs));
      if (lvl === 'danger') late += 1;
      else if (lvl === 'warning') nearing += 1;
    }
    return { availableCount, nearing, late };
  }, [availableCount, nowMs, occupiedLockers]);

  return (
    <div>
      <div style={{ marginBottom: '0.75rem' }}>
        <div style={{ fontWeight: 900, fontSize: '1.05rem' }}>{ROOM_TYPE_LABELS.LOCKER}</div>
        <div className="er-text-sm er-inv-meta" style={{ fontWeight: 800, marginTop: '0.25rem' }}>
          Available: {sectionCounts.availableCount}
          {sectionCounts.nearing > 0 ? ` • Nearing: ${sectionCounts.nearing}` : ''}
          {sectionCounts.late > 0 ? ` • Late: ${sectionCounts.late}` : ''}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div style={{ minWidth: 0 }}>
          <div className="er-text-sm" style={{ color: '#94a3b8', ...INVENTORY_COLUMN_HEADER_STYLE }}>
            🔒 Occupied
          </div>
          {occupiedLockers.length > 0 ? (
            occupiedLockers.map((locker) => {
              const msUntil = getMsUntil(locker.checkoutAt, nowMs);
              const duration = msUntil !== null ? formatDurationHuman(msUntil) : null;
              const checkoutTime = formatTimeOfDay(locker.checkoutAt);
              const customerLabel = locker.assignedMemberName || locker.assignedTo || null;
              const dueLevel = alertLevelFromMsUntil(msUntil);
              return (
                <button
                  key={locker.id}
                  onClick={() => onSelectLocker(locker)}
                  type="button"
                  className={[
                    'cs-liquid-card',
                    'er-inv-item',
                    highlightId === locker.id ? 'er-inv-item--highlight' : '',
                    dueLevel === 'danger' ? 'er-inv-item--danger' : dueLevel === 'warning' ? 'er-inv-item--warning' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.25rem 0.75rem' }}>
                    <div
                      className="er-text-lg"
                      style={{
                        fontWeight: 800,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      Locker {locker.number}
                    </div>
                    <div className="er-text-md er-inv-meta" style={{ fontWeight: 800, whiteSpace: 'nowrap' }}>
                      Checkout: {checkoutTime ?? '—'}
                    </div>

                    <div
                      className="er-text-md er-inv-meta"
                      style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                    >
                      {customerLabel ?? '—'}
                    </div>
                    <div
                      className="er-text-md"
                      style={{
                        fontWeight: 800,
                        color: duration?.isOverdue ? '#ef4444' : 'rgba(148, 163, 184, 0.95)',
                        fontVariantNumeric: 'tabular-nums',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      ({duration ? (duration.isOverdue ? `Overdue ${duration.label}` : duration.label) : '—'})
                    </div>
                  </div>
                </button>
              );
            })
          ) : (
            <div style={{ padding: '0.75rem', color: '#94a3b8', textAlign: 'center' }}>None</div>
          )}
        </div>

        <div style={{ minWidth: 0 }}>
          <div className="er-text-sm" style={{ color: '#10b981', ...INVENTORY_COLUMN_HEADER_STYLE }}>
            ✓ Available
          </div>
          {availableLockers.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.5rem' }}>
              {availableLockers.map((locker) => {
                const isSelected = selectedItem?.type === 'locker' && selectedItem.id === locker.id;
                const isHighlighted = highlightId === locker.id;
                return (
                  <div
                    key={locker.id}
                    onClick={() => {
                      if (disableSelection || occupancyLookupMode) return;
                      onSelectLocker(locker);
                    }}
                    style={{
                      padding: '0.5rem',
                      background: isSelected ? '#3b82f6' : '#0f172a',
                      border: isSelected
                        ? '2px solid #60a5fa'
                        : isHighlighted
                          ? '2px solid rgba(255,255,255,0.55)'
                          : '1px solid #475569',
                      borderRadius: '4px',
                      textAlign: 'center',
                      fontSize: '0.875rem',
                      cursor: disableSelection || occupancyLookupMode ? 'default' : 'pointer',
                      minHeight: '44px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexDirection: 'column',
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{locker.number}</div>
                    {isSelected && <div style={{ fontSize: '1rem', marginTop: '0.25rem' }}>✓</div>}
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ padding: '0.75rem', color: '#94a3b8', textAlign: 'center' }}>None</div>
          )}
        </div>
      </div>
    </div>
  );
}
