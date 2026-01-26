import { CustomerProfileCard } from '../../components/register/CustomerProfileCard';
import { EmployeeAssistPanel } from '../../components/register/EmployeeAssistPanel';
import { CustomerAccountPanel } from '../../components/register/panels/CustomerAccountPanel';
import { useEmployeeRegisterState } from '../../app/state/useEmployeeRegisterState';
import { PanelHeader } from '../../views/PanelHeader';
import { PanelShell } from '../../views/PanelShell';

export function AccountPanel() {
  const {
    accountCustomerId,
    accountCustomerLabel,
    lane,
    session,
    openRenewalSelection,
    startCheckoutFromCustomerAccount,
    handleClearSession,
    selectHomeTab,
    currentSessionId,
    laneSession,
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
    waitlistDesiredTier,
    waitlistBackupType,
    inventoryAvailable,
    isSubmitting,
    checkinStage,
    laneSessionMode,
    renewalHours,
    highlightKioskOption,
    handleConfirmLanguage,
    handleConfirmMembershipOneTime,
    handleConfirmMembershipSixMonth,
    handleProposeSelection,
    handleCustomerSelectRental,
    handleDirectSelectRental,
    handleSelectWaitlistBackupAsCustomer,
    handleDirectSelectWaitlistBackup,
    handleConfirmSelection,
    laneSessionActions,
  } = useEmployeeRegisterState();

  const directSelect = laneSessionMode === 'RENEWAL';

  if (accountCustomerId) {
    return (
      <CustomerAccountPanel
        lane={lane}
        sessionToken={session?.sessionToken}
        customerId={accountCustomerId}
        customerLabel={accountCustomerLabel}
        onStartCheckout={startCheckoutFromCustomerAccount}
        onStartRenewal={(activeCheckin) => openRenewalSelection(activeCheckin)}
        onClearSession={() => void handleClearSession().then(() => selectHomeTab('scan'))}
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
        hasEncryptedLookupMarker={Boolean(laneSession.customerHasEncryptedLookupMarker)}
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
        sessionMode={laneSessionMode}
        renewalHours={renewalHours}
        directSelect={directSelect}
        onDirectSelectRental={(rental) => void handleDirectSelectRental(rental)}
        onDirectSelectWaitlistBackup={(rental) => void handleDirectSelectWaitlistBackup(rental)}
        onStartedSession={(data) => {
          const patch: Partial<typeof laneSession> = {};
          if (accountCustomerId) patch.customerId = accountCustomerId;
          if (data.customerName) patch.customerName = data.customerName;
          if (data.membershipNumber) patch.membershipNumber = data.membershipNumber;
          if (data.sessionId) patch.currentSessionId = data.sessionId;
          if (data.mode) patch.mode = data.mode;
          if (data.renewalHours) patch.renewalHours = data.renewalHours;
          if (data.customerHasEncryptedLookupMarker !== undefined) {
            patch.customerHasEncryptedLookupMarker = Boolean(data.customerHasEncryptedLookupMarker);
          }
          if (data.mode === 'RENEWAL' && typeof data.blockEndsAt === 'string') {
            if (data.activeAssignedResourceType)
              patch.assignedResourceType = data.activeAssignedResourceType;
            if (data.activeAssignedResourceNumber)
              patch.assignedResourceNumber = data.activeAssignedResourceNumber;
            patch.checkoutAt = data.blockEndsAt;
          }
          if (Object.keys(patch).length > 0) {
            laneSessionActions.patch(patch);
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
        onSelectRentalAsCustomer={(rental) => void handleCustomerSelectRental(rental)}
        onDirectSelectRental={(rental) => void handleDirectSelectRental(rental)}
        onHighlightWaitlistBackup={(rental) =>
          void highlightKioskOption({ step: 'WAITLIST_BACKUP', option: rental })
        }
        onSelectWaitlistBackupAsCustomer={(rental) =>
          void handleSelectWaitlistBackupAsCustomer(rental)
        }
        onDirectSelectWaitlistBackup={(rental) => void handleDirectSelectWaitlistBackup(rental)}
        onApproveRental={() => void handleConfirmSelection()}
      />
    );
  }

  if (currentSessionId && customerName) {
    return (
      <PanelShell align="top" scroll="hidden">
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
            minHeight: 0,
          }}
        >
          <PanelHeader title="Customer Account" spacing="none" />
          <CustomerProfileCard
            name={customerName}
            preferredLanguage={customerPrimaryLanguage || null}
            dobMonthDay={customerDobMonthDay || null}
            membershipNumber={membershipNumber || null}
            membershipValidUntil={customerMembershipValidUntil || null}
            lastVisitAt={customerLastVisitAt || null}
            hasEncryptedLookupMarker={Boolean(laneSession.customerHasEncryptedLookupMarker)}
            checkinStage={checkinStage}
            waitlistDesiredTier={waitlistDesiredTier}
            waitlistBackupType={waitlistBackupType}
            footer={
              checkinStage ? (
                <button
                  type="button"
                  className="cs-liquid-button cs-liquid-button--danger"
                  onClick={() => void handleClearSession().then(() => selectHomeTab('scan'))}
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
            directSelect={directSelect}
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
            onSelectRentalAsCustomer={(rental) => void handleCustomerSelectRental(rental)}
            onDirectSelectRental={(rental) => void handleDirectSelectRental(rental)}
            onHighlightWaitlistBackup={(rental) =>
              void highlightKioskOption({ step: 'WAITLIST_BACKUP', option: rental })
            }
            onSelectWaitlistBackupAsCustomer={(rental) =>
              void handleSelectWaitlistBackupAsCustomer(rental)
            }
            onDirectSelectWaitlistBackup={(rental) => void handleDirectSelectWaitlistBackup(rental)}
            onApproveRental={() => void handleConfirmSelection()}
          />
        </div>
      </PanelShell>
    );
  }

  return (
    <PanelShell align="center">
      <PanelHeader
        align="center"
        spacing="sm"
        title="Customer Account"
        subtitle="Select a customer (scan, search, or first-time) to view their account."
      />
    </PanelShell>
  );
}
