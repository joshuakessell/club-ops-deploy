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
    laneSessionMode,
    renewalHours,
    ledgerLineItems,
    ledgerTotal,
    pastDueBlocked,
    handleDemoPayment,
    handleDemoSplitPayment,
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

  const ledgerItems = Array.isArray(ledgerLineItems)
    ? (ledgerLineItems as Array<{ description: string; amount: number }>)
    : [];
  const splitLineItemLabel = 'Card Payment';
  const paymentLineItems = Array.isArray(paymentQuote?.lineItems)
    ? (paymentQuote.lineItems as Array<{ description: string; amount: number }>)
    : [];
  const renewalLineItems = paymentLineItems.filter(
    (item) => item.description !== splitLineItemLabel
  );

  const formatPaymentAmount = (amount: number) => {
    const abs = Math.abs(amount);
    const sign = amount < 0 ? '-' : '';
    return `${sign}$${abs.toFixed(2)}`;
  };

  const renewalDetails =
    laneSessionMode === 'RENEWAL' && paymentQuote ? (
      <div className="er-renewal-ledger">
        <div className="er-renewal-ledger__section">
          <div className="er-renewal-ledger__label">Today&apos;s Ledger</div>
          {ledgerItems.length > 0 ? (
            <div className="er-renewal-ledger__items">
              {ledgerItems.map((item, idx) => (
                <div key={`${item.description}-${idx}`} className="er-renewal-ledger__row">
                  <span>{item.description}</span>
                  <span>${item.amount.toFixed(2)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="er-text-sm" style={{ color: '#94a3b8', fontWeight: 700 }}>
              No charges yet today.
            </div>
          )}
          {typeof ledgerTotal === 'number' ? (
            <div className="er-renewal-ledger__total">
              Ledger total: ${ledgerTotal.toFixed(2)}
            </div>
          ) : null}
        </div>

        <div className="er-renewal-ledger__section">
          <div className="er-renewal-ledger__label">
            Renewal Charges{renewalHours ? ` (${renewalHours} hours)` : ''}
          </div>
          <div className="er-renewal-ledger__items">
            {renewalLineItems.map((item, idx) => (
              <div key={`${item.description}-${idx}`} className="er-renewal-ledger__row">
                <span>{item.description}</span>
                <span>${item.amount.toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div className="er-renewal-ledger__total">
            Renewal total: ${paymentQuote.total.toFixed(2)}
          </div>
        </div>
      </div>
    ) : null;

  const paymentBreakdown =
    paymentLineItems.length > 0 ? (
      <div className="er-payment-breakdown">
        <div className="er-payment-breakdown__label">Payment breakdown</div>
        <div className="er-payment-breakdown__items">
          {paymentLineItems.map((item, idx) => (
            <div key={`${item.description}-${idx}`} className="er-payment-breakdown__row">
              <span>{item.description}</span>
              <span className="er-payment-breakdown__amount">
                {formatPaymentAmount(item.amount)}
              </span>
            </div>
          ))}
        </div>
      </div>
    ) : null;

  const modalDetails =
    renewalDetails || paymentBreakdown ? (
      <>
        {renewalDetails}
        {paymentBreakdown}
      </>
    ) : null;

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
            totalAmount={paymentQuote.total}
            details={modalDetails}
            isSubmitting={isSubmitting}
            focusLockEnabled={!showAddOnSaleModal && !showUpgradePaymentModal && !showPastDueModal}
            onConfirm={(choice) => {
              if (choice === 'CREDIT_SUCCESS') void handleDemoPayment('CREDIT_SUCCESS');
              if (choice === 'CASH_SUCCESS') void handleDemoPayment('CASH_SUCCESS');
              if (choice === 'CREDIT_DECLINE')
                void handleDemoPayment('CREDIT_DECLINE', 'Card declined');
            }}
            onSplitCardSuccess={(amount) => handleDemoSplitPayment(amount)}
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
