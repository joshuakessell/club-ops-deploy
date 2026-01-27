import { useCallback, useEffect, useState } from 'react';
import { getErrorMessage } from '@club-ops/ui';
import { API_BASE } from '../shared/api';
import type { StaffSession } from '../shared/types';
import { generateUUID, parseStaffSession } from '../shared/utils';

type RegisterSession = {
  employeeId: string;
  employeeName: string;
  registerNumber: number;
  deviceId: string;
};

type UseStaffSessionStateParams = {
  currentSessionId: string | null;
  customerName: string;
  checkoutAt: string | null;
};

export function useStaffSessionState({
  currentSessionId,
  customerName,
  checkoutAt,
}: UseStaffSessionStateParams) {
  const [session, setSession] = useState<StaffSession | null>(() => {
    const stored = localStorage.getItem('staff_session');
    if (stored) {
      try {
        const parsed: unknown = JSON.parse(stored) as unknown;
        return parseStaffSession(parsed);
      } catch {
        return null;
      }
    }
    return null;
  });
  const [registerSession, setRegisterSession] = useState<RegisterSession | null>(null);

  const deviceId = useState(() => {
    try {
      const rawEnv = import.meta.env as unknown as Record<string, unknown>;
      const envDeviceId = typeof rawEnv.VITE_DEVICE_ID === 'string' ? rawEnv.VITE_DEVICE_ID : null;
      if (envDeviceId && envDeviceId.trim()) return envDeviceId.trim();

      let baseId: string | null = null;
      try {
        baseId = localStorage.getItem('device_id');
      } catch {
        // localStorage might not be available (e.g., private browsing)
      }

      if (!baseId) {
        baseId = `device-${generateUUID()}`;
        try {
          localStorage.setItem('device_id', baseId);
        } catch {
          // If we can't store it, that's okay - we'll regenerate each time
        }
      }

      let instanceId: string | null = null;
      try {
        instanceId = sessionStorage.getItem('device_instance_id');
      } catch {
        // sessionStorage might not be available
      }

      if (!instanceId) {
        instanceId = generateUUID();
        try {
          sessionStorage.setItem('device_instance_id', instanceId);
        } catch {
          // If we can't store it, that's okay
        }
      }

      return `${baseId}:${instanceId}`;
    } catch (error) {
      console.error('Failed to generate device ID:', error);
      return `device-temp-${generateUUID()}`;
    }
  })[0];

  const lane = registerSession ? `lane-${registerSession.registerNumber}` : 'lane-1';

  const handleRegisterSignIn = useCallback(
    (nextSession: RegisterSession) => {
      setRegisterSession(nextSession);
      const stored = localStorage.getItem('staff_session');
      if (stored) {
        try {
          const parsed: unknown = JSON.parse(stored) as unknown;
          const staffSession = parseStaffSession(parsed);
          if (staffSession) {
            setSession(staffSession);
          }
        } catch {
          setSession(null);
        }
      }
    },
    [setRegisterSession, setSession]
  );

  const handleLogout = useCallback(
    async (options?: { signOutAll?: boolean }) => {
      const inProgress = Boolean(
        currentSessionId && customerName && customerName.trim().length > 0 && !checkoutAt
      );

      if (inProgress) {
        const confirmed = window.confirm(
          'A check-in is still in progress on this lane. Signing out will end the customer kiosk session. Continue?'
        );
        if (!confirmed) return;
        if (!session?.sessionToken) {
          alert('Not authenticated');
          return;
        }
        const resetResponse = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/reset`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.sessionToken}`,
          },
        });
        if (!resetResponse.ok) {
          const errorPayload: unknown = await resetResponse.json().catch(() => null);
          alert(getErrorMessage(errorPayload) || 'Failed to reset lane session');
          return;
        }
      }

      try {
        if (session?.sessionToken) {
          try {
            const endpoint = options?.signOutAll
              ? `${API_BASE}/v1/registers/signout-all`
              : `${API_BASE}/v1/registers/signout`;
            const body = options?.signOutAll ? {} : { deviceId };
            await fetch(endpoint, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${session.sessionToken}`,
              },
              body: JSON.stringify(body),
            });
          } catch (err) {
            console.warn('Register signout failed (continuing):', err);
          }

          await fetch(`${API_BASE}/v1/auth/logout`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${session.sessionToken}`,
            },
          });
        }
      } catch (err) {
        console.warn('Logout failed (continuing):', err);
      } finally {
        localStorage.removeItem('staff_session');
        setSession(null);
        window.location.reload();
      }
    },
    [checkoutAt, currentSessionId, customerName, deviceId, lane, session?.sessionToken]
  );

  const handleCloseOut = useCallback(async () => {
    const confirmed = window.confirm('Close Out: this will sign you out of all registers. Continue?');
    if (!confirmed) return;
    await handleLogout({ signOutAll: true });
  }, [handleLogout]);

  useEffect(() => {
    const stored = localStorage.getItem('staff_session');
    if (stored) {
      try {
        const parsed: unknown = JSON.parse(stored) as unknown;
        setSession(parseStaffSession(parsed));
      } catch {
        setSession(null);
      }
    }
  }, []);

  return {
    session,
    setSession,
    registerSession,
    setRegisterSession,
    deviceId,
    lane,
    handleRegisterSignIn,
    handleLogout,
    handleCloseOut,
  };
}
