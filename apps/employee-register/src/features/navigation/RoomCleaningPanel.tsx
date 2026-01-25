import { RoomCleaningPanel as RoomCleaningPanelComponent } from '../../components/register/panels/RoomCleaningPanel';
import { useEmployeeRegisterState } from '../../app/state/useEmployeeRegisterState';

export function RoomCleaningPanel() {
  const { session, setSuccessToastMessage } = useEmployeeRegisterState();

  if (!session?.sessionToken || !session.staffId) return null;

  return (
    <div className="er-home-panel er-home-panel--top er-home-panel--no-scroll">
      <RoomCleaningPanelComponent
        sessionToken={session.sessionToken}
        staffId={session.staffId}
        onSuccess={(message) => setSuccessToastMessage(message)}
      />
    </div>
  );
}
