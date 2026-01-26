import { TransactionCompleteModal } from '../../components/register/modals/TransactionCompleteModal';
import { useEmployeeRegisterState } from '../../app/state/useEmployeeRegisterState';

export function TransactionModal() {
  const {
    agreementSigned,
    selectionConfirmed,
    paymentStatus,
    currentSessionId,
    customerName,
    assignedResourceType,
    assignedResourceNumber,
    membershipChoice,
    proposedRentalType,
    customerSelectedType,
    waitlistDesiredTier,
    waitlistBackupType,
    assignedLabel,
    checkoutAt,
    session,
    currentSessionIdRef,
    isSubmitting,
    agreementBypassPending,
    agreementSignedMethod,
    setDocumentsModalOpen,
    fetchDocumentsBySession,
    handleStartAgreementBypass,
    handleConfirmPhysicalAgreement,
    handleCompleteTransaction,
  } = useEmployeeRegisterState();

  const agreementPending = !agreementSigned && selectionConfirmed && paymentStatus === 'PAID';
  const canShowModal = Boolean(
    currentSessionId &&
    customerName &&
    (agreementPending || (assignedResourceType && assignedResourceNumber))
  );

  return (
    <TransactionCompleteModal
      isOpen={canShowModal}
      agreementPending={agreementPending}
      agreementSigned={agreementSigned}
      agreementBypassPending={agreementBypassPending}
      agreementSignedMethod={agreementSignedMethod}
      selectionSummary={{
        membershipChoice: membershipChoice || null,
        rentalType: proposedRentalType || customerSelectedType || null,
        waitlistDesiredType: waitlistDesiredTier || null,
        waitlistBackupType: waitlistBackupType || null,
      }}
      assignedLabel={assignedLabel}
      assignedNumber={assignedResourceNumber}
      checkoutAt={checkoutAt}
      verifyDisabled={!session?.sessionToken || !currentSessionIdRef.current}
      showComplete={Boolean(agreementSigned && assignedResourceType)}
      completeLabel={isSubmitting ? 'Processing...' : 'Complete Transaction'}
      completeDisabled={isSubmitting}
      showBypassAction={agreementPending && !agreementBypassPending}
      showPhysicalConfirmAction={agreementPending && agreementBypassPending}
      onVerifyAgreementArtifacts={() => {
        const sid = currentSessionIdRef.current;
        if (!sid) return;
        setDocumentsModalOpen(true);
        void fetchDocumentsBySession(sid);
      }}
      onStartAgreementBypass={() => void handleStartAgreementBypass()}
      onConfirmPhysicalAgreement={() => void handleConfirmPhysicalAgreement()}
      onCompleteTransaction={() => void handleCompleteTransaction()}
    />
  );
}
