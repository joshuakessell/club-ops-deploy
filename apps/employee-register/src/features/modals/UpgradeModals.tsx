import { OfferUpgradeModal } from '../../components/OfferUpgradeModal';
import { WaitlistNoticeModal } from '../../components/register/modals/WaitlistNoticeModal';
import { useEmployeeRegisterState } from '../../app/state/useEmployeeRegisterState';

export function UpgradeModals() {
  const {
    showWaitlistModal,
    waitlistDesiredTier,
    waitlistBackupType,
    setShowWaitlistModal,
    offerUpgradeModal,
    setOfferUpgradeModal,
    session,
    refreshWaitlistAndInventory,
  } = useEmployeeRegisterState();

  return (
    <>
      <WaitlistNoticeModal
        isOpen={showWaitlistModal && !!waitlistDesiredTier && !!waitlistBackupType}
        desiredTier={waitlistDesiredTier || ''}
        backupType={waitlistBackupType || ''}
        onClose={() => setShowWaitlistModal(false)}
      />

      {offerUpgradeModal && session?.sessionToken && (
        <OfferUpgradeModal
          isOpen={true}
          onClose={() => setOfferUpgradeModal(null)}
          sessionToken={session.sessionToken}
          waitlistId={offerUpgradeModal.waitlistId}
          desiredTier={offerUpgradeModal.desiredTier}
          customerLabel={offerUpgradeModal.customerLabel}
          heldRoom={offerUpgradeModal.heldRoom ?? null}
          onOffered={refreshWaitlistAndInventory}
        />
      )}
    </>
  );
}
