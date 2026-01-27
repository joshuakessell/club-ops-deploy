import { useEffect, useMemo, useRef, useState } from 'react';
import { getErrorMessage, readJson } from '@club-ops/ui';
import { deriveWaitlistEligibility } from '../../../shared/derive/waitlistEligibility';
import { API_BASE } from '../shared/api';
import type { HomeTab, StaffSession } from '../shared/types';
import { useWaitlistDataState, type WaitlistEntry } from './useWaitlistDataState';

type RegisterSession = {
  employeeId: string;
  employeeName: string;
  registerNumber: number;
  deviceId: string;
};

type Params = {
  session: StaffSession | null;
  registerSession: RegisterSession | null;
  sessionActive: boolean;
  selectHomeTab: (tab: HomeTab) => void;
  setIsSubmitting: (value: boolean) => void;
  setPaymentDeclineError: (value: string | null) => void;
  onUnauthorized?: () => void;
};

export function useWaitlistUpgradeState({
  session,
  registerSession,
  sessionActive,
  selectHomeTab,
  setIsSubmitting,
  setPaymentDeclineError,
  onUnauthorized,
}: Params) {
  const {
    waitlistEntries,
    inventoryAvailable,
    showWaitlistModal,
    setShowWaitlistModal,
    refreshWaitlistAndInventory,
    refreshInventoryAvailable,
  } = useWaitlistDataState({ session, registerSession, onUnauthorized });

  const [, setSelectedWaitlistEntry] = useState<string | null>(null);
  const [upgradePaymentIntentId, setUpgradePaymentIntentId] = useState<string | null>(null);
  const [upgradeFee, setUpgradeFee] = useState<number | null>(null);
  const [upgradePaymentStatus, setUpgradePaymentStatus] = useState<'DUE' | 'PAID' | null>(null);
  const [upgradeOriginalCharges, setUpgradeOriginalCharges] = useState<
    Array<{ description: string; amount: number }>
  >([]);
  const [upgradeOriginalTotal, setUpgradeOriginalTotal] = useState<number | null>(null);
  const [showUpgradePaymentModal, setShowUpgradePaymentModal] = useState(false);
  const [upgradeContext, setUpgradeContext] = useState<{
    waitlistId: string;
    customerLabel: string;
    offeredRoomNumber?: string | null;
    newRoomNumber?: string | null;
  } | null>(null);
  const [, setShowUpgradePulse] = useState(false);
  const [offerUpgradeModal, setOfferUpgradeModal] = useState<{
    waitlistId: string;
    desiredTier: 'STANDARD' | 'DOUBLE' | 'SPECIAL';
    customerLabel?: string;
    heldRoom?: { id: string; number: string } | null;
  } | null>(null);

  const { isEntryOfferEligible, hasEligibleEntries } = useMemo(
    () =>
      deriveWaitlistEligibility(
        waitlistEntries,
        inventoryAvailable ? { rawRooms: inventoryAvailable.rawRooms } : null
      ),
    [inventoryAvailable, waitlistEntries]
  );
  const prevSessionActiveRef = useRef<boolean>(false);
  const pulseCandidateRef = useRef<boolean>(false);

  const dismissUpgradePulse = () => {
    pulseCandidateRef.current = false;
    setShowUpgradePulse(false);
  };

  const resetUpgradeState = () => {
    setUpgradePaymentIntentId(null);
    setUpgradeFee(null);
    setUpgradePaymentStatus(null);
    setUpgradeOriginalCharges([]);
    setUpgradeOriginalTotal(null);
    setShowUpgradePaymentModal(false);
    setUpgradeContext(null);
  };

  const openOfferUpgradeModal = (entry: WaitlistEntry) => {
    if (
      entry.desiredTier !== 'STANDARD' &&
      entry.desiredTier !== 'DOUBLE' &&
      entry.desiredTier !== 'SPECIAL'
    ) {
      alert('Only STANDARD/DOUBLE/SPECIAL upgrades can be offered.');
      return;
    }
    dismissUpgradePulse();
    setOfferUpgradeModal({
      waitlistId: entry.id,
      desiredTier: entry.desiredTier,
      customerLabel: entry.customerName || entry.displayIdentifier,
      heldRoom:
        entry.status === 'OFFERED' && entry.roomId && entry.offeredRoomNumber
          ? { id: entry.roomId, number: entry.offeredRoomNumber }
          : null,
    });
  };

  useEffect(() => {
    const prev = prevSessionActiveRef.current;
    if (prev && !sessionActive) {
      pulseCandidateRef.current = true;
    }
    prevSessionActiveRef.current = sessionActive;
  }, [sessionActive]);

  useEffect(() => {
    if (pulseCandidateRef.current && !sessionActive && hasEligibleEntries) {
      setShowUpgradePulse(true);
      pulseCandidateRef.current = false;
    }
  }, [hasEligibleEntries, sessionActive]);

  const handleStartUpgradePayment = async (entry: WaitlistEntry) => {
    if (!session?.sessionToken) {
      alert('Not authenticated');
      return;
    }
    if (!entry.roomId) {
      alert('No reserved room found for this offer. Refresh and retry.');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/upgrades/fulfill`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({
          waitlistId: entry.id,
          roomId: entry.roomId,
          acknowledgedDisclaimer: true,
        }),
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to start upgrade');
      }

      const payload = await readJson<{
        paymentIntentId?: string;
        upgradeFee?: number;
        originalCharges?: Array<{ description: string; amount: number }>;
        originalTotal?: number | null;
        newRoomNumber?: string | null;
      }>(response);

      setSelectedWaitlistEntry(entry.id);
      const intentId = payload.paymentIntentId ?? null;
      setUpgradePaymentIntentId(intentId);
      setUpgradeFee(
        typeof payload.upgradeFee === 'number' && Number.isFinite(payload.upgradeFee)
          ? payload.upgradeFee
          : null
      );
      setUpgradePaymentStatus(intentId ? 'DUE' : null);
      setUpgradeOriginalCharges(payload.originalCharges || []);
      setUpgradeOriginalTotal(
        typeof payload.originalTotal === 'number' && Number.isFinite(payload.originalTotal)
          ? payload.originalTotal
          : null
      );
      setUpgradeContext({
        waitlistId: entry.id,
        customerLabel: entry.customerName || entry.displayIdentifier,
        offeredRoomNumber: entry.offeredRoomNumber,
        newRoomNumber: payload.newRoomNumber ?? entry.offeredRoomNumber ?? null,
      });
      dismissUpgradePulse();
      selectHomeTab('upgrades');
      setShowUpgradePaymentModal(true);
    } catch (error) {
      console.error('Failed to start upgrade:', error);
      alert(error instanceof Error ? error.message : 'Failed to start upgrade');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpgradePaymentDecline = (reason?: string) => {
    setPaymentDeclineError(reason || 'Payment declined');
    setUpgradePaymentStatus('DUE');
  };

  const handleUpgradePaymentFlow = async (method: 'CREDIT' | 'CASH') => {
    if (!upgradePaymentIntentId || !session?.sessionToken || !upgradeContext) {
      alert('No upgrade payment intent available.');
      return;
    }

    setIsSubmitting(true);
    try {
      const markPaidResponse = await fetch(
        `${API_BASE}/v1/payments/${upgradePaymentIntentId}/mark-paid`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.sessionToken}`,
          },
          body: JSON.stringify({
            squareTransactionId: method === 'CASH' ? 'demo-cash-success' : 'demo-credit-success',
          }),
        }
      );

      if (!markPaidResponse.ok) {
        const errorPayload: unknown = await markPaidResponse.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to mark upgrade payment as paid');
      }

      setUpgradePaymentStatus('PAID');

      const completeResponse = await fetch(`${API_BASE}/v1/upgrades/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({
          waitlistId: upgradeContext.waitlistId,
          paymentIntentId: upgradePaymentIntentId,
        }),
      });

      if (!completeResponse.ok) {
        const errorPayload: unknown = await completeResponse.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to complete upgrade');
      }

      resetUpgradeState();
      setSelectedWaitlistEntry(null);
      setShowUpgradePaymentModal(false);
      refreshWaitlistAndInventory();
      dismissUpgradePulse();
    } catch (error) {
      console.error('Failed to process upgrade payment:', error);
      alert(error instanceof Error ? error.message : 'Failed to process upgrade payment');
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    waitlistEntries,
    setSelectedWaitlistEntry,
    inventoryAvailable,
    showWaitlistModal,
    setShowWaitlistModal,
    offerUpgradeModal,
    setOfferUpgradeModal,
    openOfferUpgradeModal,
    upgradeContext,
    showUpgradePaymentModal,
    setShowUpgradePaymentModal,
    upgradeOriginalCharges,
    upgradeOriginalTotal,
    upgradeFee,
    upgradePaymentStatus,
    upgradePaymentIntentId,
    resetUpgradeState,
    dismissUpgradePulse,
    handleStartUpgradePayment,
    handleUpgradePaymentFlow,
    handleUpgradePaymentDecline,
    isEntryOfferEligible,
    hasEligibleEntries,
    refreshWaitlistAndInventory,
    refreshInventoryAvailable,
  };
}
