import { useEffect, useState } from 'react';
import { getErrorMessage, isRecord } from '@club-ops/ui';
import { API_BASE } from '../shared/api';
import type { StaffSession } from '../shared/types';

type Params = {
  session: StaffSession | null;
  lane: string;
  currentSessionId: string | null;
  pastDueBlocked: boolean;
  pastDueBalance: number;
  setPaymentDeclineError: (value: string | null) => void;
  setIsSubmitting: (value: boolean) => void;
};

export function usePastDueState({
  session,
  lane,
  currentSessionId,
  pastDueBlocked,
  pastDueBalance,
  setPaymentDeclineError,
  setIsSubmitting,
}: Params) {
  const [showPastDueModal, setShowPastDueModal] = useState(false);
  const [showManagerBypassModal, setShowManagerBypassModal] = useState(false);
  const [managerId, setManagerId] = useState('');
  const [managerPin, setManagerPin] = useState('');
  const [managerList, setManagerList] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    if (pastDueBlocked && pastDueBalance > 0) {
      setShowPastDueModal(true);
    }
  }, [pastDueBlocked, pastDueBalance]);

  const handlePastDuePayment = async (
    outcome: 'CASH_SUCCESS' | 'CREDIT_SUCCESS' | 'CREDIT_DECLINE',
    declineReason?: string
  ) => {
    if (!session?.sessionToken || !currentSessionId) {
      alert('Not authenticated');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/past-due/demo-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({ outcome, declineReason }),
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to process payment');
      }

      if (outcome === 'CREDIT_DECLINE') {
        setPaymentDeclineError(declineReason || 'Payment declined');
      } else {
        setShowPastDueModal(false);
        setPaymentDeclineError(null);
      }
    } catch (error) {
      console.error('Failed to process past-due payment:', error);
      alert(error instanceof Error ? error.message : 'Failed to process payment');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleManagerBypass = async () => {
    if (!session?.sessionToken || !currentSessionId || !managerId || !managerPin) {
      alert('Please select manager and enter PIN');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/past-due/bypass`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({ managerId, managerPin }),
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to bypass past-due');
      }

      setShowPastDueModal(false);
      setShowManagerBypassModal(false);
      setManagerId('');
      setManagerPin('');
      setPaymentDeclineError(null);
    } catch (error) {
      console.error('Failed to bypass past-due:', error);
      alert(error instanceof Error ? error.message : 'Failed to bypass past-due');
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    if (showManagerBypassModal && session?.sessionToken) {
      fetch(`${API_BASE}/v1/employees/available`, {
        headers: {
          Authorization: `Bearer ${session.sessionToken}`,
        },
      })
        .then((res) => res.json())
        .then((data: unknown) => {
          if (!isRecord(data) || !Array.isArray(data.employees)) {
            setManagerList([]);
            return;
          }
          const managers = data.employees
            .filter(
              (e): e is { id: string; name: string; role: string } =>
                isRecord(e) && typeof e.role === 'string'
            )
            .filter((e) => e.role === 'ADMIN')
            .map((e) => ({ id: String(e.id), name: String(e.name) }));
          setManagerList(managers);
        })
        .catch(console.error);
    }
  }, [showManagerBypassModal, session?.sessionToken]);

  return {
    showPastDueModal,
    setShowPastDueModal,
    showManagerBypassModal,
    setShowManagerBypassModal,
    managerId,
    managerPin,
    setManagerId,
    setManagerPin,
    managerList,
    handlePastDuePayment,
    handleManagerBypass,
  };
}
