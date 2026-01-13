import { useState } from 'react';
import { InventorySelector } from '../../InventorySelector';

export type InventoryDrawerSection = 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL' | null;

export interface InventoryDrawerProps {
  lane: string;
  sessionToken: string;
  forcedExpandedSection?: InventoryDrawerSection;
  onExpandedSectionChange?: (next: InventoryDrawerSection) => void;
  filterQuery?: string;
  customerSelectedType?: string | null;
  waitlistDesiredTier?: string | null;
  waitlistBackupType?: string | null;
  onSelect?: (type: 'room' | 'locker', id: string, number: string, tier: string) => void;
  onClearSelection?: () => void;
  selectedItem?: { type: 'room' | 'locker'; id: string; number: string; tier: string } | null;
  sessionId?: string | null;
  disableSelection?: boolean;
  onAlertSummaryChange?: (summary: { hasLate: boolean; hasNearing: boolean }) => void;
}

export function InventoryDrawer({
  lane,
  sessionToken,
  forcedExpandedSection,
  onExpandedSectionChange,
  filterQuery,
  customerSelectedType = null,
  waitlistDesiredTier = null,
  waitlistBackupType = null,
  onSelect,
  onClearSelection,
  selectedItem = null,
  sessionId = null,
  disableSelection = true,
  onAlertSummaryChange,
}: InventoryDrawerProps) {
  const [query, setQuery] = useState('');
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState<InventoryDrawerSection>(null);

  const expandedSection = forcedExpandedSection !== undefined ? forcedExpandedSection : uncontrolledExpanded;
  const effectiveQuery = filterQuery !== undefined ? filterQuery : query;

  return (
    <div
      style={{
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        overflow: 'hidden',
      }}
    >
      {/* Search stays pinned at the TOP of the inventory panel */}
      <div className="cs-liquid-search" style={{ flexShrink: 0 }}>
        <input
          className="cs-liquid-input cs-liquid-search__input"
          type="text"
          placeholder="Search by name or number..."
          value={effectiveQuery}
          onChange={(e) => setQuery(e.target.value)}
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

      {/*
        Main inventory content should never force the drawer itself to scroll.
        Each expanded category is responsible for its own internal scrolling.
      */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <InventorySelector
          customerSelectedType={customerSelectedType}
          waitlistDesiredTier={waitlistDesiredTier}
          waitlistBackupType={waitlistBackupType}
          onSelect={onSelect ?? (() => undefined)}
          selectedItem={selectedItem}
          sessionId={sessionId}
          lane={lane}
          sessionToken={sessionToken}
          filterQuery={effectiveQuery}
          forcedExpandedSection={expandedSection}
          onExpandedSectionChange={(next) => {
            onExpandedSectionChange?.(next);
            if (forcedExpandedSection === undefined) setUncontrolledExpanded(next);
          }}
          disableSelection={disableSelection}
          onAlertSummaryChange={onAlertSummaryChange}
        />
      </div>
    </div>
  );
}


