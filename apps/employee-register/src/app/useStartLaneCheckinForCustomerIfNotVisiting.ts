import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getErrorMessage, isRecord } from '@club-ops/ui';
import type { ActiveCheckinDetails } from '../components/register/modals/AlreadyCheckedInModal';

const API_BASE = '/api';

type StartLaneResponse = {
  sessionId?: string;
  customerName?: string;
  membershipNumber?: string;
  mode?: 'INITIAL' | 'RENEWAL';
  blockEndsAt?: string;
  activeAssignedResourceType?: 'room' | 'locker';
  activeAssignedResourceNumber?: string;
};

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
    if (!customerId) return { mode: 'ERROR', isStarting: false, errorMessage: 'No customer selected.' };
    if (!sessionToken) return { mode: 'ERROR', isStarting: false, errorMessage: 'Not authenticated.' };
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
      setState((prev) => (prev.mode === 'CHECKING_IN' ? { mode: 'CHECKING_IN', isStarting: false } : prev));
      return;
    }

    let cancelled = false;
    lastAttemptKeyRef.current = key;
    setState({ mode: 'CHECKING_IN', isStarting: true });

    void (async () => {
      try {
        const response = await fetch(`${API_BASE}/v1/checkin/lane/${encodeURIComponent(lane)}/start`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify({ customerId }),
        });

        const payload: unknown = await response.json().catch(() => null);

        if (!response.ok) {
          if (response.status === 409 && isRecord(payload) && payload['code'] === 'ALREADY_CHECKED_IN') {
            const ac = payload['activeCheckin'];
            if (isRecord(ac) && typeof ac['visitId'] === 'string') {
              if (!cancelled) {
                setState({ mode: 'ALREADY_VISITING', isStarting: false, activeCheckin: ac as ActiveCheckinDetails });
              }
              return;
            }
          }

          const msg = getErrorMessage(payload) || `Failed to start check-in (HTTP ${response.status})`;
          if (!cancelled) setState({ mode: 'ERROR', isStarting: false, errorMessage: msg });
          return;
        }

        if (!cancelled) {
          setState({ mode: 'CHECKING_IN', isStarting: false });
          if (isRecord(payload)) onStartedRef.current?.(payload as StartLaneResponse);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to start check-in';
        if (!cancelled) setState({ mode: 'ERROR', isStarting: false, errorMessage: msg });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [customerId, sessionToken, lane, key, retryNonce, currentLaneSession.currentSessionId, currentLaneSession.customerId]);

  const retry = useCallback(() => {
    setRetryNonce((n) => n + 1);
    lastAttemptKeyRef.current = null;
  }, []);

  return { state, retry };
}

