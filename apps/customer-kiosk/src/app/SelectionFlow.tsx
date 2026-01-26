import { useEffect, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { CustomerConfirmationRequiredPayload } from '@club-ops/shared';
import { getErrorMessage, isRecord } from '@club-ops/ui';
import { t } from '../i18n';
import { UpgradeDisclaimerModal } from '../components/modals/UpgradeDisclaimerModal';
import { CustomerConfirmationModal } from '../components/modals/CustomerConfirmationModal';
import { WaitlistModal } from '../components/modals/WaitlistModal';
import { RenewalDisclaimerModal } from '../components/modals/RenewalDisclaimerModal';
import { MembershipModal } from '../components/modals/MembershipModal';
import { SelectionScreen } from '../screens/SelectionScreen';
import { getMembershipStatus, type SessionState } from '../utils/membership';

interface SelectionFlowProps {
  apiBase: string;
  kioskAuthHeaders: (extra?: Record<string, string>) => Record<string, string>;
  session: SessionState;
  lane: string | null;
  inventory: {
    rooms: Record<string, number>;
    lockers: number;
  } | null;
  selectedRental: string | null;
  proposedRentalType: string | null;
  proposedBy: 'CUSTOMER' | 'EMPLOYEE' | null;
  selectionConfirmed: boolean;
  selectionConfirmedBy: 'CUSTOMER' | 'EMPLOYEE' | null;
  waitlistDesiredType: string | null;
  waitlistBackupType: string | null;
  waitlistPosition: number | null;
  waitlistETA: string | null;
  waitlistUpgradeFee: number | null;
  showWaitlistModal: boolean;
  showUpgradeDisclaimer: boolean;
  upgradeAction: 'waitlist' | null;
  upgradeDisclaimerAcknowledged: boolean;
  showRenewalDisclaimer: boolean;
  showCustomerConfirmation: boolean;
  customerConfirmationData: CustomerConfirmationRequiredPayload | null;
  membershipChoice: 'ONE_TIME' | 'SIX_MONTH' | null;
  showMembershipModal: boolean;
  membershipModalIntent: 'PURCHASE' | 'RENEW' | null;
  highlightedMembershipChoice: 'ONE_TIME' | 'SIX_MONTH' | null;
  highlightedWaitlistBackup: string | null;
  orientationOverlay: ReactNode;
  welcomeOverlay: ReactNode;
  isSubmitting: boolean;
  setIsSubmitting: Dispatch<SetStateAction<boolean>>;
  onSwitchToLanguage: () => void;
  onProceedToAgreement: () => void;
  setProposedRentalType: Dispatch<SetStateAction<string | null>>;
  setProposedBy: Dispatch<SetStateAction<'CUSTOMER' | 'EMPLOYEE' | null>>;
  setSelectionConfirmed: Dispatch<SetStateAction<boolean>>;
  setSelectionConfirmedBy: Dispatch<SetStateAction<'CUSTOMER' | 'EMPLOYEE' | null>>;
  setWaitlistDesiredType: Dispatch<SetStateAction<string | null>>;
  setWaitlistBackupType: Dispatch<SetStateAction<string | null>>;
  setWaitlistPosition: Dispatch<SetStateAction<number | null>>;
  setWaitlistETA: Dispatch<SetStateAction<string | null>>;
  setWaitlistUpgradeFee: Dispatch<SetStateAction<number | null>>;
  setShowWaitlistModal: Dispatch<SetStateAction<boolean>>;
  setShowUpgradeDisclaimer: Dispatch<SetStateAction<boolean>>;
  setUpgradeAction: Dispatch<SetStateAction<'waitlist' | null>>;
  setUpgradeDisclaimerAcknowledged: Dispatch<SetStateAction<boolean>>;
  setShowRenewalDisclaimer: Dispatch<SetStateAction<boolean>>;
  setShowCustomerConfirmation: Dispatch<SetStateAction<boolean>>;
  setCustomerConfirmationData: Dispatch<SetStateAction<CustomerConfirmationRequiredPayload | null>>;
  setMembershipChoice: Dispatch<SetStateAction<'ONE_TIME' | 'SIX_MONTH' | null>>;
  setShowMembershipModal: Dispatch<SetStateAction<boolean>>;
  setMembershipModalIntent: Dispatch<SetStateAction<'PURCHASE' | 'RENEW' | null>>;
  setHighlightedWaitlistBackup: Dispatch<SetStateAction<string | null>>;
  setSession: Dispatch<SetStateAction<SessionState>>;
}

export function SelectionFlow({
  apiBase,
  kioskAuthHeaders,
  session,
  lane,
  inventory,
  selectedRental,
  proposedRentalType,
  proposedBy,
  selectionConfirmed,
  selectionConfirmedBy,
  waitlistDesiredType,
  waitlistBackupType,
  waitlistPosition,
  waitlistETA,
  waitlistUpgradeFee,
  showWaitlistModal,
  showUpgradeDisclaimer,
  upgradeAction,
  upgradeDisclaimerAcknowledged,
  showRenewalDisclaimer,
  showCustomerConfirmation,
  customerConfirmationData,
  membershipChoice,
  showMembershipModal,
  membershipModalIntent,
  highlightedMembershipChoice,
  highlightedWaitlistBackup,
  orientationOverlay,
  welcomeOverlay,
  isSubmitting,
  setIsSubmitting,
  onSwitchToLanguage,
  onProceedToAgreement,
  setProposedRentalType,
  setProposedBy,
  setSelectionConfirmed,
  setSelectionConfirmedBy,
  setWaitlistDesiredType,
  setWaitlistBackupType,
  setWaitlistPosition,
  setWaitlistETA,
  setWaitlistUpgradeFee,
  setShowWaitlistModal,
  setShowUpgradeDisclaimer,
  setUpgradeAction,
  setUpgradeDisclaimerAcknowledged,
  setShowRenewalDisclaimer,
  setShowCustomerConfirmation,
  setCustomerConfirmationData,
  setMembershipChoice,
  setShowMembershipModal,
  setMembershipModalIntent,
  setHighlightedWaitlistBackup,
  setSession,
}: SelectionFlowProps) {
  const handleRentalSelection = async (rental: string) => {
    if (!session.sessionId) {
      alert(t(session.customerPrimaryLanguage, 'error.noActiveSession'));
      return;
    }
    if (!lane) return;

    const availableCount =
      inventory?.rooms?.[rental] ??
      (rental === 'LOCKER' || rental === 'GYM_LOCKER' ? inventory?.lockers : undefined);

    if (availableCount === 0) {
      setWaitlistDesiredType(rental);
      try {
        await fetch(`${apiBase}/v1/checkin/lane/${lane}/waitlist-desired`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...kioskAuthHeaders(),
          },
          body: JSON.stringify({ waitlistDesiredType: rental }),
        });
      } catch {
        // Best-effort; UI can still proceed with local waitlist flow.
      }
      try {
        const response = await fetch(
          `${apiBase}/v1/checkin/lane/${lane}/waitlist-info?desiredTier=${rental}&currentTier=${selectedRental || 'LOCKER'}`
        );
        if (response.ok) {
          const data: unknown = await response.json();
          if (isRecord(data)) {
            setWaitlistPosition(typeof data.position === 'number' ? data.position : null);
            setWaitlistETA(
              typeof data.estimatedReadyAt === 'string' ? data.estimatedReadyAt : null
            );
            setWaitlistUpgradeFee(typeof data.upgradeFee === 'number' ? data.upgradeFee : null);
          }
        }
      } catch (error) {
        console.error('Failed to fetch waitlist info:', error);
      }
      setShowWaitlistModal(true);
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`${apiBase}/v1/checkin/lane/${lane}/propose-selection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...kioskAuthHeaders(),
        },
        body: JSON.stringify({
          rentalType: rental,
          proposedBy: 'CUSTOMER',
        }),
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        if (
          response.status === 409 &&
          isRecord(errorPayload) &&
          errorPayload.code === 'LANGUAGE_REQUIRED'
        ) {
          onSwitchToLanguage();
          alert(t('EN', 'selectLanguage'));
          return;
        }
        throw new Error(getErrorMessage(errorPayload) || 'Failed to propose selection');
      }

      await response.json().catch(() => null);
      const confirmResponse = await fetch(`${apiBase}/v1/checkin/lane/${lane}/confirm-selection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...kioskAuthHeaders(),
        },
        body: JSON.stringify({
          confirmedBy: 'CUSTOMER',
        }),
      });

      if (!confirmResponse.ok) {
        const errorPayload: unknown = await confirmResponse.json().catch(() => null);
        if (
          confirmResponse.status === 409 &&
          isRecord(errorPayload) &&
          errorPayload.code === 'LANGUAGE_REQUIRED'
        ) {
          onSwitchToLanguage();
          alert(t('EN', 'selectLanguage'));
          return;
        }
        throw new Error(getErrorMessage(errorPayload) || 'Failed to confirm selection');
      }

      const confirmPayload: unknown = await confirmResponse.json().catch(() => null);
      const confirmedBy =
        isRecord(confirmPayload) &&
        (confirmPayload.confirmedBy === 'CUSTOMER' || confirmPayload.confirmedBy === 'EMPLOYEE')
          ? confirmPayload.confirmedBy
          : 'CUSTOMER';
      setProposedRentalType(rental);
      setProposedBy('CUSTOMER');
      setSelectionConfirmed(true);
      setSelectionConfirmedBy(confirmedBy);
      setIsSubmitting(false);
    } catch (error) {
      console.error('Failed to propose selection:', error);
      alert(t(session.customerPrimaryLanguage, 'error.processSelection'));
      setIsSubmitting(false);
    }
  };

  const handleDisclaimerAcknowledge = async () => {
    if (!session.sessionId || !upgradeAction) return;
    if (!lane) return;

    try {
      const backupType = waitlistBackupType || selectedRental || 'LOCKER';
      const response = await fetch(`${apiBase}/v1/checkin/lane/${lane}/propose-selection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...kioskAuthHeaders(),
        },
        body: JSON.stringify({
          rentalType: backupType,
          proposedBy: 'CUSTOMER',
          waitlistDesiredType: waitlistDesiredType || undefined,
          backupRentalType: backupType,
        }),
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        if (
          response.status === 409 &&
          isRecord(errorPayload) &&
          errorPayload.code === 'LANGUAGE_REQUIRED'
        ) {
          onSwitchToLanguage();
          alert(t('EN', 'selectLanguage'));
          return;
        }
        throw new Error(getErrorMessage(errorPayload) || 'Failed to process waitlist selection');
      }

      const confirmResponse = await fetch(`${apiBase}/v1/checkin/lane/${lane}/confirm-selection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...kioskAuthHeaders(),
        },
        body: JSON.stringify({
          confirmedBy: 'CUSTOMER',
        }),
      });

      if (!confirmResponse.ok) {
        const errorPayload: unknown = await confirmResponse.json().catch(() => null);
        if (
          confirmResponse.status === 409 &&
          isRecord(errorPayload) &&
          errorPayload.code === 'LANGUAGE_REQUIRED'
        ) {
          onSwitchToLanguage();
          alert(t('EN', 'selectLanguage'));
          return;
        }
        throw new Error(getErrorMessage(errorPayload) || 'Failed to confirm selection');
      }

      const confirmPayload: unknown = await confirmResponse.json().catch(() => null);
      const confirmedBy =
        isRecord(confirmPayload) &&
        (confirmPayload.confirmedBy === 'CUSTOMER' || confirmPayload.confirmedBy === 'EMPLOYEE')
          ? confirmPayload.confirmedBy
          : 'CUSTOMER';
      setUpgradeDisclaimerAcknowledged(true);
      setShowUpgradeDisclaimer(false);
      setUpgradeAction(null);
      setProposedRentalType(backupType);
      setProposedBy('CUSTOMER');
      setSelectionConfirmed(true);
      setSelectionConfirmedBy(confirmedBy);
    } catch (error) {
      console.error('Failed to acknowledge upgrade disclaimer:', error);
      alert(t(session.customerPrimaryLanguage, 'error.process'));
    }
  };

  const handleWaitlistBackupSelection = (rental: string) => {
    if (!session.sessionId || !waitlistDesiredType) return;

    const availableCount =
      inventory?.rooms?.[rental] ??
      (rental === 'LOCKER' || rental === 'GYM_LOCKER' ? inventory?.lockers : undefined);
    if (availableCount === 0) {
      alert(t(session.customerPrimaryLanguage, 'error.rentalNotAvailable'));
      return;
    }

    setWaitlistBackupType(rental);
    setShowWaitlistModal(false);
    setUpgradeAction('waitlist');
    setShowUpgradeDisclaimer(true);
  };

  const handleWaitlistCancel = async () => {
    setShowWaitlistModal(false);
    if (!session.sessionId) {
      setWaitlistDesiredType(null);
      setWaitlistBackupType(null);
      return;
    }
    if (!lane) return;
    try {
      await fetch(`${apiBase}/v1/checkin/lane/${lane}/waitlist-desired`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...kioskAuthHeaders(),
        },
        body: JSON.stringify({ waitlistDesiredType: null, sessionId: session.sessionId }),
      });
    } catch (error) {
      console.error('Failed to clear waitlist selection:', error);
    } finally {
      setWaitlistDesiredType(null);
      setWaitlistBackupType(null);
      setHighlightedWaitlistBackup(null);
    }
  };

  const handleCustomerConfirmSelection = async (confirmed: boolean) => {
    if (!customerConfirmationData?.sessionId) return;
    if (!lane) return;
    setIsSubmitting(true);
    try {
      const response = await fetch(`${apiBase}/v1/checkin/lane/${lane}/customer-confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...kioskAuthHeaders() },
        body: JSON.stringify({
          sessionId: customerConfirmationData.sessionId,
          confirmed,
        }),
      });
      if (response.ok) {
        setShowCustomerConfirmation(false);
        setCustomerConfirmationData(null);
      }
    } catch (error) {
      console.error('Failed to confirm selection:', error);
      alert(t(session.customerPrimaryLanguage, 'error.confirmSelection'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const openMembershipModal = (intent: 'PURCHASE' | 'RENEW') => {
    setMembershipModalIntent(intent);
    setShowMembershipModal(true);
  };

  const handleClearMembershipPurchaseIntent = async () => {
    if (!session.sessionId) return;
    if (!lane) return;
    const lang = session.customerPrimaryLanguage;
    setIsSubmitting(true);
    try {
      const response = await fetch(
        `${apiBase}/v1/checkin/lane/${lane}/membership-purchase-intent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...kioskAuthHeaders() },
          body: JSON.stringify({ intent: 'NONE', sessionId: session.sessionId }),
        }
      );
      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        if (
          response.status === 409 &&
          isRecord(errorPayload) &&
          errorPayload.code === 'LANGUAGE_REQUIRED'
        ) {
          onSwitchToLanguage();
          alert(t('EN', 'selectLanguage'));
          return;
        }
        throw new Error(getErrorMessage(errorPayload) || 'Failed to clear membership intent');
      }
      setSession((prev) => ({ ...prev, membershipPurchaseIntent: null }));
    } catch (error) {
      console.error('Failed to clear membership purchase intent:', error);
      alert(error instanceof Error ? error.message : t(lang, 'error.process'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSelectOneTimeMembership = async () => {
    setMembershipChoice('ONE_TIME');
    if (session.membershipPurchaseIntent) {
      await handleClearMembershipPurchaseIntent();
    }
    if (session.sessionId) {
      if (!lane) return;
      try {
        const response = await fetch(`${apiBase}/v1/checkin/lane/${lane}/membership-choice`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...kioskAuthHeaders() },
          body: JSON.stringify({ choice: 'ONE_TIME', sessionId: session.sessionId }),
        });
        if (!response.ok && response.status === 409) {
          const errorPayload: unknown = await response.json().catch(() => null);
          if (isRecord(errorPayload) && errorPayload.code === 'LANGUAGE_REQUIRED') {
            onSwitchToLanguage();
            alert(t('EN', 'selectLanguage'));
          }
        }
      } catch {
        // Best-effort (UI still works locally).
      }
    }
  };

  const handleMembershipContinue = async () => {
    if (!membershipModalIntent || !session.sessionId) return;
    if (!lane) return;
    const lang = session.customerPrimaryLanguage;
    setIsSubmitting(true);
    try {
      const response = await fetch(
        `${apiBase}/v1/checkin/lane/${lane}/membership-purchase-intent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...kioskAuthHeaders() },
          body: JSON.stringify({ intent: membershipModalIntent, sessionId: session.sessionId }),
        }
      );
      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        if (
          response.status === 409 &&
          isRecord(errorPayload) &&
          errorPayload.code === 'LANGUAGE_REQUIRED'
        ) {
          onSwitchToLanguage();
          alert(t('EN', 'selectLanguage'));
          return;
        }
        throw new Error(getErrorMessage(errorPayload) || 'Failed to request membership purchase');
      }
      setSession((prev) => ({ ...prev, membershipPurchaseIntent: membershipModalIntent }));
      setMembershipChoice('SIX_MONTH');
      setShowMembershipModal(false);
      setMembershipModalIntent(null);
    } catch (error) {
      console.error('Failed to set membership purchase intent:', error);
      alert(error instanceof Error ? error.message : t(lang, 'error.process'));
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    if (!waitlistDesiredType || !waitlistBackupType) return;
    if (upgradeDisclaimerAcknowledged) return;
    if (showUpgradeDisclaimer) return;
    setUpgradeAction('waitlist');
    setShowUpgradeDisclaimer(true);
  }, [
    showUpgradeDisclaimer,
    upgradeDisclaimerAcknowledged,
    waitlistBackupType,
    waitlistDesiredType,
    setShowUpgradeDisclaimer,
    setUpgradeAction,
  ]);

  useEffect(() => {
    if (!waitlistDesiredType) return;
    if (waitlistBackupType) return;
    if (!session.sessionId) return;
    if (!lane) return;
    setShowWaitlistModal(true);
    void (async () => {
      try {
        const response = await fetch(
          `${apiBase}/v1/checkin/lane/${lane}/waitlist-info?desiredTier=${waitlistDesiredType}&currentTier=${selectedRental || 'LOCKER'}`
        );
        if (response.ok) {
          const data: unknown = await response.json();
          if (isRecord(data)) {
            setWaitlistPosition(typeof data.position === 'number' ? data.position : null);
            setWaitlistETA(
              typeof data.estimatedReadyAt === 'string' ? data.estimatedReadyAt : null
            );
            setWaitlistUpgradeFee(typeof data.upgradeFee === 'number' ? data.upgradeFee : null);
          }
        }
      } catch (error) {
        console.error('Failed to fetch waitlist info:', error);
      }
    })();
  }, [
    apiBase,
    lane,
    selectedRental,
    session.sessionId,
    setShowWaitlistModal,
    setWaitlistETA,
    setWaitlistPosition,
    setWaitlistUpgradeFee,
    waitlistBackupType,
    waitlistDesiredType,
  ]);

  const membershipStatus = getMembershipStatus(session, Date.now());
  const isMember = membershipStatus === 'ACTIVE' || membershipStatus === 'PENDING';
  const isExpired = membershipStatus === 'EXPIRED';

  return (
    <>
      <SelectionScreen
        session={session}
        inventory={inventory}
        proposedRentalType={proposedRentalType}
        proposedBy={proposedBy}
        selectionConfirmed={selectionConfirmed}
        selectionConfirmedBy={selectionConfirmedBy}
        selectedRental={selectedRental}
        isSubmitting={isSubmitting}
        orientationOverlay={orientationOverlay}
        welcomeOverlay={welcomeOverlay}
        onSelectRental={(rental) => void handleRentalSelection(rental)}
        membershipChoice={isMember ? null : membershipChoice}
        onSelectOneTimeMembership={() => void handleSelectOneTimeMembership()}
        onSelectSixMonthMembership={() => openMembershipModal(isExpired ? 'RENEW' : 'PURCHASE')}
        highlightedMembershipChoice={highlightedMembershipChoice}
      />
      <UpgradeDisclaimerModal
        isOpen={showUpgradeDisclaimer}
        customerPrimaryLanguage={session.customerPrimaryLanguage}
        onClose={() => setShowUpgradeDisclaimer(false)}
        onAcknowledge={() => void handleDisclaimerAcknowledge()}
        isSubmitting={isSubmitting}
      />
      {customerConfirmationData && (
        <CustomerConfirmationModal
          isOpen={showCustomerConfirmation}
          customerPrimaryLanguage={session.customerPrimaryLanguage}
          data={customerConfirmationData}
          onAccept={() => void handleCustomerConfirmSelection(true)}
          onDecline={() => void handleCustomerConfirmSelection(false)}
          isSubmitting={isSubmitting}
        />
      )}
      {waitlistDesiredType && (
        <WaitlistModal
          isOpen={showWaitlistModal}
          customerPrimaryLanguage={session.customerPrimaryLanguage}
          desiredType={waitlistDesiredType}
          allowedRentals={session.allowedRentals}
          inventory={inventory}
          position={waitlistPosition}
          eta={waitlistETA}
          upgradeFee={waitlistUpgradeFee}
          isSubmitting={isSubmitting}
          highlightedBackupRental={highlightedWaitlistBackup}
          onBackupSelection={handleWaitlistBackupSelection}
          onClose={() => void handleWaitlistCancel()}
        />
      )}
      <RenewalDisclaimerModal
        isOpen={showRenewalDisclaimer}
        customerPrimaryLanguage={session.customerPrimaryLanguage}
        blockEndsAt={session.blockEndsAt}
        onClose={() => setShowRenewalDisclaimer(false)}
        onProceed={() => {
          setShowRenewalDisclaimer(false);
          onProceedToAgreement();
        }}
        isSubmitting={isSubmitting}
      />
      {membershipModalIntent && (
        <MembershipModal
          isOpen={showMembershipModal}
          customerPrimaryLanguage={session.customerPrimaryLanguage}
          intent={membershipModalIntent}
          onContinue={() => void handleMembershipContinue()}
          onClose={() => {
            setShowMembershipModal(false);
            setMembershipModalIntent(null);
          }}
          isSubmitting={isSubmitting}
        />
      )}
    </>
  );
}
