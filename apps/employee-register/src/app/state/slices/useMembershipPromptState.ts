import { useEffect, useState } from 'react';
import { getCustomerMembershipStatus } from '@club-ops/shared';
import { getErrorMessage } from '@club-ops/ui';
import { API_BASE } from '../shared/api';
import type { StaffSession } from '../shared/types';

type Params = {
  session: StaffSession | null;
  lane: string;
  currentSessionId: string | null;
  membershipNumber: string | null;
  membershipPurchaseIntent: 'PURCHASE' | 'RENEW' | null;
  paymentStatus: 'DUE' | 'PAID' | null;
  paymentQuote: { lineItems?: Array<{ description: string }> } | null;
  customerMembershipValidUntil: string | null;
};

export function useMembershipPromptState({
  session,
  lane,
  currentSessionId,
  membershipNumber,
  membershipPurchaseIntent,
  paymentStatus,
  paymentQuote,
  customerMembershipValidUntil,
}: Params) {
  const [showMembershipIdPrompt, setShowMembershipIdPrompt] = useState(false);
  const [membershipIdInput, setMembershipIdInput] = useState('');
  const [membershipIdMode, setMembershipIdMode] = useState<'KEEP_EXISTING' | 'ENTER_NEW'>(
    'ENTER_NEW'
  );
  const [membershipIdSubmitting, setMembershipIdSubmitting] = useState(false);
  const [membershipIdError, setMembershipIdError] = useState<string | null>(null);
  const [membershipIdPromptedForSessionId, setMembershipIdPromptedForSessionId] = useState<
    string | null
  >(null);

  const resetMembershipPrompt = () => {
    setShowMembershipIdPrompt(false);
    setMembershipIdInput('');
    setMembershipIdError(null);
    setMembershipIdPromptedForSessionId(null);
  };

  const handleCompleteMembershipPurchase = async (membershipNumberOverride?: string) => {
    if (!session?.sessionToken || !currentSessionId) {
      alert('Not authenticated');
      return;
    }
    const membershipNumberToSave = (membershipNumberOverride ?? membershipIdInput).trim();
    if (!membershipNumberToSave) {
      setMembershipIdError('Membership number is required');
      return;
    }

    setMembershipIdSubmitting(true);
    setMembershipIdError(null);
    try {
      const response = await fetch(
        `${API_BASE}/v1/checkin/lane/${lane}/complete-membership-purchase`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.sessionToken}`,
          },
          body: JSON.stringify({
            sessionId: currentSessionId,
            membershipNumber: membershipNumberToSave,
          }),
        }
      );

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to save membership number');
      }

      await response.json().catch(() => null);
      setShowMembershipIdPrompt(false);
      setMembershipIdInput('');
      setMembershipIdPromptedForSessionId(null);
    } catch (error) {
      console.error('Failed to complete membership purchase:', error);
      setMembershipIdError(
        error instanceof Error ? error.message : 'Failed to save membership number'
      );
    } finally {
      setMembershipIdSubmitting(false);
    }
  };

  useEffect(() => {
    if (!currentSessionId) return;
    if (paymentStatus !== 'PAID') return;
    if (!membershipPurchaseIntent) return;
    if (
      getCustomerMembershipStatus({
        membershipNumber: membershipNumber || null,
        membershipValidUntil: customerMembershipValidUntil,
      }) === 'ACTIVE'
    ) {
      return;
    }
    if (!paymentQuote?.lineItems?.some((li) => li.description === '6 Month Membership')) return;
    if (showMembershipIdPrompt) return;
    if (membershipIdPromptedForSessionId === currentSessionId) return;

    setMembershipIdPromptedForSessionId(currentSessionId);
    if (membershipPurchaseIntent === 'RENEW' && membershipNumber) {
      setMembershipIdMode('KEEP_EXISTING');
      setMembershipIdInput(membershipNumber);
    } else {
      setMembershipIdMode('ENTER_NEW');
      setMembershipIdInput(membershipNumber || '');
    }
    setMembershipIdError(null);
    setShowMembershipIdPrompt(true);
  }, [
    currentSessionId,
    paymentStatus,
    membershipPurchaseIntent,
    paymentQuote,
    showMembershipIdPrompt,
    membershipIdPromptedForSessionId,
    membershipNumber,
    customerMembershipValidUntil,
  ]);

  useEffect(() => {
    if (membershipPurchaseIntent) return;
    if (!showMembershipIdPrompt) return;
    setShowMembershipIdPrompt(false);
    setMembershipIdInput('');
    setMembershipIdMode('ENTER_NEW');
    setMembershipIdError(null);
    setMembershipIdPromptedForSessionId(null);
  }, [membershipPurchaseIntent, showMembershipIdPrompt]);

  return {
    showMembershipIdPrompt,
    setShowMembershipIdPrompt,
    membershipIdMode,
    setMembershipIdMode,
    membershipIdInput,
    setMembershipIdInput,
    membershipIdError,
    setMembershipIdError,
    membershipIdSubmitting,
    handleCompleteMembershipPurchase,
    resetMembershipPrompt,
  };
}
