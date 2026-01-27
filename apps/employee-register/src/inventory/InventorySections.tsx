import { useMemo, type CSSProperties } from 'react';
import { RoomStatus } from '@club-ops/shared';
import type { AlertLevel, DetailedLocker, DetailedRoom } from './types';
import {
  ROOM_TYPE_LABELS,
  alertLevelFromMsUntil,
  formatDurationHuman,
  formatTimeOfDay,
  getMsUntil,
  groupRooms,
  sortGroupedRooms,
} from './utils';

const INVENTORY_COLUMN_HEADER_STYLE: CSSProperties = {
  fontWeight: 700,
  marginBottom: '0.5rem',
  paddingBottom: '0.25rem',
  borderBottom: '1px solid #334155',
  minHeight: '28px',
  display: 'flex',
  alignItems: 'center',
};

interface InventorySectionProps {
  title: string;
  rooms: DetailedRoom[];
  onSelectRoom: (room: DetailedRoom) => void;
  selectedItem: { type: 'room' | 'locker'; id: string; number: string; tier: string } | null;
  nowMs: number;
  disableSelection?: boolean;
  occupancyLookupMode?: boolean;
  highlightId?: string | null;
  onOpenCustomerAccount?: (customerId: string, customerLabel?: string) => void;
}

export function InventorySection({
  title,
  rooms,
  onSelectRoom,
  selectedItem,
  waitlistEntries = [],
  nowMs,
  disableSelection = false,
  occupancyLookupMode = false,
  highlightId = null,
  onOpenCustomerAccount,
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

  const sectionCounts = useMemo(() => {
    const availableCount = rooms.filter(
      (r) => r.status === RoomStatus.CLEAN && !r.assignedTo
    ).length;
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
      <div className="er-inv-section-header">
        <div className="er-inv-section-title">{title}</div>
        <div className="er-inv-section-meta er-inv-meta">
          Available: {sectionCounts.availableCount}
          {sectionCounts.nearing > 0 ? ` • Nearing: ${sectionCounts.nearing}` : ''}
          {sectionCounts.late > 0 ? ` • Late: ${sectionCounts.late}` : ''}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {/* Occupied */}
        <div style={{ minWidth: 0 }}>
          <div
            className="er-inv-column-title er-inv-column-title--occupied"
            style={{ ...INVENTORY_COLUMN_HEADER_STYLE }}
          >
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
                onOpenCustomerAccount={onOpenCustomerAccount}
              />
            ))
          ) : (
            <div style={{ padding: '0.75rem', color: '#94a3b8', textAlign: 'center' }}>None</div>
          )}
        </div>

        {/* Dirty / Cleaning */}
        <div style={{ minWidth: 0 }}>
          <div className="er-inv-column-title" style={{ ...INVENTORY_COLUMN_HEADER_STYLE }}>
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
          <div className="er-inv-column-title er-inv-column-title--available">✓ Available</div>
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
                onOpenCustomerAccount={onOpenCustomerAccount}
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
  onOpenCustomerAccount?: (customerId: string, customerLabel?: string) => void;
}

function RoomItem({
  room,
  isSelectable,
  isSelected,
  isHighlighted = false,
  onClick,
  isWaitlistMatch,
  nowMs,
  onOpenCustomerAccount: _onOpenCustomerAccount,
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
        dueLevel === 'danger'
          ? 'er-inv-item--danger'
          : dueLevel === 'warning'
            ? 'er-inv-item--warning'
            : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={isSelectable ? onClick : undefined}
      disabled={!isSelectable}
      aria-disabled={!isSelectable}
    >
      {isOccupied ? (
        <div className="er-inv-occupied-row">
          <div className="er-inv-occupied-number">{room.number}</div>
          <div className="er-inv-occupied-customer">
            <span className="er-inv-occupied-customer-text">{customerLabel ?? '—'}</span>
          </div>
          <div className="er-inv-occupied-checkout">
            <div className="er-inv-occupied-time">{checkoutTime ?? '—'}</div>
            <div
              className="er-inv-occupied-duration"
              style={{
                color: duration?.isOverdue ? '#ef4444' : 'rgba(148, 163, 184, 0.95)',
              }}
            >
              {duration ? (duration.isOverdue ? `Late ${duration.label}` : duration.label) : '—'}
            </div>
          </div>
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '0.75rem',
          }}
        >
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
              {room.number}
            </div>
            {!isCleaning && !isDirty && isWaitlistMatch && (
              <div
                className="er-text-sm"
                style={{ color: '#f59e0b', marginTop: '0.25rem', fontWeight: 800 }}
              >
                Upgrade Request
              </div>
            )}
            {isCleaning && (
              <div
                className="er-text-sm"
                style={{ color: '#94a3b8', marginTop: '0.25rem', fontWeight: 800 }}
              >
                Cleaning
              </div>
            )}
            {!isCleaning && isDirty && (
              <div
                className="er-text-sm"
                style={{ color: '#ef4444', marginTop: '0.25rem', fontWeight: 900 }}
              >
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
  onOpenCustomerAccount?: (customerId: string, customerLabel?: string) => void;
}

export function LockerSection({
  lockers,
  onSelectLocker,
  selectedItem,
  nowMs,
  disableSelection = false,
  occupancyLookupMode = false,
  highlightId = null,
  onOpenCustomerAccount: _onOpenCustomerAccount,
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
      <div className="er-inv-section-header">
        <div className="er-inv-section-title">{ROOM_TYPE_LABELS.LOCKER}</div>
        <div className="er-inv-section-meta er-inv-meta">
          Available: {sectionCounts.availableCount}
          {sectionCounts.nearing > 0 ? ` • Nearing: ${sectionCounts.nearing}` : ''}
          {sectionCounts.late > 0 ? ` • Late: ${sectionCounts.late}` : ''}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div style={{ minWidth: 0 }}>
          <div
            className="er-inv-column-title er-inv-column-title--occupied"
            style={{ ...INVENTORY_COLUMN_HEADER_STYLE }}
          >
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
                    dueLevel === 'danger'
                      ? 'er-inv-item--danger'
                      : dueLevel === 'warning'
                        ? 'er-inv-item--warning'
                        : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <div className="er-inv-occupied-row">
                    <div className="er-inv-occupied-number">{locker.number}</div>
                    <div className="er-inv-occupied-customer">
                      <span className="er-inv-occupied-customer-text">{customerLabel ?? '—'}</span>
                    </div>
                    <div className="er-inv-occupied-checkout">
                      <div className="er-inv-occupied-time">{checkoutTime ?? '—'}</div>
                      <div
                        className="er-inv-occupied-duration"
                        style={{
                          color: duration?.isOverdue ? '#ef4444' : 'rgba(148, 163, 184, 0.95)',
                        }}
                      >
                        {duration
                          ? duration.isOverdue
                            ? `Late ${duration.label}`
                            : duration.label
                          : '—'}
                      </div>
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
          <div className="er-inv-column-title er-inv-column-title--available">✓ Available</div>
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
