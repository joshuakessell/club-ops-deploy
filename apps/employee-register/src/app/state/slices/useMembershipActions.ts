import { getCustomerMembershipStatus } from '@club-ops/shared';
import { getErrorMessage } from '@club-ops/ui';
import { API_BASE } from '../shared/api';
import type { StaffSession } from '../shared/types';

type Params = {
  session: StaffSession | null;
  lane: string;
  currentSessionId: string | null;
  customerName: string;
  membershipNumber: string | null;
  customerMembershipValidUntil: string | null;
  setIsSubmitting: (value: boolean) => void;
  pollOnce: () => Promise<void>;
};

export function useMembershipActions({
  session,
  lane,
  currentSessionId,
  customerName,
  membershipNumber,
  customerMembershipValidUntil,
  setIsSubmitting,
  pollOnce,
}: Params) {
  const highlightKioskOption = async (params: {
    step: 'LANGUAGE' | 'MEMBERSHIP' | 'WAITLIST_BACKUP';
    option: string | null;
  }) => {
    if (!currentSessionId || !session?.sessionToken) return;
    try {
      await fetch(`${API_BASE}/v1/checkin/lane/${lane}/highlight-option`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({ ...params, sessionId: currentSessionId }),
      });
    } catch {
      // Best-effort (UI-only).
    }
  };

  const handleConfirmLanguage = async (lang: 'EN' | 'ES') => {
    if (!currentSessionId || !session?.sessionToken) return;
    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/set-language`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({ language: lang, sessionId: currentSessionId, customerName }),
      });
      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to set language');
      }
      await pollOnce();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to set language');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmMembershipOneTime = async () => {
    if (!currentSessionId || !session?.sessionToken) return;
    setIsSubmitting(true);
    try {
      await fetch(`${API_BASE}/v1/checkin/lane/${lane}/membership-purchase-intent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({ intent: 'NONE', sessionId: currentSessionId }),
      });

      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/membership-choice`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({ choice: 'ONE_TIME', sessionId: currentSessionId }),
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to set membership choice');
      }
      await pollOnce();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to set membership choice');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmMembershipSixMonth = async () => {
    if (!currentSessionId || !session?.sessionToken) return;
    const base = getCustomerMembershipStatus({
      membershipNumber: membershipNumber || null,
      membershipValidUntil: customerMembershipValidUntil,
    });
    const intent: 'PURCHASE' | 'RENEW' = base === 'EXPIRED' ? 'RENEW' : 'PURCHASE';
    setIsSubmitting(true);
    try {
      const response = await fetch(
        `${API_BASE}/v1/checkin/lane/${lane}/membership-purchase-intent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.sessionToken}`,
          },
          body: JSON.stringify({ intent, sessionId: currentSessionId }),
        }
      );
      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(
          getErrorMessage(errorPayload) || 'Failed to set membership purchase intent'
        );
      }
      await pollOnce();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to set membership purchase intent');
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    highlightKioskOption,
    handleConfirmLanguage,
    handleConfirmMembershipOneTime,
    handleConfirmMembershipSixMonth,
  };
}
