import { API_BASE } from '../shared/api';
import type { StaffSession } from '../shared/types';
import type { PaymentQuoteViewModel } from '../../registerLaneSessionReducer';

type PaymentQuote = PaymentQuoteViewModel | null;
type PaymentQuoteSetter = (value: PaymentQuote | ((prev: PaymentQuote) => PaymentQuote)) => void;

type Params = {
  session: StaffSession | null;
  lane: string;
  setCustomerName: (value: string) => void;
  setMembershipNumber: (value: string) => void;
  setCurrentSessionId: (value: string | null) => void;
  setCurrentSessionCustomerId: (value: string | null) => void;
  setAccountCustomerId: (value: string | null) => void;
  setAccountCustomerLabel: (value: string | null) => void;
  setAgreementSigned: (value: boolean) => void;
  setManualEntry: (value: boolean) => void;
  setSelectedRentalType: (value: string | null) => void;
  setCustomerSelectedType: (value: string | null) => void;
  setWaitlistDesiredTier: (value: string | null) => void;
  setWaitlistBackupType: (value: string | null) => void;
  setSelectedInventoryItem: (value: { type: 'room' | 'locker'; id: string; number: string; tier: string } | null) => void;
  setPaymentIntentId: (value: string | null) => void;
  setPaymentQuote: PaymentQuoteSetter;
  setPaymentStatus: (value: 'DUE' | 'PAID' | null) => void;
  setShowCustomerConfirmationPending: (value: boolean) => void;
  setCustomerConfirmationType: (value: { requested: string; selected: string; number: string } | null) => void;
  setShowWaitlistModal: (value: boolean) => void;
};

export function useSessionResetActions({
  session,
  lane,
  setCustomerName,
  setMembershipNumber,
  setCurrentSessionId,
  setCurrentSessionCustomerId,
  setAccountCustomerId,
  setAccountCustomerLabel,
  setAgreementSigned,
  setManualEntry,
  setSelectedRentalType,
  setCustomerSelectedType,
  setWaitlistDesiredTier,
  setWaitlistBackupType,
  setSelectedInventoryItem,
  setPaymentIntentId,
  setPaymentQuote,
  setPaymentStatus,
  setShowCustomerConfirmationPending,
  setCustomerConfirmationType,
  setShowWaitlistModal,
}: Params) {
  const handleClearSession = async () => {
    if (!session?.sessionToken) {
      alert('Not authenticated');
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/reset`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.sessionToken}`,
        },
      });

      if (!response.ok && response.status !== 404) {
        throw new Error('Failed to clear session');
      }

      setCustomerName('');
      setMembershipNumber('');
      setCurrentSessionId(null);
      setCurrentSessionCustomerId(null);
      setAccountCustomerId(null);
      setAccountCustomerLabel(null);
      setAgreementSigned(false);
      setManualEntry(false);
      setSelectedRentalType(null);
      setCustomerSelectedType(null);
      setWaitlistDesiredTier(null);
      setWaitlistBackupType(null);
      setSelectedInventoryItem(null);
      setPaymentIntentId(null);
      setPaymentQuote(null);
      setPaymentStatus(null);
      setShowCustomerConfirmationPending(false);
      setCustomerConfirmationType(null);
      setShowWaitlistModal(false);
      console.log('Session cleared');
    } catch (error) {
      console.error('Failed to clear session:', error);
      alert('Failed to clear session');
    }
  };

  return { handleClearSession };
}
