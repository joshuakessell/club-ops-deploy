import { RoomCleaningPanel as RoomCleaningPanelComponent } from '../../components/register/panels/RoomCleaningPanel';
import { useEmployeeRegisterState } from '../../app/state/useEmployeeRegisterState';
import { PanelShell } from '../../views/PanelShell';

export function RoomCleaningPanel() {
  const { session, setSuccessToastMessage } = useEmployeeRegisterState();

  if (!session?.sessionToken || !session.staffId) return null;

  return (
    <PanelShell align="top" scroll="hidden" card={false}>
      <RoomCleaningPanelComponent
        sessionToken={session.sessionToken}
        staffId={session.staffId}
        onSuccess={(message) => setSuccessToastMessage(message)}
      />
    </PanelShell>
  );
}
