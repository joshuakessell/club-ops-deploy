import { useMemo, useState } from 'react';
import { deriveAssignedLabel } from '../../shared/derive/assignedLabel';
import { deriveCheckinStage } from '../../shared/derive/checkinStage';
import { derivePastDueLineItems } from '../../shared/derive/pastDueLineItems';
import { useEmployeeRegisterTabletUiTweaks } from '../../hooks/useEmployeeRegisterTabletUiTweaks';
import { useAddOnSaleState } from './slices/useAddOnSaleState';
import { useCheckoutState } from './slices/useCheckoutState';
import { useCustomerSearchState } from './slices/useCustomerSearchState';
import { useCustomerSessionActions } from './slices/useCustomerSessionActions';
import { useDocumentsState } from './slices/useDocumentsState';
import { useHealthStatus } from './slices/useHealthStatus';
import { useHomeNavigationState } from './slices/useHomeNavigationState';
import { useInventorySelectionState } from './slices/useInventorySelectionState';
import { useLaneSessionBindings } from './slices/useLaneSessionBindings';
import { useManualEntryState } from './slices/useManualEntryState';
import { useMembershipActions } from './slices/useMembershipActions';
import { useMembershipPromptState } from './slices/useMembershipPromptState';
import { useNotesState } from './slices/useNotesState';
import { usePastDueState } from './slices/usePastDueState';
import { usePaymentActions } from './slices/usePaymentActions';
import { usePollingFallback } from './slices/usePollingFallback';
import { useRenewalSelectionState } from './slices/useRenewalSelectionState';
import { useRegisterWebSocketState } from './slices/useRegisterWebSocketState';
import { useScanState } from './slices/useScanState';
import { useSelectionActions } from './slices/useSelectionActions';
import { useSessionResetActions } from './slices/useSessionResetActions';
import { useStaffSessionState } from './slices/useStaffSessionState';
import { useToastState } from './slices/useToastState';
import { useWaitlistUpgradeState } from './slices/useWaitlistUpgradeState';
import { buildEmployeeRegisterCoreValue } from './value/buildEmployeeRegisterCoreValue';
import { buildEmployeeRegisterModalValue } from './value/buildEmployeeRegisterModalValue';

export function useEmployeeRegisterStateValue() {
  useEmployeeRegisterTabletUiTweaks();

  const [manualEntry, setManualEntry] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [, setSelectedRentalType] = useState<string | null>(null);

  const laneBindings = useLaneSessionBindings();
  const {
    currentSessionId,
    customerName,
    checkoutAt,
    customerSelectedType,
    waitlistDesiredTier,
    waitlistBackupType,
    membershipNumber,
    membershipPurchaseIntent,
    paymentStatus,
    paymentQuote,
    customerMembershipValidUntil,
    pastDueBlocked,
    pastDueBalance,
    mode,
    renewalHours,
    ledgerLineItems,
    ledgerTotal,
    proposedRentalType,
    selectionConfirmed,
    paymentIntentId,
  } = laneBindings;

  const staffSessionState = useStaffSessionState({
    currentSessionId,
    customerName,
    checkoutAt,
  });
  const { session, registerSession, deviceId, lane, handleRegisterSignIn, handleLogout, handleCloseOut } =
    staffSessionState;

  const { health } = useHealthStatus(lane);

  const toastState = useToastState();
  const addOnState = useAddOnSaleState();

  const navState = useHomeNavigationState({
    setManualEntry,
    currentSessionId,
    laneSessionCustomerId: laneBindings.customerId ?? null,
  });

  const customerSessionActions = useCustomerSessionActions({
    session,
    openCustomerAccount: navState.openCustomerAccount,
    setIsSubmitting,
  });

  const manualEntryState = useManualEntryState({
    session,
    manualEntry,
    setManualEntry,
    startLaneSessionByCustomerId: customerSessionActions.startLaneSessionByCustomerId,
  });

  const customerSearchState = useCustomerSearchState(session);

  const inventorySelectionState = useInventorySelectionState({ customerSelectedType });

  const checkoutState = useCheckoutState({ session, setIsSubmitting });

  const waitlistState = useWaitlistUpgradeState({
    session,
    registerSession,
    sessionActive: !!currentSessionId,
    selectHomeTab: navState.selectHomeTab,
    setIsSubmitting,
    setPaymentDeclineError: laneBindings.setPaymentDeclineError,
    onUnauthorized: () => {
      staffSessionState.setSession(null);
      staffSessionState.setRegisterSession(null);
    },
  });

  const documentsState = useDocumentsState(session);

  const membershipPromptState = useMembershipPromptState({
    session,
    lane,
    currentSessionId,
    membershipNumber,
    membershipPurchaseIntent,
    paymentStatus,
    paymentQuote,
    customerMembershipValidUntil,
  });

  const pastDueState = usePastDueState({
    session,
    lane,
    currentSessionId,
    pastDueBlocked,
    pastDueBalance,
    setPaymentDeclineError: laneBindings.setPaymentDeclineError,
    setIsSubmitting,
  });

  const notesState = useNotesState({
    session,
    lane,
    currentSessionId,
    setIsSubmitting,
  });

  const wsState = useRegisterWebSocketState({
    lane,
    currentSessionId,
    selectedCheckoutRequest: checkoutState.selectedCheckoutRequest,
    customerSelectedType,
    laneSessionActions: {
      applySessionUpdated: laneBindings.laneSessionActions.applySessionUpdated,
      applySelectionProposed: laneBindings.laneSessionActions.applySelectionProposed,
      applySelectionLocked: laneBindings.laneSessionActions.applySelectionLocked,
      applySelectionForced: laneBindings.laneSessionActions.applySelectionForced,
      selectionAcknowledged: laneBindings.laneSessionActions.selectionAcknowledged,
    },
    setCheckoutRequests: checkoutState.setCheckoutRequests,
    setCheckoutItemsConfirmed: checkoutState.setCheckoutItemsConfirmed,
    setCheckoutFeePaid: checkoutState.setCheckoutFeePaid,
    setSelectedCheckoutRequest: checkoutState.setSelectedCheckoutRequest,
    setCheckoutChecklist: checkoutState.setCheckoutChecklist,
    refreshWaitlistAndInventory: waitlistState.refreshWaitlistAndInventory,
    refreshInventoryAvailable: waitlistState.refreshInventoryAvailable,
    setSelectedInventoryItem: inventorySelectionState.setSelectedInventoryItem,
    setShowAddOnSaleModal: addOnState.setShowAddOnSaleModal,
    resetAddOnCart: addOnState.resetAddOnCart,
    resetMembershipPrompt: membershipPromptState.resetMembershipPrompt,
    setShowWaitlistModal: waitlistState.setShowWaitlistModal,
    setCurrentSessionCustomerId: laneBindings.setCurrentSessionCustomerId,
    setAccountCustomerId: navState.setAccountCustomerId,
    setAccountCustomerLabel: navState.setAccountCustomerLabel,
    selectHomeTab: navState.selectHomeTab,
    pushBottomToast: toastState.pushBottomToast,
    setShowCustomerConfirmationPending: inventorySelectionState.setShowCustomerConfirmationPending,
    setCustomerConfirmationType: inventorySelectionState.setCustomerConfirmationType,
  });

  const { pollOnce } = usePollingFallback({
    lane,
    wsConnected: wsState.wsConnected,
    laneSessionActions: {
      applySessionUpdated: laneBindings.laneSessionActions.applySessionUpdated,
      resetCleared: laneBindings.laneSessionActions.resetCleared,
    },
  });

  const membershipActions = useMembershipActions({
    session,
    lane,
    currentSessionId,
    customerName,
    membershipNumber,
    customerMembershipValidUntil,
    setIsSubmitting,
    pollOnce,
  });

  const selectionActions = useSelectionActions({
    session,
    lane,
    currentSessionId,
    inventoryAvailable: waitlistState.inventoryAvailable,
    waitlistDesiredTier,
    proposedRentalType,
    setIsSubmitting,
    pollOnce,
    setSelectionConfirmed: laneBindings.setSelectionConfirmed,
    setCustomerSelectedType: laneBindings.setCustomerSelectedType,
    laneSessionActions: {
      patch: laneBindings.laneSessionActions.patch,
    },
  });

  const renewalSelectionState = useRenewalSelectionState({
    lane,
    session,
    accountCustomerId: navState.accountCustomerId,
    setIsSubmitting,
    laneSessionActions: laneBindings.laneSessionActions,
  });

  const sessionResetActions = useSessionResetActions({
    session,
    lane,
    setCustomerName: laneBindings.setCustomerName,
    setMembershipNumber: laneBindings.setMembershipNumber,
    setCurrentSessionId: laneBindings.setCurrentSessionId,
    setCurrentSessionCustomerId: laneBindings.setCurrentSessionCustomerId,
    setAccountCustomerId: navState.setAccountCustomerId,
    setAccountCustomerLabel: navState.setAccountCustomerLabel,
    setAgreementSigned: laneBindings.setAgreementSigned,
    setManualEntry,
    setSelectedRentalType,
    setCustomerSelectedType: laneBindings.setCustomerSelectedType,
    setWaitlistDesiredTier: laneBindings.setWaitlistDesiredTier,
    setWaitlistBackupType: laneBindings.setWaitlistBackupType,
    setSelectedInventoryItem: inventorySelectionState.setSelectedInventoryItem,
    setPaymentIntentId: laneBindings.setPaymentIntentId,
    setPaymentQuote: laneBindings.setPaymentQuote,
    setPaymentStatus: laneBindings.setPaymentStatus,
    setShowCustomerConfirmationPending: inventorySelectionState.setShowCustomerConfirmationPending,
    setCustomerConfirmationType: inventorySelectionState.setCustomerConfirmationType,
    setShowWaitlistModal: waitlistState.setShowWaitlistModal,
  });

  const paymentActions = usePaymentActions({
    session,
    registerSession,
    lane,
    currentSessionId,
    selectionConfirmed,
    paymentIntentId,
    paymentStatus,
    addOnCart: addOnState.addOnCart,
    setIsSubmitting,
    setPaymentIntentId: laneBindings.setPaymentIntentId,
    setPaymentQuote: laneBindings.setPaymentQuote,
    setPaymentStatus: laneBindings.setPaymentStatus,
    setPaymentDeclineError: laneBindings.setPaymentDeclineError,
    setSuccessToastMessage: toastState.setSuccessToastMessage,
    resetAddOnCart: addOnState.resetAddOnCart,
    setShowAddOnSaleModal: addOnState.setShowAddOnSaleModal,
    setCustomerName: laneBindings.setCustomerName,
    setMembershipNumber: laneBindings.setMembershipNumber,
    setCurrentSessionId: laneBindings.setCurrentSessionId,
    setCurrentSessionCustomerId: laneBindings.setCurrentSessionCustomerId,
    setAccountCustomerId: navState.setAccountCustomerId,
    setAccountCustomerLabel: navState.setAccountCustomerLabel,
    setAgreementSigned: laneBindings.setAgreementSigned,
    setSelectedRentalType,
    setCustomerSelectedType: laneBindings.setCustomerSelectedType,
    setSelectedInventoryItem: inventorySelectionState.setSelectedInventoryItem,
    setAssignedResourceType: laneBindings.setAssignedResourceType,
    setAssignedResourceNumber: laneBindings.setAssignedResourceNumber,
    setCheckoutAt: laneBindings.setCheckoutAt,
    setCustomerPrimaryLanguage: laneBindings.setCustomerPrimaryLanguage,
    setCustomerDobMonthDay: laneBindings.setCustomerDobMonthDay,
    setCustomerLastVisitAt: laneBindings.setCustomerLastVisitAt,
    setCustomerNotes: laneBindings.setCustomerNotes,
  });

  const externalBlocking =
    pastDueState.showPastDueModal ||
    pastDueState.showManagerBypassModal ||
    membershipPromptState.showMembershipIdPrompt ||
    waitlistState.showUpgradePaymentModal ||
    notesState.showAddNoteModal ||
    documentsState.documentsModalOpen ||
    !!waitlistState.offerUpgradeModal ||
    !!renewalSelectionState.renewalSelection ||
    (waitlistState.showWaitlistModal && !!waitlistDesiredTier && !!waitlistBackupType) ||
    (inventorySelectionState.showCustomerConfirmationPending &&
      !!inventorySelectionState.customerConfirmationType) ||
    !!checkoutState.selectedCheckoutRequest;

  const scanState = useScanState({
    session,
    lane,
    homeTab: navState.homeTab,
    manualEntry,
    isSubmitting,
    externalBlocking,
    startLaneSessionByCustomerId: customerSessionActions.startLaneSessionByCustomerId,
  });

  const checkinStage = useMemo(
    () =>
      deriveCheckinStage({
        currentSessionId,
        customerName,
        assignedResourceType: laneBindings.assignedResourceType,
        assignedResourceNumber: laneBindings.assignedResourceNumber,
        agreementSigned: laneBindings.agreementSigned,
        selectionConfirmed,
        customerPrimaryLanguage: laneBindings.customerPrimaryLanguage,
        membershipNumber: membershipNumber || null,
        customerMembershipValidUntil: customerMembershipValidUntil || null,
        membershipPurchaseIntent,
        membershipChoice: laneBindings.membershipChoice,
      }),
    [
      laneBindings.agreementSigned,
      laneBindings.assignedResourceNumber,
      laneBindings.assignedResourceType,
      customerMembershipValidUntil,
      customerName,
      laneBindings.customerPrimaryLanguage,
      currentSessionId,
      laneBindings.membershipChoice,
      membershipNumber,
      membershipPurchaseIntent,
      selectionConfirmed,
    ]
  );

  const assignedLabel = useMemo(
    () =>
      deriveAssignedLabel({
        assignedResourceType: laneBindings.assignedResourceType,
        proposedRentalType,
        customerSelectedType,
      }),
    [laneBindings.assignedResourceType, customerSelectedType, proposedRentalType]
  );

  const pastDueLineItems = useMemo(
    () => derivePastDueLineItems(laneBindings.customerNotes, pastDueBalance),
    [laneBindings.customerNotes, pastDueBalance]
  );

  const coreValue = buildEmployeeRegisterCoreValue({
    deviceId,
    handleRegisterSignIn,
    lane,
    health,
    wsConnected: wsState.wsConnected,
    handleLogout,
    handleCloseOut,
    registerSession,
    session,
    checkoutState,
    navState,
    waitlistState,
    laneBindings,
    selectionActions,
    membershipActions,
    sessionResetActions,
    inventorySelectionState,
    customerSessionActions,
    manualEntryState,
    setManualEntry,
    customerSearchState,
    assignedLabel,
    checkinStage,
    isSubmitting,
    laneSessionMode: mode,
    renewalHours,
    ledgerLineItems,
    ledgerTotal,
    renewalSelectionState,
  });

  const modalValue = buildEmployeeRegisterModalValue({
    scanState,
    pastDueState,
    pastDueLineItems,
    membershipPromptState,
    addOnState,
    paymentActions,
    waitlistState,
    notesState,
    toastState,
    setPaymentDeclineError: laneBindings.setPaymentDeclineError,
    currentSessionIdRef: wsState.currentSessionIdRef,
    documentsState,
    selectionActions,
  });

  return { ...coreValue, ...modalValue };
}

export type EmployeeRegisterStateValue = ReturnType<typeof useEmployeeRegisterStateValue>;
