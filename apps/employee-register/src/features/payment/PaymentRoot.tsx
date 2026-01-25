import { PastDuePaymentModal } from '../../components/register/modals/PastDuePaymentModal';
import { RequiredTenderOutcomeModal } from '../../components/register/modals/RequiredTenderOutcomeModal';
import { UpgradePaymentModal } from '../../components/register/modals/UpgradePaymentModal';
import { AddOnSaleModal } from '../../components/register/modals/AddOnSaleModal';
import { PaymentDeclineToast } from '../../components/register/toasts/PaymentDeclineToast';
import { useEmployeeRegisterState } from '../../app/state/useEmployeeRegisterState';

export function PaymentRoot() {
  const {
    pastDueBalance,
    showPastDueModal,
    setShowPastDueModal,
    handlePastDuePayment,
    pastDueLineItems,
    setShowManagerBypassModal,
    isSubmitting,
    upgradeContext,
    showUpgradePaymentModal,
    setShowUpgradePaymentModal,
    upgradeOriginalCharges,
    upgradeOriginalTotal,
    upgradeFee,
    upgradePaymentStatus,
    upgradePaymentIntentId,
    handleUpgradePaymentFlow,
    handleUpgradePaymentDecline,
    currentSessionId,
    customerName,
    selectionConfirmed,
    paymentQuote,
    paymentStatus,
    pastDueBlocked,
    handleDemoPayment,
    paymentDeclineError,
    setPaymentDeclineError,
    showAddOnSaleModal,
    openAddOnSaleModal,
    closeAddOnSaleModal,
    addOnCart,
    addAddOnItem,
    removeAddOnItem,
    handleAddOnSaleToCheckin,
  } = useEmployeeRegisterState();

  return (
    <>
      {pastDueBalance > 0 && (
        <PastDuePaymentModal
          isOpen={showPastDueModal}
          quote={{
            total: pastDueBalance,
            lineItems: pastDueLineItems,
            messages: [],
          }}
          onPayInSquare={(outcome, reason) => void handlePastDuePayment(outcome, reason)}
          onManagerBypass={() => {
            setShowPastDueModal(false);
            setShowManagerBypassModal(true);
          }}
          onClose={() => setShowPastDueModal(false)}
          isSubmitting={isSubmitting}
        />
      )}

      {upgradeContext && (
        <UpgradePaymentModal
          isOpen={showUpgradePaymentModal}
          onClose={() => setShowUpgradePaymentModal(false)}
          customerLabel={upgradeContext.customerLabel}
          newRoomNumber={upgradeContext.newRoomNumber}
          offeredRoomNumber={upgradeContext.offeredRoomNumber}
          originalCharges={upgradeOriginalCharges}
          originalTotal={upgradeOriginalTotal}
          upgradeFee={upgradeFee}
          paymentStatus={upgradePaymentStatus}
          isSubmitting={isSubmitting}
          canComplete={!!upgradePaymentIntentId}
          onPayCreditSuccess={() => void handleUpgradePaymentFlow('CREDIT')}
          onPayCashSuccess={() => void handleUpgradePaymentFlow('CASH')}
          onDecline={() => handleUpgradePaymentDecline('Credit declined')}
          onComplete={() => {
            if (upgradePaymentIntentId) {
              void handleUpgradePaymentFlow('CREDIT');
            }
          }}
        />
      )}

      {currentSessionId &&
        customerName &&
        selectionConfirmed &&
        paymentQuote &&
        paymentStatus === 'DUE' &&
        !pastDueBlocked && (
          <RequiredTenderOutcomeModal
            isOpen={true}
            totalLabel={`Total: $${paymentQuote.total.toFixed(2)}`}
            isSubmitting={isSubmitting}
            onConfirm={(choice) => {
              if (choice === 'CREDIT_SUCCESS') void handleDemoPayment('CREDIT_SUCCESS');
              if (choice === 'CASH_SUCCESS') void handleDemoPayment('CASH_SUCCESS');
              if (choice === 'CREDIT_DECLINE')
                void handleDemoPayment('CREDIT_DECLINE', 'Card declined');
            }}
            extraActionLabel="Add On Sale"
            onExtraAction={() => openAddOnSaleModal()}
          />
        )}

      <AddOnSaleModal
        isOpen={showAddOnSaleModal}
        cart={addOnCart}
        onAddItem={addAddOnItem}
        onRemoveItem={removeAddOnItem}
        onAddToCheckin={() => void handleAddOnSaleToCheckin()}
        onClose={closeAddOnSaleModal}
        isSubmitting={isSubmitting}
      />

      <PaymentDeclineToast
        message={paymentDeclineError}
        onDismiss={() => setPaymentDeclineError(null)}
      />
    </>
  );
}
