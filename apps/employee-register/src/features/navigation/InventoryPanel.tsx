import { InventoryDrawer } from '../../components/inventory/InventoryDrawer';
import { useEmployeeRegisterState } from '../../app/state/useEmployeeRegisterState';
import { PanelShell } from '../../views/PanelShell';

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
    <PanelShell align="top" scroll="hidden">
      <div className="u-flex-1 u-min-h-0 u-overflow-hidden">
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
    </PanelShell>
  );
}
