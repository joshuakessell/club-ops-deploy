import { useCallback, useEffect, useMemo, useState } from 'react';
import { RoomStatus, getApiUrl, getWebSocketUrl, useLaneSession } from '@club-ops/shared';
import { safeJsonParse } from '@club-ops/ui';

import { ModalFrame } from './components/register/modals/ModalFrame';
import { InventorySection, LockerSection } from './inventory/InventorySections';
import type { DetailedInventory, DetailedLocker, DetailedRoom } from './inventory/types';
import {
  alertLevelFromMsUntil,
  getMsUntil,
  groupRooms,
  isRecord,
  isUuid,
  readJson,
  sortGroupedRooms,
} from './inventory/utils';
import { PanelHeader } from './views/PanelHeader';
import { getRoomTier } from './utils/getRoomTier';

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
  onOpenCustomerAccount?: (customerId: string, customerLabel?: string) => void;
  /** External refresh nonce to force inventory refetch (e.g. after an inline checkout completes). */
  externalRefreshNonce?: number;
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
  onOpenCustomerAccount,
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
    customerId?: string;
    customerName?: string;
    checkinAt?: string;
    checkoutAt?: string;
  } | null>(null);
  const [searchHighlight, setSearchHighlight] = useState<null | {
    type: 'room' | 'locker';
    id: string;
  }>(null);
  const waitlistEntries: Array<{ desiredTier: string; status: string }> = useMemo(() => [], []);

  const API_BASE = getApiUrl('/api');

  // Live countdown tick (UI-only; does not refetch)
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const wsUrl = getWebSocketUrl(`/ws?lane=${encodeURIComponent(lane)}`);
  const rawEnv = import.meta.env as unknown as Record<string, unknown>;
  const kioskToken =
    typeof rawEnv.VITE_KIOSK_TOKEN === 'string' && rawEnv.VITE_KIOSK_TOKEN.trim()
      ? rawEnv.VITE_KIOSK_TOKEN.trim()
      : null;
  void wsUrl;

  const { lastMessage } = useLaneSession({
    laneId: lane,
    role: 'employee',
    kioskToken: kioskToken ?? '',
    enabled: true,
  });

  useEffect(() => {
    if (!lastMessage) return;
    const parsed = safeJsonParse<unknown>(String(lastMessage.data));
    if (!isRecord(parsed) || typeof parsed.type !== 'string') return;
    const t = parsed.type;
    if (
      t === 'ROOM_STATUS_CHANGED' ||
      t === 'INVENTORY_UPDATED' ||
      t === 'ROOM_ASSIGNED' ||
      t === 'ROOM_RELEASED'
    ) {
      setRefreshTrigger((prev) => prev + 1);
    }
  }, [lastMessage]);

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
  }, [API_BASE, sessionToken, refreshTrigger, externalRefreshNonce]);

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
    const rooms = inventory?.rooms;
    if (!rooms) {
      return { SPECIAL: [], DOUBLE: [], STANDARD: [] };
    }
    const grouped: Record<'SPECIAL' | 'DOUBLE' | 'STANDARD', DetailedRoom[]> = {
      SPECIAL: [],
      DOUBLE: [],
      STANDARD: [],
    };

    for (const room of rooms) {
      if (room.tier === 'SPECIAL' || room.tier === 'DOUBLE' || room.tier === 'STANDARD') {
        if (matchesQuery(room.number, room.assignedMemberName)) {
          grouped[room.tier].push(room);
        }
      }
    }

    return grouped;
  }, [inventory?.rooms, matchesQuery]);

  const filteredLockers = useMemo(() => {
    const lockers = inventory?.lockers;
    if (!lockers) return [];
    return lockers.filter((l) => matchesQuery(l.number, l.assignedMemberName));
  }, [inventory?.lockers, matchesQuery]);

  const navCounts = useMemo(() => {
    const base = {
      LOCKER: { available: 0, nearing: 0, late: 0 },
      STANDARD: { available: 0, nearing: 0, late: 0 },
      DOUBLE: { available: 0, nearing: 0, late: 0 },
      SPECIAL: { available: 0, nearing: 0, late: 0 },
    };

    if (!inventory) return base;

    for (const r of inventory.rooms) {
      if (r.tier !== 'STANDARD' && r.tier !== 'DOUBLE' && r.tier !== 'SPECIAL') continue;
      if (r.status === RoomStatus.CLEAN && !r.assignedTo) {
        base[r.tier].available += 1;
        continue;
      }
      const isOccupied = !!r.assignedTo || r.status === RoomStatus.OCCUPIED;
      if (!isOccupied) continue;
      const lvl = alertLevelFromMsUntil(getMsUntil(r.checkoutAt, nowMs));
      if (lvl === 'danger') base[r.tier].late += 1;
      else if (lvl === 'warning') base[r.tier].nearing += 1;
    }

    for (const l of inventory.lockers) {
      if (l.status === RoomStatus.CLEAN && !l.assignedTo) {
        base.LOCKER.available += 1;
        continue;
      }
      const isOccupied = !!l.assignedTo || l.status === RoomStatus.OCCUPIED;
      if (!isOccupied) continue;
      const lvl = alertLevelFromMsUntil(getMsUntil(l.checkoutAt, nowMs));
      if (lvl === 'danger') base.LOCKER.late += 1;
      else if (lvl === 'warning') base.LOCKER.nearing += 1;
    }

    return base;
  }, [inventory, nowMs]);

  const expandedSection =
    forcedExpandedSection !== undefined ? forcedExpandedSection : uncontrolledExpandedSection;

  const setExpandedSection = useCallback(
    (next: typeof expandedSection) => {
      onExpandedSectionChange?.(next);
      if (forcedExpandedSection === undefined) {
        setUncontrolledExpandedSection(next);
      }
    },
    [forcedExpandedSection, onExpandedSectionChange]
  );

  const setActiveSection = useCallback(
    (section: 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL') => {
      setExpandedSection(section);
    },
    [setExpandedSection]
  );

  const activeSection: 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL' = expandedSection ?? 'LOCKER';

  const openOccupancyDetails = (payload: {
    type: 'room' | 'locker';
    number: string;
    occupancyId?: string;
    customerId?: string;
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
        customerId: isUuid(room.assignedTo) ? room.assignedTo : undefined,
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
        customerId: isUuid(locker.assignedTo) ? locker.assignedTo : undefined,
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

  if (loading) {
    return <div className="u-p-16 u-text-center">Loading inventory...</div>;
  }

  if (error) {
    return <div className="u-p-16 u-text-danger">Error: {error}</div>;
  }

  if (!inventory) {
    return null;
  }

  const selectionLockedToType: 'room' | 'locker' | null = selectedItem?.type ?? null;

  return (
    <>
      <div className="u-h-full u-min-h-0 u-flex u-flex-col">
        <PanelHeader title="Rentals" />

        {!occupancyLookupMode && !disableSelection && selectedItem && onClearSelection && (
          <button
            className="cs-liquid-button cs-liquid-button--secondary"
            onClick={onClearSelection}
            className="cs-liquid-button cs-liquid-button--secondary er-inv-clear-btn"
          >
            Clear selection (currently {selectedItem.type === 'room' ? 'Room' : 'Locker'}{' '}
            {selectedItem.number})
          </button>
        )}

        {/* Single card layout: left buttons + right scrollable list pane */}
        <div className="er-inv-layout">
          <div className="er-inv-sidebar">
            {(
              [
                ['LOCKER', 'Lockers'],
                ['STANDARD', 'Standard'],
                ['DOUBLE', 'Double'],
                ['SPECIAL', 'Special'],
              ] as const
            ).map(([tier, label]) => {
              const counts = navCounts[tier];
              return (
                <button
                  key={tier}
                  type="button"
                  className={[
                    'cs-liquid-button',
                    activeSection === tier
                      ? 'cs-liquid-button--selected'
                      : 'cs-liquid-button--secondary',
                    'er-inv-nav-button',
                  ].join(' ')}
                  onClick={() => setActiveSection(tier)}
                >
                  <div className="er-inv-nav">
                    <div className="er-inv-nav-label">{label}</div>
                    <div
                      className={[
                        'er-inv-nav-stats',
                        'er-inv-meta',
                        activeSection === tier
                          ? 'er-inv-nav-stats--active'
                          : 'er-inv-nav-stats--inactive',
                      ].join(' ')}
                    >
                      <div>Available {counts.available}</div>
                      <div>Nearing Checkout {counts.nearing}</div>
                      <div>Past Checkout {counts.late}</div>
                    </div>
                  </div>
                </button>
              );
            })}

            {/* Search directly beneath the Special button */}
            <div className="u-mt-8">
              <div className="er-inv-search-label">Search</div>
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
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
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

          <div className="u-min-w-0 u-min-h-0 u-flex u-flex-col">
            <div className="cs-liquid-card er-inv-pane">
              {activeSection === 'LOCKER' ? (
                <LockerSection
                  lockers={filteredLockers}
                  onSelectLocker={handleLockerClick}
                  selectedItem={selectedItem}
                  nowMs={nowMs}
                  disableSelection={disableSelection || selectionLockedToType === 'room'}
                  occupancyLookupMode={occupancyLookupMode}
                  highlightId={searchHighlight?.type === 'locker' ? searchHighlight.id : null}
                  onOpenCustomerAccount={onOpenCustomerAccount}
                />
              ) : (
                <InventorySection
                  title={
                    activeSection === 'STANDARD'
                      ? 'Standard Rooms'
                      : activeSection === 'DOUBLE'
                        ? 'Double Rooms'
                        : 'Special Rooms'
                  }
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
                  onOpenCustomerAccount={onOpenCustomerAccount}
                />
              )}
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
          <div className="u-grid u-gap-12">
            <div className="u-text-center er-text-1p5 u-fw-600">
              {occupancyDetails.customerId && onOpenCustomerAccount ? (
                <button
                  type="button"
                  className="cs-liquid-button cs-liquid-button--secondary"
                  className="cs-liquid-button cs-liquid-button--secondary er-compact-pill"
                  onClick={() =>
                    onOpenCustomerAccount(
                      occupancyDetails.customerId!,
                      occupancyDetails.customerName
                    )
                  }
                >
                  {occupancyDetails.customerName || 'Customer'}
                </button>
              ) : (
                <span>{occupancyDetails.customerName || '—'}</span>
              )}
            </div>

            <div className="er-surface er-surface-card">
              <div className="er-text-sm er-text-muted u-mb-4">
                Check-in
              </div>
              <div className="u-fw-800">
                {occupancyDetails.checkinAt
                  ? new Date(occupancyDetails.checkinAt).toLocaleString()
                  : '—'}
              </div>
            </div>

            <div className="er-surface er-surface-card">
              <div className="er-text-sm er-text-muted u-mb-4">
                Checkout
              </div>
              <div className="u-fw-800">
                {occupancyDetails.checkoutAt
                  ? new Date(occupancyDetails.checkoutAt).toLocaleString()
                  : '—'}
              </div>
            </div>

            <div className="u-flex u-justify-center">
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
