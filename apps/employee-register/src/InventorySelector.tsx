import { useState, useEffect, useMemo } from 'react';
import { RoomStatus } from '@club-ops/shared';

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

function formatCountdownHHMM(msUntil: number): { label: string; isOverdue: boolean } {
  const isOverdue = msUntil < 0;
  const minutesTotal = Math.max(0, Math.ceil(Math.abs(msUntil) / (60 * 1000)));
  const hours = Math.floor(minutesTotal / 60);
  const minutes = minutesTotal % 60;
  const hhmm = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  return { label: hhmm, isOverdue };
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
}

interface DetailedLocker {
  id: string;
  number: string;
  status: RoomStatus;
  assignedTo?: string;
  assignedMemberName?: string;
  checkinAt?: string;
  checkoutAt?: string;
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
  sessionId: string | null;
  lane: string;
  sessionToken: string;
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

function groupRooms(
  rooms: DetailedRoom[], 
  waitlistEntries: Array<{ desiredTier: string; status: string }> = [],
  nowMs: number
): GroupedRoom[] {
  // Create set of tiers with active waitlist entries
  const waitlistTiers = new Set(
    waitlistEntries
      .filter(e => e.status === 'ACTIVE' || e.status === 'OFFERED')
      .map(e => e.desiredTier)
  );

  return rooms.map(room => {
    const isWaitlistMatch = waitlistTiers.has(room.tier) && room.status === RoomStatus.CLEAN && !room.assignedTo;

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
      return { room, group: 'occupied' as RoomGroup, msUntilCheckout: getMsUntil(room.checkoutAt, nowMs) };
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
      const aTime = a.room.checkoutAt ? new Date(a.room.checkoutAt).getTime() : Number.POSITIVE_INFINITY;
      const bTime = b.room.checkoutAt ? new Date(b.room.checkoutAt).getTime() : Number.POSITIVE_INFINITY;
      if (!Number.isFinite(aTime) && !Number.isFinite(bTime)) return 0;
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
  sessionId: _sessionId,
  lane,
  sessionToken,
}: InventorySelectorProps) {
  const [inventory, setInventory] = useState<DetailedInventory | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const waitlistEntries: Array<{ desiredTier: string; status: string }> = useMemo(() => [], []);

  const API_BASE = '/api';

  // Live countdown tick (HH:MM resolution is fine at 30s granularity)
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Listen for WebSocket events to trigger refresh
  useEffect(() => {
    // Use Vite proxy instead of direct connection
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws?lane=${encodeURIComponent(lane)}`);

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'subscribe',
        events: ['ROOM_STATUS_CHANGED', 'INVENTORY_UPDATED', 'ROOM_ASSIGNED', 'ROOM_RELEASED'],
      }));
    };

    ws.onmessage = (event) => {
      try {
        const parsed: unknown = JSON.parse(String(event.data)) as unknown;
        if (!isRecord(parsed) || typeof parsed.type !== 'string') return;
        const t = parsed.type;
        if (t === 'ROOM_STATUS_CHANGED' || 
            t === 'INVENTORY_UPDATED' || 
            t === 'ROOM_ASSIGNED' || 
            t === 'ROOM_RELEASED') {
          // Trigger refresh
          setRefreshTrigger(prev => prev + 1);
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    return () => ws.close();
  }, [lane]);

  // Determine which section to auto-expand
  useEffect(() => {
    if (!customerSelectedType) return;

    const sectionToExpand = waitlistBackupType || customerSelectedType;
    setExpandedSections(new Set([sectionToExpand]));
  }, [customerSelectedType, waitlistBackupType]);

  // Fetch inventory
  useEffect(() => {
    let mounted = true;

    async function fetchInventory() {
      try {
        setLoading(true);
        // Use detailed inventory endpoint to get all statuses
        const response = await fetch(`${API_BASE}/v1/inventory/detailed`, {
          headers: {
            'Authorization': `Bearer ${sessionToken}`,
          },
        });

        if (!response.ok) {
          throw new Error('Failed to fetch inventory');
        }

        const data = await readJson<{ rooms?: unknown[]; lockers?: unknown[] }>(response);
        if (mounted) {
          // Transform detailed inventory response
          // Map room tier from type field using getRoomTier function
          const getRoomTier = (roomNumber: string): 'SPECIAL' | 'DOUBLE' | 'STANDARD' => {
            const num = parseInt(roomNumber, 10);
            if (num === 201 || num === 232 || num === 256) return 'SPECIAL';
            if (num === 216 || num === 218 || num === 232 || num === 252 || num === 256 || num === 262 || num === 225) return 'DOUBLE';
            return 'STANDARD';
          };

          const rooms: DetailedRoom[] = (Array.isArray(data.rooms) ? data.rooms : [])
            .filter(isRecord)
            .filter((room) => typeof room.id === 'string' && typeof room.number === 'string' && typeof room.status === 'string')
            .map((room) => ({
              id: room.id as string,
              number: room.number as string,
              tier: getRoomTier(room.number as string), // Compute tier from room number
              status: room.status as RoomStatus,
              floor: typeof room.floor === 'number' ? room.floor : 1,
              lastStatusChange: typeof room.lastStatusChange === 'string' ? room.lastStatusChange : new Date().toISOString(),
              assignedTo: typeof room.assignedTo === 'string' ? room.assignedTo : undefined,
              assignedMemberName: typeof room.assignedMemberName === 'string' ? room.assignedMemberName : undefined,
              overrideFlag: typeof room.overrideFlag === 'boolean' ? room.overrideFlag : false,
              checkinAt: typeof room.checkinAt === 'string' ? room.checkinAt : undefined,
              checkoutAt: typeof room.checkoutAt === 'string' ? room.checkoutAt : undefined,
            }));
          
          const lockers: DetailedLocker[] = (Array.isArray(data.lockers) ? data.lockers : [])
            .filter(isRecord)
            .filter((locker) => typeof locker.id === 'string' && typeof locker.number === 'string' && typeof locker.status === 'string')
            .map((locker) => ({
              id: locker.id as string,
              number: locker.number as string,
              status: locker.status as RoomStatus,
              assignedTo: typeof locker.assignedTo === 'string' ? locker.assignedTo : undefined,
              assignedMemberName: typeof locker.assignedMemberName === 'string' ? locker.assignedMemberName : undefined,
              checkinAt: typeof locker.checkinAt === 'string' ? locker.checkinAt : undefined,
              checkoutAt: typeof locker.checkoutAt === 'string' ? locker.checkoutAt : undefined,
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
  }, [sessionToken, refreshTrigger]);

  // Auto-select first available when customer selects type
  useEffect(() => {
    if (!inventory || !customerSelectedType || selectedItem) return;

    const sectionToUse = waitlistBackupType || customerSelectedType;
    let firstAvailable: { type: 'room' | 'locker'; id: string; number: string; tier: string } | null = null;

    if (sectionToUse === 'LOCKER') {
      const availableLockers = inventory.lockers
        .filter(l => l.status === RoomStatus.CLEAN && !l.assignedTo)
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
      const roomsOfType = inventory.rooms.filter(r => r.tier === sectionToUse);
      const grouped = groupRooms(roomsOfType, waitlistEntries, nowMs);
      const sorted = sortGroupedRooms(grouped);
      const firstAvailableRoom = sorted.find(g => g.group === 'available' || g.group === 'upgradeRequest');
      
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
  }, [inventory, customerSelectedType, waitlistBackupType, selectedItem, onSelect, waitlistEntries, nowMs]);

  // Group rooms by tier (must be before conditional returns to follow React hooks rules)
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
        grouped[room.tier].push(room);
      }
    }

    return grouped;
  }, [inventory?.rooms]);

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  if (loading) {
    return <div style={{ padding: '1rem', textAlign: 'center' }}>Loading inventory...</div>;
  }

  if (error) {
    return <div style={{ padding: '1rem', color: '#ef4444' }}>Error: {error}</div>;
  }

  if (!inventory) {
    return null;
  }

  return (
    <div style={{ 
      background: '#1e293b', 
      borderRadius: '8px', 
      padding: '1rem',
      maxHeight: 'calc(100vh - 200px)',
      overflowY: 'auto',
    }}>
      <h2 style={{ marginBottom: '1rem', fontSize: '1.25rem', fontWeight: 600 }}>
        Inventory
      </h2>

      {/* Special Rooms */}
      <InventorySection
        title="Special Rooms"
        rooms={roomsByTier.SPECIAL}
        isExpanded={expandedSections.has('SPECIAL')}
        onToggle={() => toggleSection('SPECIAL')}
        onSelectRoom={(room) => onSelect('room', room.id, room.number, 'SPECIAL')}
        selectedItem={selectedItem}
        waitlistEntries={waitlistEntries}
        nowMs={nowMs}
      />

      {/* Double Rooms */}
      <InventorySection
        title="Double Rooms"
        rooms={roomsByTier.DOUBLE}
        isExpanded={expandedSections.has('DOUBLE')}
        onToggle={() => toggleSection('DOUBLE')}
        onSelectRoom={(room) => onSelect('room', room.id, room.number, 'DOUBLE')}
        selectedItem={selectedItem}
        waitlistEntries={waitlistEntries}
        nowMs={nowMs}
      />

      {/* Standard Rooms */}
      <InventorySection
        title="Standard Rooms"
        rooms={roomsByTier.STANDARD}
        isExpanded={expandedSections.has('STANDARD')}
        onToggle={() => toggleSection('STANDARD')}
        onSelectRoom={(room) => onSelect('room', room.id, room.number, 'STANDARD')}
        selectedItem={selectedItem}
        waitlistEntries={waitlistEntries}
        nowMs={nowMs}
      />

      {/* Lockers */}
      <LockerSection
        lockers={inventory.lockers}
        isExpanded={expandedSections.has('LOCKER')}
        onToggle={() => toggleSection('LOCKER')}
        onSelectLocker={(locker) => onSelect('locker', locker.id, locker.number, 'LOCKER')}
        selectedItem={selectedItem}
        nowMs={nowMs}
      />
    </div>
  );
}

interface InventorySectionProps {
  title: string;
  rooms: DetailedRoom[];
  isExpanded: boolean;
  onToggle: () => void;
  onSelectRoom: (room: DetailedRoom) => void;
  selectedItem: { type: 'room' | 'locker'; id: string; number: string; tier: string } | null;
  nowMs: number;
}

function InventorySection({
  title,
  rooms,
  isExpanded,
  onToggle,
  onSelectRoom,
  selectedItem,
  waitlistEntries = [],
  nowMs,
}: InventorySectionProps & { waitlistEntries?: Array<{ desiredTier: string; status: string }> }) {
  const grouped = useMemo(() => {
    const groupedRooms = groupRooms(rooms, waitlistEntries, nowMs);
    return sortGroupedRooms(groupedRooms);
  }, [rooms, waitlistEntries, nowMs]);

  const upgradeRequests = grouped.filter(g => g.group === 'upgradeRequest');
  const available = grouped.filter(g => g.group === 'available');
  const occupied = grouped.filter(g => g.group === 'occupied');
  const cleaning = grouped.filter(g => g.group === 'cleaning');
  const dirty = grouped.filter(g => g.group === 'dirty');

  return (
    <div style={{ marginBottom: '1rem' }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%',
          padding: '0.75rem',
          background: isExpanded ? '#334155' : '#0f172a',
          border: '1px solid #475569',
          borderRadius: '6px',
          color: '#f8fafc',
          fontSize: '1rem',
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span>{title} ({rooms.length})</span>
        <span>{isExpanded ? '▼' : '▶'}</span>
      </button>

      {isExpanded && (
        <div style={{ marginTop: '0.5rem', padding: '0.5rem', background: '#0f172a', borderRadius: '6px' }}>
          {/* Upgrade Requests (Waitlist) */}
          {upgradeRequests.length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ 
                fontSize: '0.875rem', 
                fontWeight: 600, 
                color: '#f59e0b', 
                marginBottom: '0.5rem',
                paddingBottom: '0.25rem',
                borderBottom: '1px solid #334155',
              }}>
                ⚠️ Upgrade Requests (Waitlist)
              </div>
              {upgradeRequests.map(({ room, isWaitlistMatch }) => (
                <RoomItem
                  key={room.id}
                  room={room}
                  isSelectable={true}
                  isSelected={selectedItem?.type === 'room' && selectedItem.id === room.id}
                  onClick={() => onSelectRoom(room)}
                  isWaitlistMatch={isWaitlistMatch}
                  nowMs={nowMs}
                />
              ))}
            </div>
          )}

          {/* Available Now */}
          {available.length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ 
                fontSize: '0.875rem', 
                fontWeight: 600, 
                color: '#10b981', 
                marginBottom: '0.5rem',
                paddingBottom: '0.25rem',
                borderBottom: '1px solid #334155',
              }}>
                ✓ Available Now
              </div>
              {available.map(({ room }) => (
                <RoomItem
                  key={room.id}
                  room={room}
                  isSelectable={true}
                  isSelected={selectedItem?.type === 'room' && selectedItem.id === room.id}
                  onClick={() => onSelectRoom(room)}
                  nowMs={nowMs}
                />
              ))}
            </div>
          )}

          {/* Occupied (closest checkout first) */}
          {occupied.length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ 
                fontSize: '0.875rem', 
                fontWeight: 600, 
                color: '#94a3b8', 
                marginBottom: '0.5rem',
                paddingBottom: '0.25rem',
                borderBottom: '1px solid #334155',
              }}>
                🔒 Occupied (soonest checkout first)
              </div>
              {occupied.map(({ room }) => (
                <RoomItem
                  key={room.id}
                  room={room}
                  isSelectable={false}
                  isSelected={false}
                  nowMs={nowMs}
                />
              ))}
            </div>
          )}

          {/* Cleaning */}
          {cleaning.length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ 
                fontSize: '0.875rem', 
                fontWeight: 600, 
                color: '#94a3b8', 
                marginBottom: '0.5rem',
                paddingBottom: '0.25rem',
                borderBottom: '1px solid #334155',
              }}>
                🧹 Cleaning
              </div>
              {cleaning.map(({ room }) => (
                <RoomItem
                  key={room.id}
                  room={room}
                  isSelectable={false}
                  isSelected={false}
                  nowMs={nowMs}
                />
              ))}
            </div>
          )}

          {/* Dirty */}
          {dirty.length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ 
                fontSize: '0.875rem', 
                fontWeight: 600, 
                color: '#ef4444', 
                marginBottom: '0.5rem',
                paddingBottom: '0.25rem',
                borderBottom: '1px solid #334155',
              }}>
                🗑️ Dirty
              </div>
              {dirty.map(({ room }) => (
                <RoomItem
                  key={room.id}
                  room={room}
                  isSelectable={false}
                  isSelected={false}
                  nowMs={nowMs}
                />
              ))}
            </div>
          )}

          {upgradeRequests.length === 0 && available.length === 0 && occupied.length === 0 && cleaning.length === 0 && dirty.length === 0 && (
            <div style={{ padding: '1rem', textAlign: 'center', color: '#94a3b8' }}>
              No rooms in this category
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface RoomItemProps {
  room: DetailedRoom;
  isSelectable: boolean;
  isSelected: boolean;
  onClick?: () => void;
  isWaitlistMatch?: boolean;
  nowMs: number;
}

function RoomItem({ room, isSelectable, isSelected, onClick, isWaitlistMatch, nowMs }: RoomItemProps) {
  const isOccupied = !!room.assignedTo;
  const msUntil = isOccupied ? getMsUntil(room.checkoutAt, nowMs) : null;
  const countdown = msUntil !== null ? formatCountdownHHMM(msUntil) : null;

  return (
    <div
      onClick={isSelectable ? onClick : undefined}
      style={{
        padding: '0.75rem',
        marginBottom: '0.5rem',
        background: isSelected ? '#3b82f6' : isOccupied ? '#1e293b' : '#0f172a',
        border: isWaitlistMatch 
          ? '2px solid #f59e0b' 
          : isSelected 
            ? '2px solid #60a5fa' 
            : '1px solid #475569',
        borderRadius: '6px',
        cursor: isSelectable ? 'pointer' : 'default',
        opacity: isOccupied ? 0.6 : 1,
        transition: 'all 0.2s',
      }}
      onMouseEnter={(e) => {
        if (isSelectable) {
          e.currentTarget.style.background = isSelected ? '#3b82f6' : '#334155';
        }
      }}
      onMouseLeave={(e) => {
        if (isSelectable) {
          e.currentTarget.style.background = isSelected ? '#3b82f6' : '#0f172a';
        }
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: '1rem' }}>
            Room {room.number}
          </div>
          {isOccupied && (
            <div style={{ fontSize: '0.875rem', color: '#94a3b8', marginTop: '0.25rem' }}>
              Occupied
              {countdown && (
                <span>
                  {' • '}
                  {countdown.isOverdue ? 'Overdue' : 'Checkout in'} {countdown.label}
                </span>
              )}
            </div>
          )}
        </div>
        {isSelected && (
          <span style={{ fontSize: '1.5rem' }}>✓</span>
        )}
      </div>
    </div>
  );
}

interface LockerSectionProps {
  lockers: DetailedLocker[];
  isExpanded: boolean;
  onToggle: () => void;
  onSelectLocker: (locker: DetailedLocker) => void;
  selectedItem: { type: 'room' | 'locker'; id: string; number: string; tier: string } | null;
  nowMs: number;
}

function LockerSection({
  lockers,
  isExpanded,
  onToggle,
  onSelectLocker,
  selectedItem,
  nowMs,
}: LockerSectionProps) {
  const availableCount = lockers.filter(l => l.status === RoomStatus.CLEAN && !l.assignedTo).length;
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
          const aTime = a.checkoutAt ? new Date(a.checkoutAt).getTime() : Number.POSITIVE_INFINITY;
          const bTime = b.checkoutAt ? new Date(b.checkoutAt).getTime() : Number.POSITIVE_INFINITY;
          return aTime - bTime;
        }),
    [lockers]
  );

  return (
    <div style={{ marginBottom: '1rem' }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%',
          padding: '0.75rem',
          background: isExpanded ? '#334155' : '#0f172a',
          border: '1px solid #475569',
          borderRadius: '6px',
          color: '#f8fafc',
          fontSize: '1rem',
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span>{ROOM_TYPE_LABELS.LOCKER} ({lockers.length}, {availableCount} available)</span>
        <span>{isExpanded ? '▼' : '▶'}</span>
      </button>

      {isExpanded && (
        <div style={{ marginTop: '0.5rem', padding: '0.5rem', background: '#0f172a', borderRadius: '6px' }}>
          {/* Available first */}
          {availableLockers.length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ 
                fontSize: '0.875rem', 
                fontWeight: 600, 
                color: '#10b981', 
                marginBottom: '0.5rem',
                paddingBottom: '0.25rem',
                borderBottom: '1px solid #334155',
              }}>
                ✓ Available Now
              </div>
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(12, 1fr)', 
                gap: '0.5rem',
                maxHeight: '240px',
                overflowY: 'auto',
              }}>
                {availableLockers.map((locker) => {
                  const isSelected = selectedItem?.type === 'locker' && selectedItem.id === locker.id;
                  return (
                    <div
                      key={locker.id}
                      onClick={() => onSelectLocker(locker)}
                      style={{
                        padding: '0.5rem',
                        background: isSelected ? '#3b82f6' : '#0f172a',
                        border: isSelected ? '2px solid #60a5fa' : '1px solid #475569',
                        borderRadius: '4px',
                        textAlign: 'center',
                        fontSize: '0.875rem',
                        cursor: 'pointer',
                        minHeight: '44px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexDirection: 'column',
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{locker.number}</div>
                      {isSelected && (
                        <div style={{ fontSize: '1rem', marginTop: '0.25rem' }}>✓</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Occupied with countdown, sorted by closest checkout */}
          {occupiedLockers.length > 0 && (
            <div style={{ marginBottom: '0.5rem' }}>
              <div style={{ 
                fontSize: '0.875rem', 
                fontWeight: 600, 
                color: '#94a3b8', 
                marginBottom: '0.5rem',
                paddingBottom: '0.25rem',
                borderBottom: '1px solid #334155',
              }}>
                🔒 Occupied (soonest checkout first)
              </div>
              {occupiedLockers.map((locker) => {
                const msUntil = getMsUntil(locker.checkoutAt, nowMs);
                const countdown = msUntil !== null ? formatCountdownHHMM(msUntil) : null;
                return (
                  <div
                    key={locker.id}
                    style={{
                      padding: '0.75rem',
                      marginBottom: '0.5rem',
                      background: '#1e293b',
                      border: '1px solid #475569',
                      borderRadius: '6px',
                      opacity: 0.7,
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>Locker {locker.number}</div>
                    <div style={{ fontSize: '0.875rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                      Occupied
                      {countdown && (
                        <span>
                          {' • '}
                          {countdown.isOverdue ? 'Overdue' : 'Checkout in'} {countdown.label}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Fallback grid for undefined locker records (rare) */}
          {availableLockers.length === 0 && occupiedLockers.length === 0 && (
            <div style={{ color: '#94a3b8', textAlign: 'center', padding: '1rem' }}>
              No locker inventory available
            </div>
          )}
        </div>
      )}
    </div>
  );
}

