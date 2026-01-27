import { useCallback } from 'react';
import type { ScanResult, StaffSession } from '../shared/types';

type Params = {
  session: StaffSession | null;
  openCustomerAccount: (customerId: string, label?: string | null) => void;
  setIsSubmitting: (value: boolean) => void;
};

export function useCustomerSessionActions({
  session,
  openCustomerAccount,
  setIsSubmitting,
}: Params) {
  const startLaneSessionByCustomerId = useCallback(
    (
      customerId: string,
      opts?: { suppressAlerts?: boolean; customerLabel?: string | null }
    ): Promise<ScanResult> => {
      if (!session?.sessionToken) {
        const msg = 'Not authenticated';
        if (!opts?.suppressAlerts) alert(msg);
        return Promise.resolve({ outcome: 'error', message: msg });
      }

      setIsSubmitting(true);
      try {
        openCustomerAccount(customerId, opts?.customerLabel ?? null);
        return Promise.resolve({ outcome: 'matched' });
      } catch (error) {
        console.error('Failed to open customer account:', error);
        const msg = error instanceof Error ? error.message : 'Failed to open customer account';
        if (!opts?.suppressAlerts) alert(msg);
        return Promise.resolve({ outcome: 'error', message: msg });
      } finally {
        setIsSubmitting(false);
      }
    },
    [openCustomerAccount, session?.sessionToken, setIsSubmitting]
  );

  return { startLaneSessionByCustomerId };
}
