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
  onRequestCheckout?: (prefill: { occupancyId?: string; number: string }) => void;
  externalRefreshNonce?: number;
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
  onClearSelection: _onClearSelection,
  selectedItem = null,
  sessionId = null,
  disableSelection = true,
  onAlertSummaryChange,
  onRequestCheckout,
  externalRefreshNonce,
}: InventoryDrawerProps) {
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState<InventoryDrawerSection>(null);

  const expandedSection = forcedExpandedSection !== undefined ? forcedExpandedSection : uncontrolledExpanded;

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
          filterQuery={filterQuery}
          forcedExpandedSection={expandedSection}
          onExpandedSectionChange={(next) => {
            onExpandedSectionChange?.(next);
            if (forcedExpandedSection === undefined) setUncontrolledExpanded(next);
          }}
          disableSelection={disableSelection}
          onAlertSummaryChange={onAlertSummaryChange}
          onRequestCheckout={onRequestCheckout}
          externalRefreshNonce={externalRefreshNonce}
        />
      </div>
    </div>
  );
}


