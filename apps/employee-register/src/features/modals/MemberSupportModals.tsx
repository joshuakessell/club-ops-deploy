import { AddNoteModal } from '../../components/register/modals/AddNoteModal';
import { ManagerBypassModal } from '../../components/register/modals/ManagerBypassModal';
import { MembershipIdPromptModal } from '../../components/register/modals/MembershipIdPromptModal';
import { useEmployeeRegisterState } from '../../app/state/useEmployeeRegisterState';

export function MemberSupportModals() {
  const {
    showMembershipIdPrompt,
    membershipIdMode,
    membershipIdInput,
    membershipNumber,
    membershipPurchaseIntent,
    membershipIdError,
    membershipIdSubmitting,
    setMembershipIdMode,
    setMembershipIdInput,
    setMembershipIdError,
    handleCompleteMembershipPurchase,
    showManagerBypassModal,
    managerList,
    managerId,
    managerPin,
    setManagerId,
    setManagerPin,
    handleManagerBypass,
    isSubmitting,
    showAddNoteModal,
    newNoteText,
    setNewNoteText,
    handleAddNote,
    setShowAddNoteModal,
    setShowManagerBypassModal,
    setShowMembershipIdPrompt,
  } = useEmployeeRegisterState();

  return (
    <>
      <MembershipIdPromptModal
        isOpen={showMembershipIdPrompt}
        membershipIdMode={membershipIdMode}
        membershipIdInput={membershipIdInput}
        membershipNumber={membershipNumber}
        membershipPurchaseIntent={membershipPurchaseIntent}
        error={membershipIdError}
        isSubmitting={membershipIdSubmitting}
        onModeChange={(mode) => {
          setMembershipIdMode(mode);
          if (mode === 'KEEP_EXISTING' && membershipNumber) {
            setMembershipIdInput(membershipNumber);
          } else {
            setMembershipIdInput('');
          }
          setMembershipIdError(null);
        }}
        onInputChange={setMembershipIdInput}
        onConfirm={(membershipId) => void handleCompleteMembershipPurchase(membershipId)}
        onNotNow={() => {
          setShowMembershipIdPrompt(false);
          setMembershipIdError(null);
        }}
      />

      <ManagerBypassModal
        isOpen={showManagerBypassModal}
        managers={managerList}
        managerId={managerId}
        managerPin={managerPin}
        onChangeManagerId={setManagerId}
        onChangeManagerPin={setManagerPin}
        onBypass={() => void handleManagerBypass()}
        onCancel={() => {
          setShowManagerBypassModal(false);
          setManagerId('');
          setManagerPin('');
        }}
        isSubmitting={isSubmitting}
      />

      <AddNoteModal
        isOpen={showAddNoteModal}
        noteText={newNoteText}
        onChangeNoteText={setNewNoteText}
        onSubmit={() => void handleAddNote()}
        onCancel={() => {
          setShowAddNoteModal(false);
          setNewNoteText('');
        }}
        isSubmitting={isSubmitting}
      />
    </>
  );
}
