import { useState, useEffect, useMemo } from 'react';
import { RoomStatus, RoomType } from '@club-ops/shared';

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
type RoomGroup = 'upgradeRequest' | 'available' | 'cleaning' | 'dirty' | 'expiring' | 'occupied';

interface GroupedRoom {
  room: DetailedRoom;
  group: RoomGroup;
  minutesRemaining?: number;
  isWaitlistMatch?: boolean; // True if room matches pending waitlist upgrade
}

function groupRooms(
  rooms: DetailedRoom[], 
  waitlistEntries: Array<{ desiredTier: string; status: string }> = []
): GroupedRoom[] {
  const now = new Date();
  const thirtyMinutesFromNow = new Date(now.getTime() + 30 * 60 * 1000);

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

    // Cleaning: CLEANING status
    if (room.status === RoomStatus.CLEANING) {
      return { room, group: 'cleaning' as RoomGroup };
    }

    // Dirty: DIRTY status
    if (room.status === RoomStatus.DIRTY) {
      return { room, group: 'dirty' as RoomGroup };
    }

    // Expiring Soon: Occupied and checkout within 30 minutes
    if (room.checkoutAt) {
      const checkoutTime = new Date(room.checkoutAt);
      if (checkoutTime <= thirtyMinutesFromNow && checkoutTime > now) {
        const minutesRemaining = Math.ceil((checkoutTime.getTime() - now.getTime()) / (60 * 1000));
        return { room, group: 'expiring' as RoomGroup, minutesRemaining };
      }
    }

    // Occupied: Other occupied rooms
    if (room.assignedTo || room.status === RoomStatus.OCCUPIED) {
      return { room, group: 'occupied' as RoomGroup };
    }

    // Default to available for other cases
    return { room, group: 'available' as RoomGroup };
  });
}

function sortGroupedRooms(grouped: GroupedRoom[]): GroupedRoom[] {
  return grouped.sort((a, b) => {
    // Group order: upgradeRequest, available, cleaning, dirty, expiring, occupied
    const groupOrder: Record<RoomGroup, number> = {
      upgradeRequest: 0,
      available: 1,
      cleaning: 2,
      dirty: 3,
      expiring: 4,
      occupied: 5,
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

    // Within expiring: sort by checkout_at ascending (soonest first)
    if (a.group === 'expiring') {
      if (!a.room.checkoutAt || !b.room.checkoutAt) return 0;
      return new Date(a.room.checkoutAt).getTime() - new Date(b.room.checkoutAt).getTime();
    }

    // Within occupied: sort by checkout_at ascending (most expired first)
    if (a.group === 'occupied') {
      if (!a.room.checkoutAt || !b.room.checkoutAt) return 0;
      return new Date(a.room.checkoutAt).getTime() - new Date(b.room.checkoutAt).getTime();
    }

    return 0;
  });
}

export function InventorySelector({
  customerSelectedType,
  waitlistDesiredTier,
  waitlistBackupType,
  onSelect,
  selectedItem,
  sessionId,
  lane,
  sessionToken,
}: InventorySelectorProps) {
  const [inventory, setInventory] = useState<DetailedInventory | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [waitlistEntries, setWaitlistEntries] = useState<Array<{ desiredTier: string; status: string }>>([]);

  const API_BASE = '/api';

  // Listen for WebSocket events to trigger refresh
  useEffect(() => {
    const ws = new WebSocket(`ws://${window.location.hostname}:3001/ws?lane=${encodeURIComponent(lane)}`);

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'subscribe',
        events: ['ROOM_STATUS_CHANGED', 'INVENTORY_UPDATED', 'ROOM_ASSIGNED', 'ROOM_RELEASED'],
      }));
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'ROOM_STATUS_CHANGED' || 
            message.type === 'INVENTORY_UPDATED' || 
            message.type === 'ROOM_ASSIGNED' || 
            message.type === 'ROOM_RELEASED') {
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

        const data = await response.json();
        if (mounted) {
          // Transform detailed inventory response
          // Map room tier from type field using getRoomTier function
          const getRoomTier = (roomNumber: string): 'SPECIAL' | 'DOUBLE' | 'STANDARD' => {
            const num = parseInt(roomNumber, 10);
            if (num === 201 || num === 232 || num === 256) return 'SPECIAL';
            if (num === 216 || num === 218 || num === 232 || num === 252 || num === 256 || num === 262 || num === 225) return 'DOUBLE';
            return 'STANDARD';
          };

          const rooms: DetailedRoom[] = (data.rooms || []).map((room: any) => ({
            id: room.id,
            number: room.number,
            tier: getRoomTier(room.number), // Compute tier from room number
            status: room.status as RoomStatus,
            floor: room.floor || 1,
            lastStatusChange: room.lastStatusChange || new Date().toISOString(),
            assignedTo: room.assignedTo,
            assignedMemberName: room.assignedMemberName,
            overrideFlag: room.overrideFlag || false,
            checkinAt: room.checkinAt,
            checkoutAt: room.checkoutAt,
          }));
          
          const lockers: DetailedLocker[] = (data.lockers || []).map((locker: any) => ({
            id: locker.id,
            number: locker.number,
            status: locker.status as RoomStatus,
            assignedTo: locker.assignedTo,
            assignedMemberName: locker.assignedMemberName,
            checkinAt: locker.checkinAt,
            checkoutAt: locker.checkoutAt,
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

    fetchInventory();

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
      const grouped = groupRooms(roomsOfType, waitlistEntries);
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
  }, [inventory, customerSelectedType, waitlistBackupType, selectedItem, onSelect]);

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
      />

      {/* Lockers */}
      <LockerSection
        lockers={inventory.lockers}
        isExpanded={expandedSections.has('LOCKER')}
        onToggle={() => toggleSection('LOCKER')}
        onSelectLocker={(locker) => onSelect('locker', locker.id, locker.number, 'LOCKER')}
        selectedItem={selectedItem}
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
}

function InventorySection({
  title,
  rooms,
  isExpanded,
  onToggle,
  onSelectRoom,
  selectedItem,
  waitlistEntries = [],
}: InventorySectionProps & { waitlistEntries?: Array<{ desiredTier: string; status: string }> }) {
  const grouped = useMemo(() => {
    const groupedRooms = groupRooms(rooms, waitlistEntries);
    return sortGroupedRooms(groupedRooms);
  }, [rooms, waitlistEntries]);

  const upgradeRequests = grouped.filter(g => g.group === 'upgradeRequest');
  const available = grouped.filter(g => g.group === 'available');
  const cleaning = grouped.filter(g => g.group === 'cleaning');
  const dirty = grouped.filter(g => g.group === 'dirty');
  const expiring = grouped.filter(g => g.group === 'expiring');
  const occupied = grouped.filter(g => g.group === 'occupied');

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
                />
              ))}
            </div>
          )}

          {/* Expiring Soon */}
          {expiring.length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ 
                fontSize: '0.875rem', 
                fontWeight: 600, 
                color: '#f59e0b', 
                marginBottom: '0.5rem',
                paddingBottom: '0.25rem',
                borderBottom: '1px solid #334155',
              }}>
                ⏰ Expiring Soon
              </div>
              {expiring.map(({ room, minutesRemaining }) => (
                <RoomItem
                  key={room.id}
                  room={room}
                  isSelectable={false}
                  isSelected={false}
                  minutesRemaining={minutesRemaining}
                />
              ))}
            </div>
          )}

          {/* Occupied */}
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
                🔒 Occupied (sorted by expiration)
              </div>
              {occupied.map(({ room }) => (
                <RoomItem
                  key={room.id}
                  room={room}
                  isSelectable={false}
                  isSelected={false}
                />
              ))}
            </div>
          )}

          {upgradeRequests.length === 0 && available.length === 0 && cleaning.length === 0 && dirty.length === 0 && expiring.length === 0 && occupied.length === 0 && (
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
  minutesRemaining?: number;
  isWaitlistMatch?: boolean;
}

function RoomItem({ room, isSelectable, isSelected, onClick, minutesRemaining, isWaitlistMatch }: RoomItemProps) {
  const isOccupied = !!room.assignedTo;

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
              {minutesRemaining !== undefined && ` • ${minutesRemaining} min remaining`}
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
}

function LockerSection({
  lockers,
  isExpanded,
  onToggle,
  onSelectLocker,
  selectedItem,
}: LockerSectionProps) {
  // Create grid of lockers 001-108
  const lockerMap = useMemo(() => {
    const map = new Map<string, DetailedLocker>();
    for (const locker of lockers) {
      map.set(locker.number, locker);
    }
    return map;
  }, [lockers]);

  const availableCount = lockers.filter(l => l.status === RoomStatus.CLEAN && !l.assignedTo).length;

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
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(12, 1fr)', 
            gap: '0.5rem',
            maxHeight: '400px',
            overflowY: 'auto',
          }}>
            {Array.from({ length: 108 }, (_, i) => {
              const lockerNumber = String(i + 1).padStart(3, '0');
              const locker = lockerMap.get(lockerNumber);
              const isAvailable = locker && locker.status === RoomStatus.CLEAN && !locker.assignedTo;
              const isOccupied = locker && !!locker.assignedTo;
              const isSelected = selectedItem?.type === 'locker' && selectedItem.number === lockerNumber;

              return (
                <div
                  key={lockerNumber}
                  onClick={isAvailable ? () => locker && onSelectLocker(locker) : undefined}
                  style={{
                    padding: '0.5rem',
                    background: isSelected ? '#3b82f6' : isOccupied ? '#1e293b' : isAvailable ? '#0f172a' : '#0a0f1a',
                    border: isSelected ? '2px solid #60a5fa' : '1px solid #475569',
                    borderRadius: '4px',
                    textAlign: 'center',
                    fontSize: '0.875rem',
                    cursor: isAvailable ? 'pointer' : 'default',
                    opacity: isOccupied ? 0.6 : 1,
                    minHeight: '44px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexDirection: 'column',
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{lockerNumber}</div>
                  {isOccupied && (
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Occupied</div>
                  )}
                  {isSelected && (
                    <div style={{ fontSize: '1rem', marginTop: '0.25rem' }}>✓</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

