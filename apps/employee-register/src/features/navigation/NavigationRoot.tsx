import { CheckoutRequestsBanner } from '../../components/register/CheckoutRequestsBanner';
import { CheckoutVerificationModal } from '../../components/register/CheckoutVerificationModal';
import { useEmployeeRegisterState } from '../../app/state/useEmployeeRegisterState';
import { HomeTabs } from './HomeTabs';
import { ScanPanel } from './ScanPanel';
import { AccountPanel } from './AccountPanel';
import { SearchPanel } from './SearchPanel';
import { InventoryPanel } from './InventoryPanel';
import { UpgradesPanel } from './UpgradesPanel';
import { CheckoutPanel } from './CheckoutPanel';
import { RoomCleaningPanel } from './RoomCleaningPanel';
import { ManualEntryPanel } from './ManualEntryPanel';
import { RetailPanel } from './RetailPanel';

export function NavigationRoot() {
  const {
    homeTab,
    checkoutRequests,
    selectedCheckoutRequest,
    checkoutItemsConfirmed,
    checkoutFeePaid,
    isSubmitting,
    handleClaimCheckout,
    openCustomerAccount,
    handleConfirmItems,
    handleMarkFeePaid,
    handleCompleteCheckout,
    setSelectedCheckoutRequest,
    setCheckoutChecklist,
    setCheckoutItemsConfirmed,
    setCheckoutFeePaid,
  } = useEmployeeRegisterState();

  return (
    <>
      {checkoutRequests.size > 0 && !selectedCheckoutRequest && (
        <CheckoutRequestsBanner
          requests={Array.from(checkoutRequests.values())}
          onClaim={(id) => void handleClaimCheckout(id)}
          onOpenCustomerAccount={(customerId, label) => openCustomerAccount(customerId, label)}
        />
      )}

      {selectedCheckoutRequest && checkoutRequests.get(selectedCheckoutRequest) ? (
        <CheckoutVerificationModal
          request={checkoutRequests.get(selectedCheckoutRequest)!}
          isSubmitting={isSubmitting}
          checkoutItemsConfirmed={checkoutItemsConfirmed}
          checkoutFeePaid={checkoutFeePaid}
          onOpenCustomerAccount={(customerId, label) => openCustomerAccount(customerId, label)}
          onConfirmItems={() => void handleConfirmItems(selectedCheckoutRequest)}
          onMarkFeePaid={() => void handleMarkFeePaid(selectedCheckoutRequest)}
          onComplete={() => void handleCompleteCheckout(selectedCheckoutRequest)}
          onCancel={() => {
            setSelectedCheckoutRequest(null);
            setCheckoutChecklist({});
            setCheckoutItemsConfirmed(false);
            setCheckoutFeePaid(false);
          }}
        />
      ) : null}

      <main className="main">
        <section className="actions-panel">
          <div className="er-home-layout">
            <HomeTabs />
            <div className="er-home-content">
              {homeTab === 'scan' && <ScanPanel />}
              {homeTab === 'account' && <AccountPanel />}
              {homeTab === 'search' && <SearchPanel />}
              {homeTab === 'inventory' && <InventoryPanel />}
              {homeTab === 'upgrades' && <UpgradesPanel />}
              {homeTab === 'checkout' && <CheckoutPanel />}
              {homeTab === 'roomCleaning' && <RoomCleaningPanel />}
              {homeTab === 'firstTime' && <ManualEntryPanel />}
              {homeTab === 'retail' && <RetailPanel />}
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <p>Employee-facing tablet • Runs alongside Square POS</p>
      </footer>
    </>
  );
}
