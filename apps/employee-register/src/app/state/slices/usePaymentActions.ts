import { useCallback, useEffect, useRef } from 'react';
import { getErrorMessage, readJson } from '@club-ops/ui';
import { RETAIL_CATALOG } from '../../../components/retail/retailCatalog';
import { API_BASE } from '../shared/api';
import type { StaffSession } from '../shared/types';
import type { PaymentQuoteViewModel } from '../../registerLaneSessionReducer';

type PaymentQuote = PaymentQuoteViewModel | null;
type PaymentQuoteSetter = (value: PaymentQuote | ((prev: PaymentQuote) => PaymentQuote)) => void;

type RegisterSession = {
  employeeId: string;
  employeeName: string;
  registerNumber: number;
  deviceId: string;
};

type Params = {
  session: StaffSession | null;
  registerSession: RegisterSession | null;
  lane: string;
  currentSessionId: string | null;
  selectionConfirmed: boolean;
  paymentIntentId: string | null;
  paymentStatus: 'DUE' | 'PAID' | null;
  addOnCart: Record<string, number>;
  setIsSubmitting: (value: boolean) => void;
  setPaymentIntentId: (value: string | null) => void;
  setPaymentQuote: PaymentQuoteSetter;
  setPaymentStatus: (value: 'DUE' | 'PAID' | null) => void;
  setPaymentDeclineError: (value: string | null) => void;
  setSuccessToastMessage: (value: string | null) => void;
  resetAddOnCart: () => void;
  setShowAddOnSaleModal: (value: boolean) => void;
  setCustomerName: (value: string) => void;
  setMembershipNumber: (value: string) => void;
  setCurrentSessionId: (value: string | null) => void;
  setCurrentSessionCustomerId: (value: string | null) => void;
  setAccountCustomerId: (value: string | null) => void;
  setAccountCustomerLabel: (value: string | null) => void;
  setAgreementSigned: (value: boolean) => void;
  setSelectedRentalType: (value: string | null) => void;
  setCustomerSelectedType: (value: string | null) => void;
  setSelectedInventoryItem: (value: { type: 'room' | 'locker'; id: string; number: string; tier: string } | null) => void;
  setAssignedResourceType: (value: 'room' | 'locker' | null) => void;
  setAssignedResourceNumber: (value: string | null) => void;
  setCheckoutAt: (value: string | null) => void;
  setCustomerPrimaryLanguage: (value: 'EN' | 'ES' | undefined) => void;
  setCustomerDobMonthDay: (value: string | undefined) => void;
  setCustomerLastVisitAt: (value: string | undefined) => void;
  setCustomerNotes: (value: string | undefined) => void;
};

export function usePaymentActions({
  session,
  registerSession,
  lane,
  currentSessionId,
  selectionConfirmed,
  paymentIntentId,
  paymentStatus,
  addOnCart,
  setIsSubmitting,
  setPaymentIntentId,
  setPaymentQuote,
  setPaymentStatus,
  setPaymentDeclineError,
  setSuccessToastMessage,
  resetAddOnCart,
  setShowAddOnSaleModal,
  setCustomerName,
  setMembershipNumber,
  setCurrentSessionId,
  setCurrentSessionCustomerId,
  setAccountCustomerId,
  setAccountCustomerLabel,
  setAgreementSigned,
  setSelectedRentalType,
  setCustomerSelectedType,
  setSelectedInventoryItem,
  setAssignedResourceType,
  setAssignedResourceNumber,
  setCheckoutAt,
  setCustomerPrimaryLanguage,
  setCustomerDobMonthDay,
  setCustomerLastVisitAt,
  setCustomerNotes,
}: Params) {
  const paymentIntentCreateInFlightRef = useRef(false);

  const handleCreatePaymentIntent = useCallback(async () => {
    if (!currentSessionId || !session?.sessionToken) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/create-payment-intent`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.sessionToken}`,
        },
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to create payment intent');
      }

      const data = await readJson<{
        paymentIntentId?: string;
        quote?: {
          total: number;
          lineItems: Array<{ description: string; amount: number }>;
          messages: string[];
        };
      }>(response);
      if (typeof data.paymentIntentId === 'string') {
        setPaymentIntentId(data.paymentIntentId);
      }
      setPaymentQuote(data.quote ?? null);
      setPaymentStatus('DUE');
    } catch (error) {
      console.error('Failed to create payment intent:', error);
      alert(error instanceof Error ? error.message : 'Failed to create payment intent');
    }
  }, [currentSessionId, lane, session?.sessionToken, setPaymentIntentId, setPaymentQuote, setPaymentStatus]);

  useEffect(() => {
    if (!currentSessionId || !session?.sessionToken) return;
    if (!selectionConfirmed) return;
    if (paymentIntentId || paymentStatus === 'DUE' || paymentStatus === 'PAID') return;
    if (paymentIntentCreateInFlightRef.current) return;

    paymentIntentCreateInFlightRef.current = true;
    void handleCreatePaymentIntent().finally(() => {
      paymentIntentCreateInFlightRef.current = false;
    });
  }, [
    currentSessionId,
    session?.sessionToken,
    selectionConfirmed,
    paymentIntentId,
    paymentStatus,
    handleCreatePaymentIntent,
  ]);

  const handleAddOnSaleToCheckin = useCallback(async () => {
    if (!currentSessionId || !session?.sessionToken) {
      alert('Not authenticated');
      return;
    }
    if (!paymentIntentId) {
      alert('No active payment intent for this session.');
      return;
    }

    const items = Object.entries(addOnCart)
      .map(([id, quantity]) => {
        const catalogItem = RETAIL_CATALOG.find((item) => item.id === id);
        if (!catalogItem || quantity <= 0) return null;
        return {
          label: catalogItem.label,
          quantity,
          unitPrice: catalogItem.price,
        };
      })
      .filter((item): item is { label: string; quantity: number; unitPrice: number } =>
        Boolean(item)
      );

    if (items.length === 0) {
      alert('Add at least one item to continue.');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/add-ons`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({ sessionId: currentSessionId, items }),
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to add add-on items');
      }

      const payload = await readJson<{
        quote?: {
          total: number;
          lineItems: Array<{ description: string; amount: number }>;
          messages: string[];
        };
      }>(response);

      if (payload.quote) {
        setPaymentQuote(payload.quote);
      }

      setShowAddOnSaleModal(false);
      resetAddOnCart();
      setSuccessToastMessage('Add-on items added to check-in.');
    } catch (error) {
      console.error('Failed to add add-on items:', error);
      alert(error instanceof Error ? error.message : 'Failed to add add-on items');
    } finally {
      setIsSubmitting(false);
    }
  }, [
    addOnCart,
    currentSessionId,
    lane,
    paymentIntentId,
    resetAddOnCart,
    session?.sessionToken,
    setIsSubmitting,
    setPaymentQuote,
    setShowAddOnSaleModal,
    setSuccessToastMessage,
  ]);

  const handleDemoPayment = async (
    outcome: 'CASH_SUCCESS' | 'CREDIT_SUCCESS' | 'CREDIT_DECLINE',
    declineReason?: string
  ) => {
    if (!session?.sessionToken || !currentSessionId) {
      alert('Not authenticated');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/demo-take-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({
          outcome,
          declineReason,
          registerNumber: registerSession?.registerNumber,
        }),
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to process payment');
      }

      if (outcome === 'CREDIT_DECLINE') {
        setPaymentDeclineError(declineReason || 'Payment declined');
      } else {
        setPaymentDeclineError(null);
      }
    } catch (error) {
      console.error('Failed to process payment:', error);
      alert(error instanceof Error ? error.message : 'Failed to process payment');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDemoSplitPayment = async (cardAmount: number): Promise<boolean> => {
    if (!session?.sessionToken || !currentSessionId) {
      alert('Not authenticated');
      return false;
    }

    const roundedAmount = Math.round(cardAmount * 100) / 100;
    if (!Number.isFinite(roundedAmount) || roundedAmount <= 0) {
      alert('Enter a valid card amount.');
      return false;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/demo-take-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({
          outcome: 'CREDIT_SUCCESS',
          splitCardAmount: roundedAmount,
          registerNumber: registerSession?.registerNumber,
        }),
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to process split payment');
      }

      const payload = await readJson<{
        quote?: {
          total: number;
          lineItems: Array<{ description: string; amount: number }>;
          messages: string[];
        };
      }>(response);

      if (payload.quote) {
        setPaymentQuote(payload.quote);
      }

      setPaymentDeclineError(null);
      return true;
    } catch (error) {
      console.error('Failed to process split payment:', error);
      alert(error instanceof Error ? error.message : 'Failed to process split payment');
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCompleteTransaction = async () => {
    if (!session?.sessionToken) {
      alert('Not authenticated');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/reset`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.sessionToken}`,
        },
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to complete transaction');
      }

      setCustomerName('');
      setMembershipNumber('');
      setCurrentSessionId(null);
      setCurrentSessionCustomerId(null);
      setAccountCustomerId(null);
      setAccountCustomerLabel(null);
      setAgreementSigned(false);
      setSelectedRentalType(null);
      setCustomerSelectedType(null);
      setSelectedInventoryItem(null);
      setPaymentIntentId(null);
      setPaymentQuote(null);
      setPaymentStatus(null);
      resetAddOnCart();
      setShowAddOnSaleModal(false);
      setAssignedResourceType(null);
      setAssignedResourceNumber(null);
      setCheckoutAt(null);
      setCustomerPrimaryLanguage(undefined);
      setCustomerDobMonthDay(undefined);
      setCustomerLastVisitAt(undefined);
      setCustomerNotes(undefined);
      setPaymentDeclineError(null);
    } catch (error) {
      console.error('Failed to complete transaction:', error);
      alert(error instanceof Error ? error.message : 'Failed to complete transaction');
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    handleAddOnSaleToCheckin,
    handleDemoPayment,
    handleDemoSplitPayment,
    handleCompleteTransaction,
  };
}
