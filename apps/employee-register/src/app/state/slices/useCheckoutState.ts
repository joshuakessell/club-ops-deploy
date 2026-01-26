import { useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '@club-ops/ui';
import type { CheckoutChecklist, CheckoutRequestSummary } from '@club-ops/shared';
import { API_BASE } from '../shared/api';
import type { StaffSession } from '../shared/types';

type Params = {
  session: StaffSession | null;
  setIsSubmitting: (value: boolean) => void;
};

export function useCheckoutState({ session, setIsSubmitting }: Params) {
  const [checkoutRequests, setCheckoutRequests] = useState<Map<string, CheckoutRequestSummary>>(
    new Map()
  );
  const [selectedCheckoutRequest, setSelectedCheckoutRequest] = useState<string | null>(null);
  const [checkoutItemsConfirmed, setCheckoutItemsConfirmed] = useState(false);
  const [checkoutFeePaid, setCheckoutFeePaid] = useState(false);
  const [inventoryHasLate, setInventoryHasLate] = useState(false);
  const [inventoryRefreshNonce, setInventoryRefreshNonce] = useState(0);
  const [, setCheckoutChecklist] = useState<CheckoutChecklist>({});

  const selectedCheckoutRequestRef = useRef<string | null>(null);
  useEffect(() => {
    selectedCheckoutRequestRef.current = selectedCheckoutRequest;
  }, [selectedCheckoutRequest]);

  const handleClaimCheckout = async (requestId: string) => {
    if (!session?.sessionToken) {
      alert('Not authenticated');
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/v1/checkout/${requestId}/claim`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.sessionToken}`,
        },
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to claim checkout');
      }

      await response.json().catch(() => null);
      setSelectedCheckoutRequest(requestId);

      const request = checkoutRequests.get(requestId);
      if (request) {
        setCheckoutChecklist({});
        setCheckoutItemsConfirmed(false);
        setCheckoutFeePaid(false);
      }
    } catch (error) {
      console.error('Failed to claim checkout:', error);
      alert(error instanceof Error ? error.message : 'Failed to claim checkout');
    }
  };

  const handleConfirmItems = async (requestId: string) => {
    if (!session?.sessionToken) {
      alert('Not authenticated');
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/v1/checkout/${requestId}/confirm-items`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.sessionToken}`,
        },
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to confirm items');
      }

      setCheckoutItemsConfirmed(true);
    } catch (error) {
      console.error('Failed to confirm items:', error);
      alert(error instanceof Error ? error.message : 'Failed to confirm items');
    }
  };

  const handleMarkFeePaid = async (requestId: string) => {
    if (!session?.sessionToken) {
      alert('Not authenticated');
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/v1/checkout/${requestId}/mark-fee-paid`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to mark fee as paid');
      }

      setCheckoutFeePaid(true);
    } catch (error) {
      console.error('Failed to mark fee as paid:', error);
      alert(error instanceof Error ? error.message : 'Failed to mark fee as paid');
    }
  };

  const handleCompleteCheckout = async (requestId: string) => {
    if (!session?.sessionToken) {
      alert('Not authenticated');
      return;
    }

    if (!checkoutItemsConfirmed) {
      alert('Please confirm items returned first');
      return;
    }

    const request = checkoutRequests.get(requestId);
    if (request && request.lateFeeAmount > 0 && !checkoutFeePaid) {
      alert('Please mark late fee as paid first');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/checkout/${requestId}/complete`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.sessionToken}`,
        },
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to complete checkout');
      }

      setSelectedCheckoutRequest(null);
      setCheckoutChecklist({});
      setCheckoutItemsConfirmed(false);
      setCheckoutFeePaid(false);
      setInventoryHasLate(false);
      setInventoryRefreshNonce((prev) => prev + 1);
    } catch (error) {
      console.error('Failed to complete checkout:', error);
      alert(error instanceof Error ? error.message : 'Failed to complete checkout');
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    checkoutRequests,
    setCheckoutRequests,
    selectedCheckoutRequest,
    setSelectedCheckoutRequest,
    selectedCheckoutRequestRef,
    checkoutItemsConfirmed,
    setCheckoutItemsConfirmed,
    checkoutFeePaid,
    setCheckoutFeePaid,
    setCheckoutChecklist,
    inventoryHasLate,
    setInventoryHasLate,
    inventoryRefreshNonce,
    setInventoryRefreshNonce,
    handleClaimCheckout,
    handleConfirmItems,
    handleMarkFeePaid,
    handleCompleteCheckout,
  };
}
