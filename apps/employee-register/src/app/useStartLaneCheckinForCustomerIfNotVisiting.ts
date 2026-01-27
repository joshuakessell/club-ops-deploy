import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ActiveCheckinDetails } from '../components/register/modals/AlreadyCheckedInModal';
import { startLaneCheckin, type StartLaneResponse } from './startLaneCheckin';

export type StartLaneCheckinState =
  | { mode: 'CHECKING_IN'; isStarting: boolean }
  | { mode: 'ALREADY_VISITING'; isStarting: false; activeCheckin: ActiveCheckinDetails }
  | { mode: 'ERROR'; isStarting: false; errorMessage: string };

export function useStartLaneCheckinForCustomerIfNotVisiting(params: {
  lane: string;
  sessionToken: string | null | undefined;
  customerId: string | null | undefined;
  /**
   * Used for idempotence: if a lane session is already active for this same customer, do not restart.
   */
  currentLaneSession: { currentSessionId: string | null; customerId: string | null };
  onStarted?: (data: StartLaneResponse) => void;
}) {
  const { lane, sessionToken, customerId, currentLaneSession, onStarted } = params;
  const onStartedRef = useRef<typeof onStarted>(onStarted);
  useEffect(() => {
    onStartedRef.current = onStarted;
  }, [onStarted]);

  const key = useMemo(() => `${lane}::${customerId ?? ''}`, [lane, customerId]);
  const [retryNonce, setRetryNonce] = useState(0);
  const lastAttemptKeyRef = useRef<string | null>(null);

  const [state, setState] = useState<StartLaneCheckinState>(() => {
    if (!customerId)
      return { mode: 'ERROR', isStarting: false, errorMessage: 'No customer selected.' };
    if (!sessionToken)
      return { mode: 'ERROR', isStarting: false, errorMessage: 'Not authenticated.' };
    return { mode: 'CHECKING_IN', isStarting: true };
  });

  // Reset state when target customer changes.
  useEffect(() => {
    if (!customerId) {
      setState({ mode: 'ERROR', isStarting: false, errorMessage: 'No customer selected.' });
      return;
    }
    if (!sessionToken) {
      setState({ mode: 'ERROR', isStarting: false, errorMessage: 'Not authenticated.' });
      return;
    }
    // New customer selection: start in CHECKING_IN and let the effect decide whether it needs to POST /start.
    setState({ mode: 'CHECKING_IN', isStarting: true });
    lastAttemptKeyRef.current = null;
  }, [customerId, sessionToken, key]);

  useEffect(() => {
    if (!customerId || !sessionToken) return;

    // Idempotent guard: if we already have a lane session for this same customer, don't restart.
    if (currentLaneSession.currentSessionId && currentLaneSession.customerId === customerId) {
      setState({ mode: 'CHECKING_IN', isStarting: false });
      return;
    }

    // Prevent repeated attempts for the same customer unless explicitly retried.
    if (lastAttemptKeyRef.current === key && retryNonce === 0) {
      setState((prev) =>
        prev.mode === 'CHECKING_IN' ? { mode: 'CHECKING_IN', isStarting: false } : prev
      );
      return;
    }

    let cancelled = false;
    lastAttemptKeyRef.current = key;
    setState({ mode: 'CHECKING_IN', isStarting: true });

    void (async () => {
      try {
        const result = await startLaneCheckin({ lane, sessionToken, customerId });
        if (cancelled) return;

        if (result.kind === 'already-visiting') {
          setState({
            mode: 'ALREADY_VISITING',
            isStarting: false,
            activeCheckin: result.activeCheckin,
          });
          return;
        }

        if (result.kind === 'error') {
          setState({ mode: 'ERROR', isStarting: false, errorMessage: result.message });
          return;
        }

        setState({ mode: 'CHECKING_IN', isStarting: false });
        if (result.payload) onStartedRef.current?.(result.payload);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to start check-in';
        if (!cancelled) setState({ mode: 'ERROR', isStarting: false, errorMessage: msg });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    customerId,
    sessionToken,
    lane,
    key,
    retryNonce,
    currentLaneSession.currentSessionId,
    currentLaneSession.customerId,
  ]);

  const retry = useCallback(() => {
    setRetryNonce((n) => n + 1);
    lastAttemptKeyRef.current = null;
  }, []);

  return { state, retry };
}
