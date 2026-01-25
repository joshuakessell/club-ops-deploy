import { useEmployeeRegisterViewModel } from '../../app/hooks/useEmployeeRegisterViewModel';
import { RegisterSignIn } from '../../RegisterSignIn';
import { OfferUpgradeModal } from '../../components/OfferUpgradeModal';
import { CheckoutRequestsBanner } from '../../components/register/CheckoutRequestsBanner';
import { CheckoutVerificationModal } from '../../components/register/CheckoutVerificationModal';
import { RequiredTenderOutcomeModal } from '../../components/register/modals/RequiredTenderOutcomeModal';
import { WaitlistNoticeModal } from '../../components/register/modals/WaitlistNoticeModal';
import { CustomerConfirmationPendingModal } from '../../components/register/modals/CustomerConfirmationPendingModal';
import { PastDuePaymentModal } from '../../components/register/modals/PastDuePaymentModal';
import { ManagerBypassModal } from '../../components/register/modals/ManagerBypassModal';
import { UpgradePaymentModal } from '../../components/register/modals/UpgradePaymentModal';
import { AddNoteModal } from '../../components/register/modals/AddNoteModal';
import { MembershipIdPromptModal } from '../../components/register/modals/MembershipIdPromptModal';
import { ModalFrame } from '../../components/register/modals/ModalFrame';
import { TransactionCompleteModal } from '../../components/register/modals/TransactionCompleteModal';
import { MultipleMatchesModal } from '../../components/register/modals/MultipleMatchesModal';
import { PaymentDeclineToast } from '../../components/register/toasts/PaymentDeclineToast';
import { SuccessToast } from '../../components/register/toasts/SuccessToast';
import { BottomToastStack } from '../../components/register/toasts/BottomToastStack';
import { ManualCheckoutPanel } from '../../components/register/panels/ManualCheckoutPanel';
import { RoomCleaningPanel } from '../../components/register/panels/RoomCleaningPanel';
import { CustomerProfileCard } from '../../components/register/CustomerProfileCard';
import { EmployeeAssistPanel } from '../../components/register/EmployeeAssistPanel';
import { CustomerAccountPanel } from '../../components/register/panels/CustomerAccountPanel';
import { UpgradesDrawerContent } from '../../components/upgrades/UpgradesDrawerContent';
import { InventoryDrawer } from '../../components/inventory/InventoryDrawer';
import { extractDobDigits, formatDobMmDdYyyy } from '../../utils/dob';

export function EmployeeRegisterFeatureRoot() {
  const {
    deviceId,
    handleRegisterSignIn,
    lane,
    health,
    wsConnected,
    handleLogout,
    handleCloseOut,
    registerSession,
    session,
    scanOverlayMounted,
    scanOverlayActive,
    scanToastMessage,
    setScanToastMessage,
    checkoutRequests,
    selectedCheckoutRequest,
    checkoutItemsConfirmed,
    checkoutFeePaid,
    handleClaimCheckout,
    openCustomerAccount,
    handleConfirmItems,
    handleMarkFeePaid,
    handleCompleteCheckout,
    setSelectedCheckoutRequest,
    setCheckoutChecklist,
    setCheckoutItemsConfirmed,
    setCheckoutFeePaid,
    homeTab,
    selectHomeTab,
    inventoryHasLate,
    setInventoryHasLate,
    hasEligibleEntries,
    isEntryOfferEligible,
    dismissUpgradePulse,
    startCheckoutFromHome,
    startCheckoutFromInventory,
    startCheckoutFromCustomerAccount,
    exitCheckout,
    accountCustomerId,
    accountCustomerLabel,
    laneSession,
    laneSessionActions,
    currentSessionId,
    customerName,
    membershipNumber,
    customerMembershipValidUntil,
    membershipPurchaseIntent,
    membershipChoice,
    allowedRentals,
    proposedRentalType,
    proposedBy,
    selectionConfirmed,
    customerPrimaryLanguage,
    customerDobMonthDay,
    customerLastVisitAt,
    checkinStage,
    customerNotes,
    customerSelectedType,
    waitlistDesiredTier,
    waitlistBackupType,
    inventoryAvailable,
    assignedResourceType,
    assignedResourceNumber,
    checkoutAt,
    setCheckoutAt,
    agreementSigned,
    agreementBypassPending,
    agreementSignedMethod,
    paymentIntentId,
    paymentQuote,
    paymentStatus,
    paymentDeclineError,
    pastDueBlocked,
    pastDueBalance,
    isSubmitting,
    highlightKioskOption,
    handleConfirmLanguage,
    handleConfirmMembershipOneTime,
    handleConfirmMembershipSixMonth,
    handleProposeSelection,
    handleCustomerSelectRental,
    handleSelectWaitlistBackupAsCustomer,
    handleConfirmSelection,
    handleClearSession,
    handleInventorySelect,
    startLaneSessionByCustomerId,
    handleManualSubmit,
    setManualEntry,
    manualFirstName,
    setManualFirstName,
    manualLastName,
    setManualLastName,
    manualDobDigits,
    setManualDobDigits,
    manualDobIso,
    manualIdNumber,
    setManualIdNumber,
    manualEntrySubmitting,
    manualExistingPrompt,
    manualExistingPromptError,
    manualExistingPromptSubmitting,
    setManualExistingPrompt,
    setManualExistingPromptError,
    setManualExistingPromptSubmitting,
    customerSearch,
    setCustomerSearch,
    customerSearchLoading,
    customerSuggestions,
    setCustomerSuggestions,
    inventoryForcedSection,
    setInventoryForcedSection,
    selectedInventoryItem,
    setSelectedInventoryItem,
    inventoryRefreshNonce,
    setInventoryRefreshNonce,
    waitlistEntries,
    showWaitlistModal,
    setShowWaitlistModal,
    offerUpgradeModal,
    setOfferUpgradeModal,
    openOfferUpgradeModal,
    resetUpgradeState,
    setSelectedWaitlistEntry,
    handleStartUpgradePayment,
    refreshWaitlistAndInventory,
    checkoutEntryMode,
    checkoutPrefill,
    checkoutReturnToTabRef,
    showCustomerConfirmationPending,
    customerConfirmationType,
    setShowCustomerConfirmationPending,
    setCustomerConfirmationType,
    pendingScanResolution,
    scanResolutionError,
    scanResolutionSubmitting,
    setPendingScanResolution,
    setScanResolutionError,
    resolvePendingScanSelection,
    showCreateFromScanPrompt,
    pendingCreateFromScan,
    createFromScanError,
    createFromScanSubmitting,
    setShowCreateFromScanPrompt,
    setPendingCreateFromScan,
    setCreateFromScanError,
    setCreateFromScanSubmitting,
    handleCreateFromNoMatch,
    showPastDueModal,
    setShowPastDueModal,
    handlePastDuePayment,
    pastDueLineItems,
    showManagerBypassModal,
    setShowManagerBypassModal,
    managerList,
    managerId,
    managerPin,
    setManagerId,
    setManagerPin,
    handleManagerBypass,
    showMembershipIdPrompt,
    membershipIdMode,
    membershipIdInput,
    membershipIdError,
    membershipIdSubmitting,
    setMembershipIdMode,
    setMembershipIdInput,
    setMembershipIdError,
    handleCompleteMembershipPurchase,
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
    showAddNoteModal,
    setShowAddNoteModal,
    newNoteText,
    setNewNoteText,
    handleAddNote,
    successToastMessage,
    setSuccessToastMessage,
    bottomToasts,
    dismissBottomToast,
    setPaymentDeclineError,
    assignedLabel,
    currentSessionIdRef,
    documentsModalOpen,
    setDocumentsModalOpen,
    documentsLoading,
    documentsError,
    documentsForSession,
    setDocumentsError,
    fetchDocumentsBySession,
    downloadAgreementPdf,
    handleStartAgreementBypass,
    handleConfirmPhysicalAgreement,
    handleCompleteTransaction,
    handleDemoPayment,
  } = useEmployeeRegisterViewModel();

  return (
    <RegisterSignIn
      deviceId={deviceId}
      onSignedIn={handleRegisterSignIn}
      topTitle="Employee Register"
      lane={lane}
      apiStatus={health?.status ?? null}
      wsConnected={wsConnected}
      onSignOut={() => void handleLogout()}
      onCloseOut={() => void handleCloseOut()}
    >
      {!registerSession ? (
        <div />
      ) : !session ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#fff' }}>Loading...</div>
      ) : (
        <div className="container">
          {scanOverlayMounted && (
            <div
              className={[
                'er-scan-processing-overlay',
                scanOverlayActive ? 'er-scan-processing-overlay--active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-hidden="true"
            >
              <div className="er-scan-processing-card cs-liquid-card">
                <span className="er-spinner" aria-hidden="true" />
                <span className="er-scan-processing-text">Processing scan…</span>
              </div>
            </div>
          )}

          {/* Checkout Request Notifications */}
          {checkoutRequests.size > 0 && !selectedCheckoutRequest && (
            <CheckoutRequestsBanner
              requests={Array.from(checkoutRequests.values())}
              onClaim={(id) => void handleClaimCheckout(id)}
              onOpenCustomerAccount={(customerId, label) => openCustomerAccount(customerId, label)}
            />
          )}

          {/* Checkout Verification Screen */}
          {selectedCheckoutRequest &&
            (() => {
              const request = checkoutRequests.get(selectedCheckoutRequest);
              if (!request) return null;
              return (
                <CheckoutVerificationModal
                  request={request}
                  isSubmitting={isSubmitting}
                  checkoutItemsConfirmed={checkoutItemsConfirmed}
                  checkoutFeePaid={checkoutFeePaid}
                  onOpenCustomerAccount={(customerId, label) =>
                    openCustomerAccount(customerId, label)
                  }
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
              );
            })()}

          <main className="main">
            {/* Customer Account embeds the check-in UI (lane session driven). */}

            <section className="actions-panel">
              <div className="er-home-layout">
                <nav className="er-home-tabs" aria-label="Home actions">
                  <button
                    type="button"
                    className={[
                      'er-home-tab-btn',
                      'cs-liquid-button',
                      homeTab === 'account'
                        ? 'cs-liquid-button--selected'
                        : 'cs-liquid-button--secondary',
                    ].join(' ')}
                    onClick={() => selectHomeTab('account')}
                  >
                    Customer Account
                  </button>
                  <button
                    type="button"
                    className={[
                      'er-home-tab-btn',
                      'cs-liquid-button',
                      homeTab === 'scan'
                        ? 'cs-liquid-button--selected'
                        : 'cs-liquid-button--secondary',
                    ].join(' ')}
                    onClick={() => selectHomeTab('scan')}
                  >
                    Scan
                  </button>
                  <button
                    type="button"
                    className={[
                      'er-home-tab-btn',
                      'cs-liquid-button',
                      homeTab === 'search'
                        ? 'cs-liquid-button--selected'
                        : 'cs-liquid-button--secondary',
                    ].join(' ')}
                    onClick={() => selectHomeTab('search')}
                  >
                    Search Customer
                  </button>
                  <button
                    type="button"
                    className={[
                      'er-home-tab-btn',
                      'cs-liquid-button',
                      homeTab === 'firstTime'
                        ? 'cs-liquid-button--selected'
                        : 'cs-liquid-button--secondary',
                    ].join(' ')}
                    onClick={() => selectHomeTab('firstTime')}
                  >
                    Manual Entry
                  </button>
                  <button
                    type="button"
                    className={[
                      'er-home-tab-btn',
                      'cs-liquid-button',
                      homeTab === 'inventory'
                        ? 'cs-liquid-button--selected'
                        : inventoryHasLate
                          ? 'cs-liquid-button--danger'
                          : 'cs-liquid-button--secondary',
                    ].join(' ')}
                    onClick={() => selectHomeTab('inventory')}
                  >
                    Rentals
                  </button>
                  <button
                    type="button"
                    className={[
                      'er-home-tab-btn',
                      'cs-liquid-button',
                      homeTab === 'upgrades'
                        ? 'cs-liquid-button--selected'
                        : hasEligibleEntries
                          ? 'cs-liquid-button--success'
                          : 'cs-liquid-button--secondary',
                    ].join(' ')}
                    onClick={() => {
                      dismissUpgradePulse();
                      selectHomeTab('upgrades');
                    }}
                  >
                    Upgrades
                  </button>
                  <button
                    type="button"
                    className={[
                      'er-home-tab-btn',
                      'cs-liquid-button',
                      'er-home-tab-btn--checkout',
                      homeTab === 'checkout'
                        ? 'cs-liquid-button--selected'
                        : 'cs-liquid-button--secondary',
                    ].join(' ')}
                    onClick={() => startCheckoutFromHome()}
                  >
                    Checkout
                  </button>
                  <button
                    type="button"
                    className={[
                      'er-home-tab-btn',
                      'cs-liquid-button',
                      homeTab === 'roomCleaning'
                        ? 'cs-liquid-button--selected'
                        : 'cs-liquid-button--secondary',
                    ].join(' ')}
                    onClick={() => selectHomeTab('roomCleaning')}
                  >
                    Room Cleaning
                  </button>
                </nav>

                <div className="er-home-content">
                  {homeTab === 'scan' && (
                    <div className="er-home-panel er-home-panel--center cs-liquid-card er-main-panel-card">
                      <div style={{ fontSize: '4rem', lineHeight: 1 }} aria-hidden="true">
                        📷
                      </div>
                      <div className="er-card-title" style={{ marginTop: '0.75rem' }}>
                        Scan Now
                      </div>
                      <div className="er-card-subtitle" style={{ marginTop: '0.5rem' }}>
                        Scan a membership ID or driver license.
                      </div>
                      {currentSessionId && customerName ? (
                        <div style={{ marginTop: '1rem', display: 'grid', gap: '0.5rem' }}>
                          <div className="er-text-sm" style={{ color: '#94a3b8', fontWeight: 800 }}>
                            Active lane session:{' '}
                            <span style={{ color: '#e2e8f0' }}>{customerName}</span>
                          </div>
                          <button
                            type="button"
                            className="cs-liquid-button"
                            onClick={() => selectHomeTab('account')}
                            style={{ width: '100%', padding: '0.75rem', fontWeight: 900 }}
                          >
                            Open Customer Account
                          </button>
                        </div>
                      ) : null}
                    </div>
                  )}

                  {homeTab === 'account' &&
                    (accountCustomerId ? (
                      <CustomerAccountPanel
                        lane={lane}
                        sessionToken={session?.sessionToken}
                        customerId={accountCustomerId}
                        customerLabel={accountCustomerLabel}
                        onStartCheckout={startCheckoutFromCustomerAccount}
                        onClearSession={() =>
                          void handleClearSession().then(() => selectHomeTab('scan'))
                        }
                        currentSessionId={currentSessionId}
                        currentSessionCustomerId={laneSession.customerId}
                        customerName={customerName}
                        membershipNumber={membershipNumber}
                        customerMembershipValidUntil={customerMembershipValidUntil}
                        membershipPurchaseIntent={membershipPurchaseIntent}
                        membershipChoice={membershipChoice}
                        allowedRentals={allowedRentals}
                        proposedRentalType={proposedRentalType}
                        proposedBy={proposedBy}
                        selectionConfirmed={selectionConfirmed}
                        customerPrimaryLanguage={customerPrimaryLanguage}
                        customerDobMonthDay={customerDobMonthDay}
                        customerLastVisitAt={customerLastVisitAt}
                        hasEncryptedLookupMarker={Boolean(
                          laneSession.customerHasEncryptedLookupMarker
                        )}
                        waitlistDesiredTier={waitlistDesiredTier}
                        waitlistBackupType={waitlistBackupType}
                        inventoryAvailable={
                          inventoryAvailable
                            ? {
                                rooms: inventoryAvailable.rooms,
                                lockers: inventoryAvailable.lockers,
                              }
                            : null
                        }
                        isSubmitting={isSubmitting}
                        checkinStage={checkinStage}
                        onStartedSession={(data) => {
                          setCurrentSessionCustomerId(accountCustomerId);
                          if (data.customerName) setCustomerName(data.customerName);
                          if (data.membershipNumber) setMembershipNumber(data.membershipNumber);
                          if (data.sessionId) setCurrentSessionId(data.sessionId);
                          if (data.customerHasEncryptedLookupMarker !== undefined) {
                            laneSessionActions.patch({
                              customerHasEncryptedLookupMarker: Boolean(
                                data.customerHasEncryptedLookupMarker
                              ),
                            });
                          }
                          if (data.mode === 'RENEWAL' && typeof data.blockEndsAt === 'string') {
                            if (data.activeAssignedResourceType)
                              setAssignedResourceType(data.activeAssignedResourceType);
                            if (data.activeAssignedResourceNumber)
                              setAssignedResourceNumber(data.activeAssignedResourceNumber);
                            setCheckoutAt(data.blockEndsAt);
                          }
                        }}
                        onHighlightLanguage={(lang) =>
                          void highlightKioskOption({ step: 'LANGUAGE', option: lang })
                        }
                        onConfirmLanguage={(lang) => void handleConfirmLanguage(lang)}
                        onHighlightMembership={(choice) =>
                          void highlightKioskOption({ step: 'MEMBERSHIP', option: choice })
                        }
                        onConfirmMembershipOneTime={() => void handleConfirmMembershipOneTime()}
                        onConfirmMembershipSixMonth={() => void handleConfirmMembershipSixMonth()}
                        onHighlightRental={(rental) => void handleProposeSelection(rental)}
                        onSelectRentalAsCustomer={(rental) =>
                          void handleCustomerSelectRental(rental)
                        }
                        onHighlightWaitlistBackup={(rental) =>
                          void highlightKioskOption({ step: 'WAITLIST_BACKUP', option: rental })
                        }
                        onSelectWaitlistBackupAsCustomer={(rental) =>
                          void handleSelectWaitlistBackupAsCustomer(rental)
                        }
                        onApproveRental={() => void handleConfirmSelection()}
                      />
                    ) : currentSessionId && customerName ? (
                      <div className="er-home-panel er-home-panel--top er-home-panel--no-scroll cs-liquid-card er-main-panel-card">
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.75rem',
                            minHeight: 0,
                          }}
                        >
                          <div className="er-card-title">Customer Account</div>
                          <CustomerProfileCard
                            name={customerName}
                            preferredLanguage={customerPrimaryLanguage || null}
                            dobMonthDay={customerDobMonthDay || null}
                            membershipNumber={membershipNumber || null}
                            membershipValidUntil={customerMembershipValidUntil || null}
                            lastVisitAt={customerLastVisitAt || null}
                            hasEncryptedLookupMarker={Boolean(
                              laneSession.customerHasEncryptedLookupMarker
                            )}
                            checkinStage={checkinStage}
                            waitlistDesiredTier={waitlistDesiredTier}
                            waitlistBackupType={waitlistBackupType}
                            footer={
                              checkinStage ? (
                                <button
                                  type="button"
                                  className="cs-liquid-button cs-liquid-button--danger"
                                  onClick={() =>
                                    void handleClearSession().then(() => selectHomeTab('scan'))
                                  }
                                  style={{
                                    width: '100%',
                                    maxWidth: 320,
                                    padding: '0.7rem',
                                    fontWeight: 900,
                                  }}
                                >
                                  Clear Session
                                </button>
                              ) : null
                            }
                          />
                          <EmployeeAssistPanel
                            sessionId={currentSessionId}
                            customerName={customerName}
                            customerPrimaryLanguage={customerPrimaryLanguage}
                            membershipNumber={membershipNumber || null}
                            customerMembershipValidUntil={customerMembershipValidUntil}
                            membershipPurchaseIntent={membershipPurchaseIntent}
                            membershipChoice={membershipChoice}
                            allowedRentals={allowedRentals}
                            proposedRentalType={proposedRentalType}
                            proposedBy={proposedBy}
                            selectionConfirmed={selectionConfirmed}
                            waitlistDesiredTier={waitlistDesiredTier}
                            waitlistBackupType={waitlistBackupType}
                            inventoryAvailable={
                              inventoryAvailable
                                ? {
                                    rooms: inventoryAvailable.rooms,
                                    lockers: inventoryAvailable.lockers,
                                  }
                                : null
                            }
                            isSubmitting={isSubmitting}
                            onHighlightLanguage={(lang) =>
                              void highlightKioskOption({ step: 'LANGUAGE', option: lang })
                            }
                            onConfirmLanguage={(lang) => void handleConfirmLanguage(lang)}
                            onHighlightMembership={(choice) =>
                              void highlightKioskOption({ step: 'MEMBERSHIP', option: choice })
                            }
                            onConfirmMembershipOneTime={() => void handleConfirmMembershipOneTime()}
                            onConfirmMembershipSixMonth={() =>
                              void handleConfirmMembershipSixMonth()
                            }
                            onHighlightRental={(rental) => void handleProposeSelection(rental)}
                            onSelectRentalAsCustomer={(rental) =>
                              void handleCustomerSelectRental(rental)
                            }
                            onHighlightWaitlistBackup={(rental) =>
                              void highlightKioskOption({ step: 'WAITLIST_BACKUP', option: rental })
                            }
                            onSelectWaitlistBackupAsCustomer={(rental) =>
                              void handleSelectWaitlistBackupAsCustomer(rental)
                            }
                            onApproveRental={() => void handleConfirmSelection()}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="er-home-panel er-home-panel--center cs-liquid-card er-main-panel-card">
                        <div className="er-card-title">Customer Account</div>
                        <div className="er-card-subtitle" style={{ marginTop: '0.5rem' }}>
                          Select a customer (scan, search, or first-time) to view their account.
                        </div>
                      </div>
                    ))}

                  {homeTab === 'search' && (
                    <div
                      className="er-home-panel er-home-panel--top typeahead-section cs-liquid-card er-main-panel-card"
                      style={{ marginTop: 0 }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          gap: '0.5rem',
                          alignItems: 'center',
                          marginBottom: '0.5rem',
                          flexWrap: 'wrap',
                        }}
                      >
                        <label htmlFor="customer-search" className="er-card-title">
                          Search Customer
                        </label>
                        <span className="er-card-subtitle">(type at least 3 letters)</span>
                      </div>
                      <input
                        id="customer-search"
                        type="text"
                        className="cs-liquid-input"
                        value={customerSearch}
                        onChange={(e) => setCustomerSearch(e.target.value)}
                        placeholder="Start typing name..."
                        disabled={isSubmitting}
                      />
                      {customerSearchLoading && (
                        <div
                          className="er-text-sm"
                          style={{ marginTop: '0.25rem', color: '#94a3b8' }}
                        >
                          Searching...
                        </div>
                      )}
                      {customerSuggestions.length > 0 && (
                        <div
                          className="cs-liquid-card"
                          style={{
                            marginTop: '0.5rem',
                            maxHeight: '180px',
                            overflowY: 'auto',
                          }}
                        >
                          {customerSuggestions.map((s) => {
                            const label = `${s.lastName}, ${s.firstName}`;
                            return (
                              <button
                                key={s.id}
                                type="button"
                                className="cs-liquid-button cs-liquid-button--secondary"
                                onClick={() => {
                                  // Direct navigation: selecting a customer name anywhere should open Customer Account.
                                  openCustomerAccount(s.id, label);
                                  setCustomerSearch('');
                                  setCustomerSuggestions([]);
                                }}
                                style={{
                                  padding: '0.5rem 0.75rem',
                                  width: '100%',
                                  textAlign: 'left',
                                  borderRadius: 0,
                                  border: 'none',
                                  borderBottom: '1px solid #1f2937',
                                  justifyContent: 'space-between',
                                }}
                              >
                                <div style={{ fontWeight: 600 }}>{label}</div>
                                <div
                                  className="er-text-sm"
                                  style={{
                                    color: '#94a3b8',
                                    display: 'flex',
                                    gap: '0.75rem',
                                    flexWrap: 'wrap',
                                  }}
                                >
                                  {s.dobMonthDay && <span>DOB: {s.dobMonthDay}</span>}
                                  {s.membershipNumber && (
                                    <span>Membership: {s.membershipNumber}</span>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {homeTab === 'inventory' && session?.sessionToken && (
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
                  )}

                  {homeTab === 'upgrades' && (
                    <div className="er-home-panel er-home-panel--top er-home-panel--no-scroll">
                      <UpgradesDrawerContent
                        waitlistEntries={waitlistEntries}
                        hasEligibleEntries={hasEligibleEntries}
                        isEntryOfferEligible={(entryId, status, desiredTier) => {
                          const entry = waitlistEntries.find((e) => e.id === entryId);
                          if (!entry) return false;
                          if (entry.status !== status) return false;
                          if (entry.desiredTier !== desiredTier) return false;
                          return isEntryOfferEligible(entry);
                        }}
                        onOffer={(entryId) => {
                          const entry = waitlistEntries.find((e) => e.id === entryId);
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
                  )}

                  {homeTab === 'checkout' && session?.sessionToken && (
                    <div className="er-home-panel er-home-panel--top er-home-panel--no-scroll">
                      <ManualCheckoutPanel
                        sessionToken={session.sessionToken}
                        entryMode={checkoutEntryMode}
                        prefill={checkoutPrefill ?? undefined}
                        onExit={exitCheckout}
                        onSuccess={(message) => {
                          setSuccessToastMessage(message);
                          if (checkoutReturnToTabRef.current) {
                            setInventoryRefreshNonce((prev) => prev + 1);
                            exitCheckout();
                          }
                        }}
                      />
                    </div>
                  )}

                  {homeTab === 'roomCleaning' && session?.sessionToken && session?.staffId && (
                    <div className="er-home-panel er-home-panel--top er-home-panel--no-scroll">
                      <RoomCleaningPanel
                        sessionToken={session.sessionToken}
                        staffId={session.staffId}
                        onSuccess={(message) => setSuccessToastMessage(message)}
                      />
                    </div>
                  )}

                  {homeTab === 'firstTime' && (
                    <form
                      className="er-home-panel er-home-panel--top manual-entry-form cs-liquid-card er-main-panel-card"
                      onSubmit={(e) => void handleManualSubmit(e)}
                    >
                      <div className="er-card-title" style={{ marginBottom: '0.75rem' }}>
                        First Time Customer
                      </div>
                      <div className="er-card-subtitle" style={{ marginBottom: '0.75rem' }}>
                        Enter customer details from alternate ID.
                      </div>
                      <div className="form-group">
                        <label htmlFor="manualFirstName">First Name *</label>
                        <input
                          id="manualFirstName"
                          type="text"
                          className="cs-liquid-input"
                          value={manualFirstName}
                          onChange={(e) => setManualFirstName(e.target.value)}
                          placeholder="Enter first name"
                          disabled={isSubmitting}
                          required
                        />
                      </div>
                      <div className="form-group">
                        <label htmlFor="manualLastName">Last Name *</label>
                        <input
                          id="manualLastName"
                          type="text"
                          className="cs-liquid-input"
                          value={manualLastName}
                          onChange={(e) => setManualLastName(e.target.value)}
                          placeholder="Enter last name"
                          disabled={isSubmitting}
                          required
                        />
                      </div>
                      <div className="form-group">
                        <label htmlFor="manualDob">Date of Birth *</label>
                        <input
                          id="manualDob"
                          type="text"
                          inputMode="numeric"
                          className="cs-liquid-input"
                          value={formatDobMmDdYyyy(manualDobDigits)}
                          onChange={(e) => setManualDobDigits(extractDobDigits(e.target.value))}
                          placeholder="MM/DD/YYYY"
                          disabled={isSubmitting}
                          required
                        />
                      </div>
                      <div className="form-group">
                        <label htmlFor="manualIdNumber">License / ID Number</label>
                        <input
                          id="manualIdNumber"
                          type="text"
                          className="cs-liquid-input"
                          value={manualIdNumber}
                          onChange={(e) => setManualIdNumber(e.target.value)}
                          placeholder="Enter license or ID number"
                          disabled={isSubmitting}
                        />
                      </div>
                      <div className="form-actions">
                        <button
                          type="submit"
                          className="submit-btn cs-liquid-button"
                          disabled={
                            isSubmitting ||
                            manualEntrySubmitting ||
                            !manualFirstName.trim() ||
                            !manualLastName.trim() ||
                            !manualDobIso
                          }
                        >
                          {isSubmitting || manualEntrySubmitting ? 'Submitting...' : 'Add Customer'}
                        </button>
                        <button
                          type="button"
                          className="cancel-btn cs-liquid-button cs-liquid-button--danger"
                          onClick={() => {
                            setManualEntry(false);
                            setManualFirstName('');
                            setManualLastName('');
                            setManualDobDigits('');
                            setManualIdNumber('');
                            selectHomeTab('scan');
                          }}
                          disabled={isSubmitting || manualEntrySubmitting}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              </div>
            </section>
          </main>

          <footer className="footer">
            <p>Employee-facing tablet • Runs alongside Square POS</p>
          </footer>

          <WaitlistNoticeModal
            isOpen={showWaitlistModal && !!waitlistDesiredTier && !!waitlistBackupType}
            desiredTier={waitlistDesiredTier || ''}
            backupType={waitlistBackupType || ''}
            onClose={() => setShowWaitlistModal(false)}
          />

          {offerUpgradeModal && session?.sessionToken && (
            <OfferUpgradeModal
              isOpen={true}
              onClose={() => setOfferUpgradeModal(null)}
              sessionToken={session.sessionToken}
              waitlistId={offerUpgradeModal.waitlistId}
              desiredTier={offerUpgradeModal.desiredTier}
              customerLabel={offerUpgradeModal.customerLabel}
              heldRoom={offerUpgradeModal.heldRoom ?? null}
              onOffered={refreshWaitlistAndInventory}
            />
          )}

          <CustomerConfirmationPendingModal
            isOpen={showCustomerConfirmationPending && !!customerConfirmationType}
            data={customerConfirmationType || { requested: '', selected: '', number: '' }}
            onCancel={
              customerConfirmationType
                ? () => {
                    setShowCustomerConfirmationPending(false);
                    setCustomerConfirmationType(null);
                    setSelectedInventoryItem(null);
                  }
                : undefined
            }
          />

          <MultipleMatchesModal
            isOpen={!!pendingScanResolution}
            candidates={pendingScanResolution?.candidates || []}
            errorMessage={scanResolutionError}
            isSubmitting={scanResolutionSubmitting}
            onCancel={() => {
              setPendingScanResolution(null);
              setScanResolutionError(null);
            }}
            onSelect={(customerId) => void resolvePendingScanSelection(customerId)}
          />

          <ModalFrame
            isOpen={!!manualExistingPrompt}
            title="Existing customer found"
            onClose={() => {
              setManualExistingPrompt(null);
              setManualExistingPromptError(null);
              setManualExistingPromptSubmitting(false);
            }}
            maxWidth="640px"
            closeOnOverlayClick={false}
          >
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              <div style={{ color: '#94a3b8' }}>
                An existing customer already matches this First Name, Last Name, and Date of Birth.
                Do you want to continue?
              </div>

              {manualExistingPrompt?.matchCount && manualExistingPrompt.matchCount > 1 ? (
                <div style={{ color: '#f59e0b', fontWeight: 800 }}>
                  {manualExistingPrompt.matchCount} matching customers found. Showing best match:
                </div>
              ) : null}

              {manualExistingPrompt ? (
                <div className="cs-liquid-card" style={{ padding: '1rem' }}>
                  <div style={{ fontWeight: 900, fontSize: '1.1rem' }}>
                    {manualExistingPrompt.bestMatch.name}
                  </div>
                  <div
                    style={{
                      marginTop: '0.25rem',
                      color: '#94a3b8',
                      display: 'flex',
                      gap: '0.75rem',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span>
                      DOB:{' '}
                      <strong style={{ color: 'white' }}>
                        {manualExistingPrompt.bestMatch.dob || manualExistingPrompt.dobIso}
                      </strong>
                    </span>
                    {manualExistingPrompt.bestMatch.membershipNumber ? (
                      <span>
                        Membership:{' '}
                        <strong style={{ color: 'white' }}>
                          {manualExistingPrompt.bestMatch.membershipNumber}
                        </strong>
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {manualExistingPromptError ? (
                <div
                  style={{
                    padding: '0.75rem',
                    background: 'rgba(239, 68, 68, 0.18)',
                    border: '1px solid rgba(239, 68, 68, 0.35)',
                    borderRadius: 12,
                    color: '#fecaca',
                    fontWeight: 800,
                  }}
                >
                  {manualExistingPromptError}
                </div>
              ) : null}

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '0.5rem',
                  flexWrap: 'wrap',
                }}
              >
                <button
                  type="button"
                  className="cs-liquid-button cs-liquid-button--secondary"
                  disabled={manualExistingPromptSubmitting || isSubmitting}
                  onClick={() => {
                    setManualExistingPrompt(null);
                    setManualExistingPromptError(null);
                  }}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  className="cs-liquid-button cs-liquid-button--secondary"
                  disabled={manualExistingPromptSubmitting || isSubmitting || !manualExistingPrompt}
                  onClick={() => {
                    if (!manualExistingPrompt) return;
                    void (async () => {
                      setManualExistingPromptSubmitting(true);
                      setManualExistingPromptError(null);
                      try {
                        const result = await startLaneSessionByCustomerId(
                          manualExistingPrompt.bestMatch.id,
                          {
                            suppressAlerts: true,
                          }
                        );
                        if (result.outcome === 'matched') {
                          setManualExistingPrompt(null);
                          setManualEntry(false);
                          setManualFirstName('');
                          setManualLastName('');
                          setManualDobDigits('');
                          setManualIdNumber('');
                        }
                      } catch (err) {
                        setManualExistingPromptError(
                          err instanceof Error ? err.message : 'Failed to load existing customer'
                        );
                      } finally {
                        setManualExistingPromptSubmitting(false);
                      }
                    })();
                  }}
                >
                  Existing Customer
                </button>

                <button
                  type="button"
                  className="cs-liquid-button"
                  disabled={
                    manualExistingPromptSubmitting ||
                    isSubmitting ||
                    !manualExistingPrompt ||
                    !session?.sessionToken
                  }
                  onClick={() => {
                    if (!manualExistingPrompt || !session?.sessionToken) return;
                    void (async () => {
                      setManualExistingPromptSubmitting(true);
                      setManualExistingPromptError(null);
                      try {
                        const { firstName, lastName, dobIso, idNumber } = manualExistingPrompt;
                        const createRes = await fetch(`${API_BASE}/v1/customers/create-manual`, {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${session.sessionToken}`,
                          },
                          body: JSON.stringify({
                            firstName,
                            lastName,
                            dob: dobIso,
                            idNumber: idNumber || undefined,
                          }),
                        });
                        const createPayload: unknown = await createRes.json().catch(() => null);
                        if (!createRes.ok) {
                          const msg = getErrorMessage(createPayload) || 'Failed to create customer';
                          setManualExistingPromptError(msg);
                          return;
                        }
                        const created = createPayload as { customer?: { id?: string } };
                        const newId = created.customer?.id;
                        if (!newId) {
                          setManualExistingPromptError('Create returned no customer id');
                          return;
                        }
                        const result = await startLaneSessionByCustomerId(newId, {
                          suppressAlerts: true,
                        });
                        if (result.outcome === 'matched') {
                          setManualExistingPrompt(null);
                          setManualEntry(false);
                          setManualFirstName('');
                          setManualLastName('');
                          setManualDobDigits('');
                          setManualIdNumber('');
                        }
                      } finally {
                        setManualExistingPromptSubmitting(false);
                      }
                    })();
                  }}
                >
                  Add Customer
                </button>
              </div>
            </div>
          </ModalFrame>

          <ModalFrame
            isOpen={showCreateFromScanPrompt && !!pendingCreateFromScan}
            title="No match found"
            onClose={() => {
              setShowCreateFromScanPrompt(false);
              setPendingCreateFromScan(null);
              setCreateFromScanError(null);
              setCreateFromScanSubmitting(false);
            }}
            maxWidth="720px"
            closeOnOverlayClick={false}
          >
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              <div style={{ color: '#94a3b8' }}>
                Create a new customer profile using the scanned First Name, Last Name, and DOB.
              </div>

              {createFromScanError ? (
                <div
                  style={{
                    padding: '0.75rem',
                    background: 'rgba(239, 68, 68, 0.18)',
                    border: '1px solid rgba(239, 68, 68, 0.35)',
                    borderRadius: 12,
                    color: '#fecaca',
                    fontWeight: 800,
                  }}
                >
                  {createFromScanError}
                </div>
              ) : null}

              <div className="cs-liquid-card" style={{ padding: '1rem' }}>
                <div
                  style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', color: '#94a3b8' }}
                >
                  <span>
                    First:{' '}
                    <strong style={{ color: 'white' }}>
                      {pendingCreateFromScan?.extracted.firstName || '—'}
                    </strong>
                  </span>
                  <span>
                    Last:{' '}
                    <strong style={{ color: 'white' }}>
                      {pendingCreateFromScan?.extracted.lastName || '—'}
                    </strong>
                  </span>
                  <span>
                    DOB:{' '}
                    <strong style={{ color: 'white' }}>
                      {pendingCreateFromScan?.extracted.dob || '—'}
                    </strong>
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button
                  className="cs-liquid-button cs-liquid-button--secondary"
                  disabled={createFromScanSubmitting || isSubmitting}
                  onClick={() => {
                    setShowCreateFromScanPrompt(false);
                    setPendingCreateFromScan(null);
                    setCreateFromScanError(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  className="cs-liquid-button"
                  disabled={createFromScanSubmitting || isSubmitting || !pendingCreateFromScan}
                  onClick={() => {
                    void (async () => {
                      setCreateFromScanSubmitting(true);
                      setCreateFromScanError(null);
                      try {
                        const r = await handleCreateFromNoMatch();
                        if (r.outcome !== 'matched') {
                          setCreateFromScanError(r.message);
                        }
                      } finally {
                        setCreateFromScanSubmitting(false);
                      }
                    })();
                  }}
                >
                  {createFromScanSubmitting ? 'Creating…' : 'Create Customer'}
                </button>
              </div>
            </div>
          </ModalFrame>

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

          <MembershipIdPromptModal
            isOpen={showMembershipIdPrompt}
            membershipIdMode={membershipIdMode}
            membershipIdInput={membershipIdInput}
            membershipNumber={membershipNumber}
            membershipPurchaseIntent={membershipPurchaseIntent}
            error={membershipIdError}
            isSubmitting={membershipIdSubmitting}
            onModeChange={(mode) => {
              setMembershipIdMode(mode);
              if (mode === 'KEEP_EXISTING' && membershipNumber) {
                setMembershipIdInput(membershipNumber);
              } else {
                setMembershipIdInput('');
              }
              setMembershipIdError(null);
            }}
            onInputChange={setMembershipIdInput}
            onConfirm={(membershipId) => void handleCompleteMembershipPurchase(membershipId)}
            onNotNow={() => {
              setShowMembershipIdPrompt(false);
              setMembershipIdError(null);
            }}
          />

          <ManagerBypassModal
            isOpen={showManagerBypassModal}
            managers={managerList}
            managerId={managerId}
            managerPin={managerPin}
            onChangeManagerId={setManagerId}
            onChangeManagerPin={setManagerPin}
            onBypass={() => void handleManagerBypass()}
            onCancel={() => {
              setShowManagerBypassModal(false);
              setManagerId('');
              setManagerPin('');
            }}
            isSubmitting={isSubmitting}
          />

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

          <AddNoteModal
            isOpen={showAddNoteModal}
            noteText={newNoteText}
            onChangeNoteText={setNewNoteText}
            onSubmit={() => void handleAddNote()}
            onCancel={() => {
              setShowAddNoteModal(false);
              setNewNoteText('');
            }}
            isSubmitting={isSubmitting}
          />

          <SuccessToast
            message={successToastMessage}
            onDismiss={() => setSuccessToastMessage(null)}
          />
          <PaymentDeclineToast
            message={paymentDeclineError}
            onDismiss={() => setPaymentDeclineError(null)}
          />
          <BottomToastStack toasts={bottomToasts} onDismiss={dismissBottomToast} />
          {scanToastMessage && (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0, 0, 0, 0.55)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '1rem',
                zIndex: 2000,
              }}
              role="status"
              aria-label="Scan message"
              onClick={() => setScanToastMessage(null)}
            >
              <div
                className="cs-liquid-card"
                style={{
                  width: 'min(520px, 92vw)',
                  background: '#0f172a',
                  color: 'white',
                  padding: '1rem',
                  borderRadius: '12px',
                  border: '1px solid rgba(148, 163, 184, 0.18)',
                  boxShadow: '0 10px 30px rgba(0, 0, 0, 0.45)',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                  <div style={{ fontWeight: 900 }}>Scan</div>
                  <button
                    onClick={() => setScanToastMessage(null)}
                    className="cs-liquid-button cs-liquid-button--secondary"
                    style={{ padding: '0.2rem 0.55rem' }}
                    aria-label="Dismiss"
                  >
                    ×
                  </button>
                </div>
                <div style={{ marginTop: '0.5rem', color: '#cbd5e1', fontWeight: 700 }}>
                  {scanToastMessage}
                </div>
              </div>
            </div>
          )}
          {/* Agreement + Assignment Display */}
          {(() => {
            const agreementPending =
              !agreementSigned && selectionConfirmed && paymentStatus === 'PAID';
            const canShowModal = Boolean(
              currentSessionId &&
              customerName &&
              (agreementPending || (assignedResourceType && assignedResourceNumber))
            );
            return (
              <TransactionCompleteModal
                isOpen={canShowModal}
                agreementPending={agreementPending}
                agreementSigned={agreementSigned}
                agreementBypassPending={agreementBypassPending}
                agreementSignedMethod={agreementSignedMethod}
                selectionSummary={{
                  membershipChoice: membershipChoice || null,
                  rentalType: proposedRentalType || customerSelectedType || null,
                  waitlistDesiredType: waitlistDesiredTier || null,
                  waitlistBackupType: waitlistBackupType || null,
                }}
                assignedLabel={assignedLabel}
                assignedNumber={assignedResourceNumber}
                checkoutAt={checkoutAt}
                verifyDisabled={!session?.sessionToken || !currentSessionIdRef.current}
                showComplete={Boolean(agreementSigned && assignedResourceType)}
                completeLabel={isSubmitting ? 'Processing...' : 'Complete Transaction'}
                completeDisabled={isSubmitting}
                showBypassAction={agreementPending && !agreementBypassPending}
                showPhysicalConfirmAction={agreementPending && agreementBypassPending}
                onVerifyAgreementArtifacts={() => {
                  const sid = currentSessionIdRef.current;
                  if (!sid) return;
                  setDocumentsModalOpen(true);
                  void fetchDocumentsBySession(sid);
                }}
                onStartAgreementBypass={() => void handleStartAgreementBypass()}
                onConfirmPhysicalAgreement={() => void handleConfirmPhysicalAgreement()}
                onCompleteTransaction={() => void handleCompleteTransaction()}
              />
            );
          })()}

          {/* Pay-First Demo Buttons (after selection confirmed) */}
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
              />
            )}
        </div>
      )}
      <ModalFrame
        isOpen={documentsModalOpen}
        title="Agreement artifacts"
        onClose={() => setDocumentsModalOpen(false)}
        maxWidth="720px"
        maxHeight="70vh"
      >
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <div style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
            Session:{' '}
            <span style={{ fontFamily: 'monospace' }}>{currentSessionIdRef.current || '—'}</span>
          </div>

          {documentsError && (
            <div
              style={{
                padding: '0.75rem',
                background: 'rgba(239, 68, 68, 0.18)',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                borderRadius: 12,
                color: '#fecaca',
                fontWeight: 700,
              }}
            >
              {documentsError}
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              className="cs-liquid-button cs-liquid-button--secondary"
              disabled={documentsLoading || !currentSessionIdRef.current}
              onClick={() => {
                const sid = currentSessionIdRef.current;
                if (!sid) return;
                void fetchDocumentsBySession(sid);
              }}
            >
              {documentsLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          {documentsForSession === null ? (
            <div style={{ color: '#94a3b8' }}>No data loaded yet.</div>
          ) : documentsForSession.length === 0 ? (
            <div style={{ color: '#94a3b8' }}>No documents found for this session.</div>
          ) : (
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              {documentsForSession.map((doc) => (
                <div
                  key={doc.id}
                  className="er-surface"
                  style={{ padding: '0.75rem', borderRadius: 12, display: 'grid', gap: '0.35rem' }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '0.75rem',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ fontWeight: 900 }}>
                      {doc.doc_type}{' '}
                      <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#94a3b8' }}>
                        {doc.id}
                      </span>
                    </div>
                    <div style={{ color: '#94a3b8' }}>
                      {new Date(doc.created_at).toLocaleString()}
                    </div>
                  </div>
                  <div style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
                    PDF stored: {doc.has_pdf ? 'yes' : 'no'} • Signature stored:{' '}
                    {doc.has_signature ? 'yes' : 'no'}
                    {doc.signature_hash_prefix ? ` • sig hash: ${doc.signature_hash_prefix}…` : ''}
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button
                      className="cs-liquid-button"
                      disabled={!doc.has_pdf}
                      onClick={() => {
                        void downloadAgreementPdf(doc.id).catch((e) => {
                          setDocumentsError(
                            e instanceof Error ? e.message : 'Failed to download PDF'
                          );
                        });
                      }}
                    >
                      Download PDF
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </ModalFrame>
    </RegisterSignIn>
  );
}
