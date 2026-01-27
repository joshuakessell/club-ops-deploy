import { getErrorMessage } from '@club-ops/ui';
import { API_BASE } from '../shared/api';
import type { StaffSession } from '../shared/types';

type InventoryAvailable = {
  rooms: Record<string, number>;
  rawRooms: Record<string, number>;
  waitlistDemand: Record<string, number>;
  lockers: number;
} | null;

type LaneSessionActions = {
  patch: (payload: Record<string, unknown>) => void;
};

type Params = {
  session: StaffSession | null;
  lane: string;
  currentSessionId: string | null;
  inventoryAvailable: InventoryAvailable;
  waitlistDesiredTier: string | null;
  proposedRentalType: string | null;
  setIsSubmitting: (value: boolean) => void;
  pollOnce: () => Promise<void>;
  setSelectionConfirmed: (value: boolean) => void;
  setCustomerSelectedType: (value: string | null) => void;
  laneSessionActions: LaneSessionActions;
};

export function useSelectionActions({
  session,
  lane,
  currentSessionId,
  inventoryAvailable,
  waitlistDesiredTier,
  proposedRentalType,
  setIsSubmitting,
  pollOnce,
  setSelectionConfirmed,
  setCustomerSelectedType,
  laneSessionActions,
}: Params) {
  const rawEnv = import.meta.env as unknown as Record<string, unknown>;
  const kioskToken =
    typeof rawEnv.VITE_KIOSK_TOKEN === 'string' && rawEnv.VITE_KIOSK_TOKEN.trim()
      ? rawEnv.VITE_KIOSK_TOKEN.trim()
      : null;

  const handleProposeSelection = async (
    rentalType: 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL'
  ) => {
    if (!currentSessionId || !session?.sessionToken) return;
    setIsSubmitting(true);
    try {
      const availableCount =
        inventoryAvailable?.rooms?.[rentalType] ??
        (rentalType === 'LOCKER' ? inventoryAvailable?.lockers : undefined);
      const waitlistDesiredType = availableCount === 0 ? rentalType : undefined;

      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/propose-selection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({ rentalType, proposedBy: 'EMPLOYEE', waitlistDesiredType }),
      });
      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to propose selection');
      }
      await pollOnce();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to propose selection');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCustomerSelectRental = async (
    rentalType: 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL'
  ) => {
    if (!currentSessionId) return;
    setIsSubmitting(true);
    try {
      const availableCount =
        inventoryAvailable?.rooms?.[rentalType] ??
        (rentalType === 'LOCKER' ? inventoryAvailable?.lockers : undefined);
      if (availableCount === 0) {
        await fetch(`${API_BASE}/v1/checkin/lane/${lane}/waitlist-desired`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(typeof kioskToken === 'string' && kioskToken
              ? { 'x-kiosk-token': kioskToken }
              : {}),
          },
          body: JSON.stringify({ waitlistDesiredType: rentalType }),
        });
        await pollOnce();
        return;
      }

      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/propose-selection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(typeof kioskToken === 'string' && kioskToken ? { 'x-kiosk-token': kioskToken } : {}),
        },
        body: JSON.stringify({ rentalType, proposedBy: 'CUSTOMER' }),
      });
      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to select rental');
      }
      const confirmResponse = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/confirm-selection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(typeof kioskToken === 'string' && kioskToken ? { 'x-kiosk-token': kioskToken } : {}),
        },
        body: JSON.stringify({ confirmedBy: 'CUSTOMER' }),
      });
      if (!confirmResponse.ok) {
        const errorPayload: unknown = await confirmResponse.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to confirm selection');
      }
      await pollOnce();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to select rental');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSelectWaitlistBackupAsCustomer = async (
    rentalType: 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL'
  ) => {
    if (!currentSessionId || !waitlistDesiredTier) return;
    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/propose-selection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(typeof kioskToken === 'string' && kioskToken ? { 'x-kiosk-token': kioskToken } : {}),
        },
        body: JSON.stringify({
          rentalType,
          proposedBy: 'CUSTOMER',
          waitlistDesiredType: waitlistDesiredTier,
          backupRentalType: rentalType,
        }),
      });
      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to select waitlist backup');
      }
      const confirmResponse = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/confirm-selection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(typeof kioskToken === 'string' && kioskToken ? { 'x-kiosk-token': kioskToken } : {}),
        },
        body: JSON.stringify({ confirmedBy: 'CUSTOMER' }),
      });
      if (!confirmResponse.ok) {
        const errorPayload: unknown = await confirmResponse.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to confirm selection');
      }
      await pollOnce();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to select waitlist backup');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDirectSelectRental = async (
    rentalType: 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL'
  ) => {
    if (!currentSessionId || !session?.sessionToken) return;
    setIsSubmitting(true);
    try {
      const availableCount =
        inventoryAvailable?.rooms?.[rentalType] ??
        (rentalType === 'LOCKER' ? inventoryAvailable?.lockers : undefined);
      const waitlistDesiredType = availableCount === 0 ? rentalType : undefined;

      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/propose-selection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({ rentalType, proposedBy: 'EMPLOYEE', waitlistDesiredType }),
      });
      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to select rental');
      }

      const confirmResponse = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/confirm-selection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({ confirmedBy: 'EMPLOYEE' }),
      });
      if (!confirmResponse.ok) {
        const errorPayload: unknown = await confirmResponse.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to confirm selection');
      }

      await pollOnce();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to select rental');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDirectSelectWaitlistBackup = async (
    rentalType: 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL'
  ) => {
    if (!currentSessionId || !session?.sessionToken || !waitlistDesiredTier) return;
    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/propose-selection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({
          rentalType,
          proposedBy: 'EMPLOYEE',
          waitlistDesiredType: waitlistDesiredTier,
          backupRentalType: rentalType,
        }),
      });
      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to select waitlist backup');
      }

      const confirmResponse = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/confirm-selection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({ confirmedBy: 'EMPLOYEE' }),
      });
      if (!confirmResponse.ok) {
        const errorPayload: unknown = await confirmResponse.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to confirm selection');
      }

      await pollOnce();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to select waitlist backup');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmSelection = async () => {
    if (!currentSessionId || !session?.sessionToken || !proposedRentalType) {
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/confirm-selection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({
          confirmedBy: 'EMPLOYEE',
        }),
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to confirm selection');
      }

      setSelectionConfirmed(true);
      laneSessionActions.patch({ selectionConfirmedBy: 'EMPLOYEE', selectionAcknowledged: true });
      setCustomerSelectedType(proposedRentalType);
      await pollOnce();
    } catch (error) {
      console.error('Failed to confirm selection:', error);
      alert(
        error instanceof Error ? error.message : 'Failed to confirm selection. Please try again.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartAgreementBypass = async () => {
    if (!currentSessionId || !session?.sessionToken) return;
    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/agreement-bypass`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({ sessionId: currentSessionId }),
      });
      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to bypass agreement');
      }
      await pollOnce();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to bypass agreement');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmPhysicalAgreement = async () => {
    if (!currentSessionId || !session?.sessionToken) return;
    setIsSubmitting(true);
    try {
      const response = await fetch(
        `${API_BASE}/v1/checkin/lane/${lane}/manual-signature-override`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.sessionToken}`,
          },
          body: JSON.stringify({ sessionId: currentSessionId }),
        }
      );
      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to confirm physical agreement');
      }
      await pollOnce();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to confirm physical agreement');
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    handleProposeSelection,
    handleCustomerSelectRental,
    handleSelectWaitlistBackupAsCustomer,
    handleDirectSelectRental,
    handleDirectSelectWaitlistBackup,
    handleConfirmSelection,
    handleStartAgreementBypass,
    handleConfirmPhysicalAgreement,
  };
}
