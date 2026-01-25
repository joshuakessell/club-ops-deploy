import { UpgradesDrawerContent } from '../../components/upgrades/UpgradesDrawerContent';
import { useEmployeeRegisterState } from '../../app/state/useEmployeeRegisterState';

export function UpgradesPanel() {
  const {
    waitlistEntries,
    hasEligibleEntries,
    isEntryOfferEligible,
    openOfferUpgradeModal,
    selectHomeTab,
    resetUpgradeState,
    setSelectedWaitlistEntry,
    handleStartUpgradePayment,
    openCustomerAccount,
    isSubmitting,
  } = useEmployeeRegisterState();

  return (
    <div className="er-home-panel er-home-panel--top er-home-panel--no-scroll">
      <UpgradesDrawerContent
        waitlistEntries={waitlistEntries}
        hasEligibleEntries={hasEligibleEntries}
        isEntryOfferEligible={(entryId, status, desiredTier) => {
          const entry = waitlistEntries.find(
            (e: { id: string; status: string; desiredTier: string }) => e.id === entryId
          );
          if (!entry) return false;
          if (entry.status !== status) return false;
          if (entry.desiredTier !== desiredTier) return false;
          return isEntryOfferEligible(entry);
        }}
        onOffer={(entryId) => {
          const entry = waitlistEntries.find((e: { id: string }) => e.id === entryId);
          if (!entry) return;
          openOfferUpgradeModal(entry);
          selectHomeTab('upgrades');
        }}
        onStartPayment={(entry) => {
          resetUpgradeState();
          setSelectedWaitlistEntry(entry.id);
          void handleStartUpgradePayment(entry);
        }}
        onCancelOffer={(entryId) => {
          alert(`Cancel offer not implemented yet (waitlistId=${entryId}).`);
        }}
        onOpenCustomerAccount={openCustomerAccount}
        isSubmitting={isSubmitting}
      />
    </div>
  );
}
