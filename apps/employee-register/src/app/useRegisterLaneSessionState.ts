import { useCallback, useMemo, useReducer } from 'react';
import type { SessionUpdatedPayload } from '@club-ops/shared';
import {
  type PaymentQuoteViewModel,
  type RegisterLaneSessionState,
  initialRegisterLaneSessionState,
  registerLaneSessionReducer,
} from './registerLaneSessionReducer';

export type { PaymentQuoteViewModel, RegisterLaneSessionState } from './registerLaneSessionReducer';

export function useRegisterLaneSessionState() {
  const [state, dispatch] = useReducer(registerLaneSessionReducer, initialRegisterLaneSessionState);

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
