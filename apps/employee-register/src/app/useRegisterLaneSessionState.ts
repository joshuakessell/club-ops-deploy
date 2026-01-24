import { useCallback, useMemo, useReducer } from 'react';
import type { SessionUpdatedPayload } from '@club-ops/shared';

export type PaymentQuoteViewModel = {
  total: number;
  lineItems: Array<{ description: string; amount: number }>;
  messages: string[];
};

export type RegisterLaneSessionState = {
  currentSessionId: string | null;
  /**
   * Client-side context for which customer this lane session is for.
   * Note: server WS payloads do not currently include customerId, so this is set by the UI when
   * starting/loading a session from a known customerId.
   */
  customerId: string | null;
  customerName: string;
  membershipNumber: string;
  customerMembershipValidUntil: string | null;
  membershipPurchaseIntent: 'PURCHASE' | 'RENEW' | null;
  membershipChoice: 'ONE_TIME' | 'SIX_MONTH' | null;
  allowedRentals: string[];

  agreementSigned: boolean;
  agreementBypassPending: boolean;
  agreementSignedMethod: 'DIGITAL' | 'MANUAL' | null;

  proposedRentalType: string | null;
  proposedBy: 'CUSTOMER' | 'EMPLOYEE' | null;
  selectionConfirmed: boolean;
  selectionConfirmedBy: 'CUSTOMER' | 'EMPLOYEE' | null;
  selectionAcknowledged: boolean;

  customerSelectedType: string | null;
  waitlistDesiredTier: string | null;
  waitlistBackupType: string | null;

  customerPrimaryLanguage: 'EN' | 'ES' | undefined;
  customerDobMonthDay: string | undefined;
  customerLastVisitAt: string | undefined;
  customerNotes: string | undefined;
  customerHasEncryptedLookupMarker: boolean;

  assignedResourceType: 'room' | 'locker' | null;
  assignedResourceNumber: string | null;
  checkoutAt: string | null;

  paymentIntentId: string | null;
  paymentStatus: 'DUE' | 'PAID' | null;
  paymentQuote: PaymentQuoteViewModel | null;
  paymentDeclineError: string | null;

  pastDueBlocked: boolean;
  pastDueBalance: number;
};

const initialState: RegisterLaneSessionState = {
  currentSessionId: null,
  customerId: null,
  customerName: '',
  membershipNumber: '',
  customerMembershipValidUntil: null,
  membershipPurchaseIntent: null,
  membershipChoice: null,
  allowedRentals: [],

  agreementSigned: false,
  agreementBypassPending: false,
  agreementSignedMethod: null,

  proposedRentalType: null,
  proposedBy: null,
  selectionConfirmed: false,
  selectionConfirmedBy: null,
  selectionAcknowledged: true,

  customerSelectedType: null,
  waitlistDesiredTier: null,
  waitlistBackupType: null,

  customerPrimaryLanguage: undefined,
  customerDobMonthDay: undefined,
  customerLastVisitAt: undefined,
  customerNotes: undefined,
  customerHasEncryptedLookupMarker: false,

  assignedResourceType: null,
  assignedResourceNumber: null,
  checkoutAt: null,

  paymentIntentId: null,
  paymentStatus: null,
  paymentQuote: null,
  paymentDeclineError: null,

  pastDueBlocked: false,
  pastDueBalance: 0,
};

type Action =
  | {
      type: 'start_or_replace';
      payload: { sessionId?: string | null; customerId?: string | null; customerName?: string; membershipNumber?: string };
    }
  | { type: 'patch'; payload: Partial<RegisterLaneSessionState> }
  | { type: 'apply_session_updated'; payload: SessionUpdatedPayload }
  | { type: 'apply_selection_proposed'; payload: { rentalType: string; proposedBy: 'CUSTOMER' | 'EMPLOYEE' } }
  | { type: 'apply_selection_locked'; payload: { rentalType: string; confirmedBy: 'CUSTOMER' | 'EMPLOYEE' } }
  | { type: 'apply_selection_forced'; payload: { rentalType: string } }
  | { type: 'selection_acknowledged' }
  | { type: 'reset_cleared' }
  | { type: 'set_payment_decline_error'; payload: string | null };

function reducer(state: RegisterLaneSessionState, action: Action): RegisterLaneSessionState {
  switch (action.type) {
    case 'start_or_replace': {
      const next = { ...state };
      if (action.payload.sessionId !== undefined) next.currentSessionId = action.payload.sessionId || null;
      if (action.payload.customerId !== undefined) next.customerId = action.payload.customerId || null;
      if (action.payload.customerName !== undefined) next.customerName = action.payload.customerName || '';
      if (action.payload.membershipNumber !== undefined) next.membershipNumber = action.payload.membershipNumber || '';
      return next;
    }
    case 'patch':
      return { ...state, ...action.payload };
    case 'apply_session_updated': {
      const p = action.payload;

      // If server cleared the lane session (COMPLETED with empty customer name), reset local UI.
      if (p.status === 'COMPLETED' && (!p.customerName || p.customerName === '')) {
        return { ...initialState };
      }

      const sessionIdChanged =
        typeof p.sessionId === 'string' && p.sessionId && p.sessionId !== state.currentSessionId;

      // If this is a new sessionId, reset server-driven fields so we don't carry stale step state forward.
      const next: RegisterLaneSessionState = sessionIdChanged ? { ...initialState } : { ...state };

      if (p.sessionId !== undefined) next.currentSessionId = p.sessionId || null;
      if (p.customerName !== undefined) next.customerName = p.customerName || '';
      if (p.membershipNumber !== undefined) next.membershipNumber = p.membershipNumber || '';
      if (p.customerMembershipValidUntil !== undefined) {
        next.customerMembershipValidUntil = p.customerMembershipValidUntil || null;
      }
      if (Array.isArray(p.allowedRentals)) next.allowedRentals = p.allowedRentals;

      if (p.agreementSigned !== undefined) next.agreementSigned = Boolean(p.agreementSigned);
      if (p.agreementBypassPending !== undefined) {
        next.agreementBypassPending = Boolean(p.agreementBypassPending);
      }
      if (p.agreementSignedMethod !== undefined) {
        next.agreementSignedMethod = p.agreementSignedMethod ?? null;
      }

      // Treat SESSION_UPDATED as a "full snapshot" for these fields (clear stale values when omitted).
      const nextProposedRentalType = p.proposedRentalType ?? null;
      const nextSelectionConfirmed = Boolean(p.selectionConfirmed);

      next.proposedRentalType = nextProposedRentalType;
      next.proposedBy = (p.proposedBy ?? null) as RegisterLaneSessionState['proposedBy'];
      next.selectionConfirmed = nextSelectionConfirmed;
      next.selectionConfirmedBy = (p.selectionConfirmedBy ?? null) as RegisterLaneSessionState['selectionConfirmedBy'];

      next.paymentIntentId = p.paymentIntentId ?? null;
      next.paymentStatus = p.paymentStatus ?? null;

      next.assignedResourceType = (p.assignedResourceType ?? null) as RegisterLaneSessionState['assignedResourceType'];
      next.assignedResourceNumber = p.assignedResourceNumber ?? null;
      next.checkoutAt = p.checkoutAt ?? null;

      next.customerPrimaryLanguage = p.customerPrimaryLanguage;

      next.waitlistDesiredTier = p.waitlistDesiredType ?? null;
      next.waitlistBackupType = p.backupRentalType ?? null;

      next.membershipChoice = p.membershipChoice ?? null;
      next.membershipPurchaseIntent = p.membershipPurchaseIntent ?? null;

      // Selection acknowledgement is a UI-only coordination flag.
      // Reset it to false when:
      // - sessionId changes, OR
      // - proposedRentalType changes, OR
      // - selectionConfirmed becomes false
      if (
        sessionIdChanged ||
        nextProposedRentalType !== state.proposedRentalType ||
        !nextSelectionConfirmed
      ) {
        next.selectionAcknowledged = false;
      }

      // Derived local field: customer's chosen type (mirrors locked selection).
      next.customerSelectedType = nextSelectionConfirmed ? nextProposedRentalType : null;

      if (p.customerDobMonthDay !== undefined) next.customerDobMonthDay = p.customerDobMonthDay;
      if (p.customerLastVisitAt !== undefined) next.customerLastVisitAt = p.customerLastVisitAt;
      if (p.customerNotes !== undefined) next.customerNotes = p.customerNotes;
      if (p.customerHasEncryptedLookupMarker !== undefined) {
        next.customerHasEncryptedLookupMarker = Boolean(p.customerHasEncryptedLookupMarker);
      }

      if (p.paymentTotal !== undefined || p.paymentLineItems !== undefined) {
        next.paymentQuote = (() => {
          const total = p.paymentTotal ?? state.paymentQuote?.total ?? 0;
          const lineItems = p.paymentLineItems ?? state.paymentQuote?.lineItems ?? [];
          const messages = state.paymentQuote?.messages ?? [];
          return { total, lineItems, messages };
        })();
      }
      if (p.paymentFailureReason) next.paymentDeclineError = p.paymentFailureReason;

      if (p.pastDueBlocked !== undefined) {
        next.pastDueBlocked = p.pastDueBlocked;
        if (p.pastDueBalance !== undefined) next.pastDueBalance = p.pastDueBalance || 0;
      }

      return next;
    }
    case 'apply_selection_proposed':
      return { ...state, proposedRentalType: action.payload.rentalType, proposedBy: action.payload.proposedBy };
    case 'apply_selection_locked':
      return {
        ...state,
        selectionConfirmed: true,
        selectionConfirmedBy: action.payload.confirmedBy,
        customerSelectedType: action.payload.rentalType,
        selectionAcknowledged: true,
      };
    case 'apply_selection_forced':
      return {
        ...state,
        selectionConfirmed: true,
        selectionConfirmedBy: 'EMPLOYEE',
        customerSelectedType: action.payload.rentalType,
        selectionAcknowledged: true,
      };
    case 'selection_acknowledged':
      return { ...state, selectionAcknowledged: true };
    case 'reset_cleared':
      return { ...initialState };
    case 'set_payment_decline_error':
      return { ...state, paymentDeclineError: action.payload };
    default:
      return state;
  }
}

export function useRegisterLaneSessionState() {
  const [state, dispatch] = useReducer(reducer, initialState);

  const startOrReplace = useCallback(
    (payload: { sessionId?: string | null; customerName?: string; membershipNumber?: string }) => {
      dispatch({ type: 'start_or_replace', payload });
    },
    []
  );

  const applySessionUpdated = useCallback((payload: SessionUpdatedPayload) => {
    dispatch({ type: 'apply_session_updated', payload });
  }, []);

  const patch = useCallback((payload: Partial<RegisterLaneSessionState>) => {
    dispatch({ type: 'patch', payload });
  }, []);

  const applySelectionProposed = useCallback(
    (payload: { rentalType: string; proposedBy: 'CUSTOMER' | 'EMPLOYEE' }) => {
      dispatch({ type: 'apply_selection_proposed', payload });
    },
    []
  );

  const applySelectionLocked = useCallback(
    (payload: { rentalType: string; confirmedBy: 'CUSTOMER' | 'EMPLOYEE' }) => {
      dispatch({ type: 'apply_selection_locked', payload });
    },
    []
  );

  const applySelectionForced = useCallback((payload: { rentalType: string }) => {
    dispatch({ type: 'apply_selection_forced', payload });
  }, []);

  const selectionAcknowledged = useCallback(() => {
    dispatch({ type: 'selection_acknowledged' });
  }, []);

  const resetCleared = useCallback(() => {
    dispatch({ type: 'reset_cleared' });
  }, []);

  const setPaymentDeclineError = useCallback((message: string | null) => {
    dispatch({ type: 'set_payment_decline_error', payload: message });
  }, []);

  const actions = useMemo(
    () => ({
      startOrReplace,
      patch,
      applySessionUpdated,
      applySelectionProposed,
      applySelectionLocked,
      applySelectionForced,
      selectionAcknowledged,
      resetCleared,
      setPaymentDeclineError,
    }),
    [
      applySelectionForced,
      applySelectionLocked,
      applySelectionProposed,
      applySessionUpdated,
      patch,
      resetCleared,
      selectionAcknowledged,
      setPaymentDeclineError,
      startOrReplace,
    ]
  );

  return { state, actions };
}
