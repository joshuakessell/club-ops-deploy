import { useCallback } from 'react';
import { useRegisterLaneSessionState } from '../../useRegisterLaneSessionState';

type PaymentQuote = ReturnType<typeof useRegisterLaneSessionState>['state']['paymentQuote'];

export function useLaneSessionBindings() {
  const { state: laneSession, actions: laneSessionActions } = useRegisterLaneSessionState();
  const {
    customerId,
    customerName,
    membershipNumber,
    currentSessionId,
    agreementSigned,
    agreementBypassPending,
    agreementSignedMethod,
    customerSelectedType,
    waitlistDesiredTier,
    waitlistBackupType,
    proposedRentalType,
    proposedBy,
    selectionConfirmed,
    paymentIntentId,
    paymentQuote,
    paymentStatus,
    membershipPurchaseIntent,
    membershipChoice,
    mode,
    renewalHours,
    ledgerLineItems,
    ledgerTotal,
    customerMembershipValidUntil,
    allowedRentals,
    pastDueBlocked,
    pastDueBalance,
    customerPrimaryLanguage,
    customerDobMonthDay,
    customerLastVisitAt,
    customerNotes,
    assignedResourceType,
    assignedResourceNumber,
    checkoutAt,
    paymentDeclineError,
  } = laneSession;

  const setCustomerName = useCallback(
    (value: string) => laneSessionActions.patch({ customerName: value }),
    [laneSessionActions]
  );
  const setMembershipNumber = useCallback(
    (value: string) => laneSessionActions.patch({ membershipNumber: value }),
    [laneSessionActions]
  );
  const setCurrentSessionId = useCallback(
    (value: string | null) => laneSessionActions.patch({ currentSessionId: value }),
    [laneSessionActions]
  );
  const setCurrentSessionCustomerId = useCallback(
    (value: string | null) => laneSessionActions.patch({ customerId: value }),
    [laneSessionActions]
  );
  const setAgreementSigned = useCallback(
    (value: boolean) => laneSessionActions.patch({ agreementSigned: value }),
    [laneSessionActions]
  );
  const setCustomerSelectedType = useCallback(
    (value: string | null) => laneSessionActions.patch({ customerSelectedType: value }),
    [laneSessionActions]
  );
  const setWaitlistDesiredTier = useCallback(
    (value: string | null) => laneSessionActions.patch({ waitlistDesiredTier: value }),
    [laneSessionActions]
  );
  const setWaitlistBackupType = useCallback(
    (value: string | null) => laneSessionActions.patch({ waitlistBackupType: value }),
    [laneSessionActions]
  );
  const setSelectionConfirmed = useCallback(
    (value: boolean) => laneSessionActions.patch({ selectionConfirmed: value }),
    [laneSessionActions]
  );
  const setPaymentIntentId = useCallback(
    (value: string | null) => laneSessionActions.patch({ paymentIntentId: value }),
    [laneSessionActions]
  );
  const setPaymentQuote = useCallback(
    (value: PaymentQuote | ((prev: PaymentQuote) => PaymentQuote)) => {
      if (typeof value === 'function') {
        laneSessionActions.patch({ paymentQuote: value(paymentQuote) });
        return;
      }
      laneSessionActions.patch({ paymentQuote: value });
    },
    [laneSessionActions, paymentQuote]
  );
  const setPaymentStatus = useCallback(
    (value: 'DUE' | 'PAID' | null) => laneSessionActions.patch({ paymentStatus: value }),
    [laneSessionActions]
  );
  const setCustomerPrimaryLanguage = useCallback(
    (value: 'EN' | 'ES' | undefined) =>
      laneSessionActions.patch({ customerPrimaryLanguage: value }),
    [laneSessionActions]
  );
  const setCustomerDobMonthDay = useCallback(
    (value: string | undefined) => laneSessionActions.patch({ customerDobMonthDay: value }),
    [laneSessionActions]
  );
  const setCustomerLastVisitAt = useCallback(
    (value: string | undefined) => laneSessionActions.patch({ customerLastVisitAt: value }),
    [laneSessionActions]
  );
  const setCustomerNotes = useCallback(
    (value: string | undefined) => laneSessionActions.patch({ customerNotes: value }),
    [laneSessionActions]
  );
  const setAssignedResourceType = useCallback(
    (value: 'room' | 'locker' | null) => laneSessionActions.patch({ assignedResourceType: value }),
    [laneSessionActions]
  );
  const setAssignedResourceNumber = useCallback(
    (value: string | null) => laneSessionActions.patch({ assignedResourceNumber: value }),
    [laneSessionActions]
  );
  const setCheckoutAt = useCallback(
    (value: string | null) => laneSessionActions.patch({ checkoutAt: value }),
    [laneSessionActions]
  );
  const setPaymentDeclineError = useCallback(
    (value: string | null) => laneSessionActions.setPaymentDeclineError(value),
    [laneSessionActions]
  );

  return {
    laneSession,
    laneSessionActions,
    customerId,
    customerName,
    membershipNumber,
    currentSessionId,
    agreementSigned,
    agreementBypassPending,
    agreementSignedMethod,
    customerSelectedType,
    waitlistDesiredTier,
    waitlistBackupType,
    proposedRentalType,
    proposedBy,
    selectionConfirmed,
    paymentIntentId,
    paymentQuote,
    paymentStatus,
    membershipPurchaseIntent,
    membershipChoice,
    mode,
    renewalHours,
    ledgerLineItems,
    ledgerTotal,
    customerMembershipValidUntil,
    allowedRentals,
    pastDueBlocked,
    pastDueBalance,
    customerPrimaryLanguage,
    customerDobMonthDay,
    customerLastVisitAt,
    customerNotes,
    assignedResourceType,
    assignedResourceNumber,
    checkoutAt,
    paymentDeclineError,
    setCustomerName,
    setMembershipNumber,
    setCurrentSessionId,
    setCurrentSessionCustomerId,
    setAgreementSigned,
    setCustomerSelectedType,
    setWaitlistDesiredTier,
    setWaitlistBackupType,
    setSelectionConfirmed,
    setPaymentIntentId,
    setPaymentQuote,
    setPaymentStatus,
    setCustomerPrimaryLanguage,
    setCustomerDobMonthDay,
    setCustomerLastVisitAt,
    setCustomerNotes,
    setAssignedResourceType,
    setAssignedResourceNumber,
    setCheckoutAt,
    setPaymentDeclineError,
  };
}
