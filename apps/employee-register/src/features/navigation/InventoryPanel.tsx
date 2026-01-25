import { InventoryDrawer } from '../../components/inventory/InventoryDrawer';
import { useEmployeeRegisterState } from '../../app/state/useEmployeeRegisterState';

export function InventoryPanel() {
  const {
    session,
    lane,
    inventoryForcedSection,
    setInventoryForcedSection,
    customerSelectedType,
    waitlistDesiredTier,
    waitlistBackupType,
    handleInventorySelect,
    setSelectedInventoryItem,
    selectedInventoryItem,
    currentSessionId,
    setInventoryHasLate,
    startCheckoutFromInventory,
    openCustomerAccount,
    inventoryRefreshNonce,
  } = useEmployeeRegisterState();

  if (!session?.sessionToken) return null;

  return (
    <div className="er-home-panel er-home-panel--top er-home-panel--no-scroll cs-liquid-card er-main-panel-card">
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <InventoryDrawer
          lane={lane}
          sessionToken={session.sessionToken}
          forcedExpandedSection={inventoryForcedSection}
          onExpandedSectionChange={setInventoryForcedSection}
          customerSelectedType={customerSelectedType}
          waitlistDesiredTier={waitlistDesiredTier}
          waitlistBackupType={waitlistBackupType}
          onSelect={handleInventorySelect}
          onClearSelection={() => setSelectedInventoryItem(null)}
          selectedItem={selectedInventoryItem}
          sessionId={currentSessionId}
          disableSelection={false}
          onAlertSummaryChange={({ hasLate }) => setInventoryHasLate(hasLate)}
          onRequestCheckout={startCheckoutFromInventory}
          onOpenCustomerAccount={openCustomerAccount}
          externalRefreshNonce={inventoryRefreshNonce}
        />
      </div>
    </div>
  );
}
