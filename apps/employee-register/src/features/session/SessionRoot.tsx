import type { ReactNode } from 'react';
import { RegisterSignIn } from '../../RegisterSignIn';
import { useEmployeeRegisterState } from '../../app/state/useEmployeeRegisterState';

export function SessionRoot({ children }: { children: ReactNode }) {
  const {
    deviceId,
    handleRegisterSignIn,
    lane,
    health,
    wsConnected,
    handleLogout,
    handleCloseOut,
    registerSession,
    session,
  } = useEmployeeRegisterState();

  return (
    <RegisterSignIn
      deviceId={deviceId}
      onSignedIn={handleRegisterSignIn}
      topTitle="Employee Register"
      lane={lane}
      apiStatus={health?.status ?? null}
      wsConnected={wsConnected}
      onSignOut={() => void handleLogout()}
      onCloseOut={() => void handleCloseOut()}
    >
      {!registerSession ? (
        <div />
      ) : !session ? (
        <div className="u-p-32 u-text-center u-text-white">Loading...</div>
      ) : (
        children
      )}
    </RegisterSignIn>
  );
}
