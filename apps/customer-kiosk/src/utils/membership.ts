import { getCustomerMembershipStatus } from '@club-ops/shared';
import type { Language } from '../i18n';

export interface SessionState {
  sessionId: string | null;
  customerName: string | null;
  membershipNumber: string | null;
  membershipValidUntil?: string | null; // YYYY-MM-DD (customer membership expiration)
  membershipChoice?: 'ONE_TIME' | 'SIX_MONTH' | null;
  membershipPurchaseIntent?: 'PURCHASE' | 'RENEW' | null;
  kioskAcknowledgedAt?: string | null;
  allowedRentals: string[];
  visitId?: string;
  mode?: 'CHECKIN' | 'RENEWAL';
  blockEndsAt?: string; // ISO timestamp of when current block ends
  customerPrimaryLanguage?: Language | null;
  pastDueBlocked?: boolean;
  pastDueBalance?: number;
  paymentStatus?: 'DUE' | 'PAID';
  paymentTotal?: number;
  paymentLineItems?: Array<{ description: string; amount: number }>;
  paymentFailureReason?: string;
  agreementSigned?: boolean;
  agreementBypassPending?: boolean;
  agreementSignedMethod?: 'DIGITAL' | 'MANUAL';
  assignedResourceType?: 'room' | 'locker';
  assignedResourceNumber?: string;
  checkoutAt?: string;
}

export function getMembershipStatus(
  session: SessionState,
  nowMs: number
): 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'NON_MEMBER' {
  if (session.membershipPurchaseIntent) return 'PENDING';
  const base = getCustomerMembershipStatus(
    { membershipNumber: session.membershipNumber, membershipValidUntil: session.membershipValidUntil },
    new Date(nowMs)
  );
  if (base === 'ACTIVE') return 'ACTIVE';
  if (base === 'EXPIRED') return 'EXPIRED';
  return 'NON_MEMBER';
}
