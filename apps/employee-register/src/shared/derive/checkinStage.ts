import { getCustomerMembershipStatus } from '@club-ops/shared';
import type { CheckinStage } from '../../components/register/CustomerProfileCard';

type CheckinStageInput = {
  currentSessionId: string | null;
  customerName: string;
  assignedResourceType: 'room' | 'locker' | null;
  assignedResourceNumber: string | null;
  agreementSigned: boolean;
  selectionConfirmed: boolean;
  proposedBy: 'CUSTOMER' | 'EMPLOYEE' | null;
  proposedRentalType: string | null;
  customerPrimaryLanguage: 'EN' | 'ES' | undefined;
  membershipNumber: string | null;
  customerMembershipValidUntil: string | null;
  membershipPurchaseIntent: 'PURCHASE' | 'RENEW' | null;
  membershipChoice: 'ONE_TIME' | 'SIX_MONTH' | null;
};

export function deriveCheckinStage(input: CheckinStageInput): CheckinStage | null {
  const {
    currentSessionId,
    customerName,
    assignedResourceType,
    assignedResourceNumber,
    agreementSigned,
    selectionConfirmed,
    proposedBy,
    proposedRentalType,
    customerPrimaryLanguage,
    membershipNumber,
    customerMembershipValidUntil,
    membershipPurchaseIntent,
    membershipChoice,
  } = input;

  if (!currentSessionId || !customerName) return null;

  // 6 - Assigned
  if (assignedResourceType && assignedResourceNumber) {
    return { number: 6, label: 'Locker/Room Assigned' };
  }

  // 5 - Signing agreement (after rental confirmation, before assignment)
  if (agreementSigned) {
    // In practice assignment follows immediately; treat as stage 6 when agreement is already signed.
    return { number: 6, label: 'Locker/Room Assigned' };
  }
  if (selectionConfirmed) {
    return { number: 5, label: 'Signing Member Agreement' };
  }

  // 4 - Employee confirms customer selection
  if (proposedBy === 'CUSTOMER' && proposedRentalType) {
    return { number: 4, label: 'Employee Rental Confirmation' };
  }

  // 1 - Language selection
  if (!customerPrimaryLanguage) {
    return { number: 1, label: 'Language Selection' };
  }

  // 2 - Membership options (only when needed)
  const membershipStatus = getCustomerMembershipStatus(
    {
      membershipNumber: membershipNumber || null,
      membershipValidUntil: customerMembershipValidUntil || null,
    },
    new Date()
  );
  const isMember = membershipPurchaseIntent ? true : membershipStatus === 'ACTIVE';
  if (!isMember && !membershipChoice) {
    return { number: 2, label: 'Membership Options' };
  }

  // 3 - Rental options
  return { number: 3, label: 'Rental Options' };
}
