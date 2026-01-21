import { useState, useEffect, useCallback, useRef } from 'react';
import { SignInModal } from './SignInModal';
import type { WebSocketEvent, RegisterSessionUpdatedPayload } from '@club-ops/shared';
import { closeLaneSessionClient, useLaneSession } from '@club-ops/shared';
import { safeJsonParse } from '@club-ops/ui';
import { getApiUrl, getWebSocketUrl } from '@/lib/apiBase';

const API_BASE = getApiUrl('/api');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function readJson<T>(response: Response): Promise<T> {
  const data: unknown = await response.json();
  return data as T;
}

interface RegisterSession {
  employeeId: string;
  employeeName: string;
  registerNumber: number;
  deviceId: string;
  pin?: string; // PIN for creating staff session
}

interface RegisterSignInProps {
  deviceId: string;
  onSignedIn: (session: RegisterSession) => void;
  topTitle?: string;
  lane?: string;
  apiStatus?: string | null;
  wsConnected?: boolean;
  onSignOut?: () => void;
  onCloseOut?: () => void;
  children: React.ReactNode;
}

export function RegisterSignIn({
  deviceId,
  onSignedIn,
  topTitle = 'Employee Register',
  lane,
  apiStatus,
  wsConnected,
  onSignOut,
  onCloseOut,
  children,
}: RegisterSignInProps) {
  const [showSignInModal, setShowSignInModal] = useState(false);
  const [registerSession, setRegisterSession] = useState<RegisterSession | null>(null);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
  }, []);

  const handleSessionInvalidated = useCallback(() => {
    // Clear heartbeat interval
    stopHeartbeat();

    // Clear register session state
    setRegisterSession(null);

    // Clear staff session from localStorage
    localStorage.removeItem('staff_session');

    // Return to splash (component will re-render showing sign-in modal)
  }, [stopHeartbeat]);

  const checkRegisterStatus = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch(
        `${API_BASE}/v1/registers/status?deviceId=${encodeURIComponent(deviceId)}`
      );
      if (!response.ok) return false;

      const data = await readJson<{
        signedIn?: boolean;
        employee?: { id?: string; name?: string };
        registerNumber?: number;
      }>(response);
      if (
        data.signedIn &&
        data.employee &&
        typeof data.employee.id === 'string' &&
        typeof data.employee.name === 'string' &&
        typeof data.registerNumber === 'number'
      ) {
        setRegisterSession({
          employeeId: data.employee.id,
          employeeName: data.employee.name,
          registerNumber: data.registerNumber,
          deviceId,
        });
        onSignedIn({
          employeeId: data.employee.id,
          employeeName: data.employee.name,
          registerNumber: data.registerNumber,
          deviceId,
        });
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to check register status:', error);
      return false;
    }
  }, [deviceId, onSignedIn]);

  // Check for existing register session on mount
  useEffect(() => {
    void checkRegisterStatus();
  }, [checkRegisterStatus]);

  const signedInWs = registerSession ? (
    <RegisterSessionWs deviceId={deviceId} onInvalidated={handleSessionInvalidated} />
  ) : null;

  const startHeartbeat = useCallback(() => {
    stopHeartbeat();

    // Send heartbeat every 60 seconds (90 second TTL on server)
    const interval = setInterval(() => {
      void (async () => {
        try {
          const response = await fetch(`${API_BASE}/v1/registers/heartbeat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceId }),
          });

          if (!response.ok) {
            const errorPayload: unknown = await response.json().catch(() => null);
            // If 404 or DEVICE_DISABLED, session is invalid
            if (
              response.status === 404 ||
              (isRecord(errorPayload) && errorPayload.code === 'DEVICE_DISABLED')
            ) {
              handleSessionInvalidated();
              return;
            }
            throw new Error('Heartbeat failed');
          }
        } catch (error) {
          console.error('Heartbeat failed:', error);
          // If heartbeat fails, session may have been cleaned up
          // Check status again
          const stillActive = await checkRegisterStatus();
          if (!stillActive) {
            handleSessionInvalidated();
          }
        }
      })();
    }, 60000);

    heartbeatIntervalRef.current = interval;
  }, [checkRegisterStatus, deviceId, handleSessionInvalidated, stopHeartbeat]);

  // Start/stop heartbeat based on register session
  useEffect(() => {
    if (registerSession) {
      startHeartbeat();
      return () => stopHeartbeat();
    }
    stopHeartbeat();
    return;
  }, [registerSession, startHeartbeat, stopHeartbeat]);

  const handleSignIn = async (session: RegisterSession) => {
    // After register sign-in, also create a staff session for API calls
    if (session.pin) {
      try {
        const response = await fetch(`${API_BASE}/v1/auth/login-pin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            staffLookup: session.employeeId,
            deviceId: session.deviceId,
            pin: session.pin,
          }),
        });

        if (response.ok) {
          const staffSession = await readJson<Record<string, unknown>>(response);
          // Store staff session for API authentication
          localStorage.setItem('staff_session', JSON.stringify(staffSession));
        }
      } catch (error) {
        console.error('Failed to create staff session:', error);
        // Continue anyway - register session is primary
      }
    }

    // Remove PIN from session before storing
    const { pin, ...sessionWithoutPin } = session;
    void pin;
    setRegisterSession(sessionWithoutPin);
    onSignedIn(sessionWithoutPin);
  };

  // If not signed in, show initial state
  if (!registerSession) {
    return (
      <div className="register-sign-in-container">
        <button
          className="register-sign-in-button cs-liquid-button"
          onClick={() => setShowSignInModal(true)}
        >
          Sign In
        </button>
        <SignInModal
          isOpen={showSignInModal}
          onClose={() => setShowSignInModal(false)}
          onSignIn={(s) => void handleSignIn(s)}
          deviceId={deviceId}
        />
      </div>
    );
  }

  // Signed in state
  return (
    <div className="register-sign-in-container">
      <div className="register-top-bar">
        <div className="register-top-bar-left">
          <div className="register-top-bar-title">{topTitle}</div>
        </div>

        <div className="register-top-bar-center">
          <span>
            {registerSession.employeeName} • Register {registerSession.registerNumber}
          </span>

          {import.meta.env.DEV && (
            <span className="register-top-bar-dev">
              {lane ? <span className="cs-badge cs-badge--info">Lane: {lane}</span> : null}
              <span className={`cs-badge ${apiStatus === 'ok' ? 'cs-badge--success' : 'cs-badge--error'}`}>
                API: {apiStatus ?? '...'}
              </span>
              <span className={`cs-badge ${wsConnected ? 'cs-badge--success' : 'cs-badge--error'}`}>
                WS: {wsConnected ? 'Live' : 'Offline'}
              </span>
            </span>
          )}
        </div>

        <div className="register-top-bar-right">
          {onSignOut && (
            <button
              type="button"
              onClick={() => void onSignOut()}
              className="cs-liquid-button cs-liquid-button--secondary er-header-action-btn"
            >
              Sign Out
            </button>
          )}
          {onCloseOut && (
            <button
              type="button"
              onClick={() => void onCloseOut()}
              className="cs-liquid-button cs-liquid-button--danger er-header-action-btn"
            >
              Close Out
            </button>
          )}
        </div>
      </div>

      {signedInWs}
      {children}
    </div>
  );
}

function RegisterSessionWs({
  deviceId,
  onInvalidated,
}: {
  deviceId: string;
  onInvalidated: () => void;
}) {
  const wsUrl = getWebSocketUrl('/ws');
  const rawEnv = import.meta.env as unknown as Record<string, unknown>;
  const kioskToken =
    typeof rawEnv.VITE_KIOSK_TOKEN === 'string' && rawEnv.VITE_KIOSK_TOKEN.trim()
      ? rawEnv.VITE_KIOSK_TOKEN.trim()
      : null;
  void wsUrl;
  const { lastMessage, lastError } = useLaneSession({
    laneId: '',
    role: 'employee',
    kioskToken: kioskToken ?? '',
    enabled: true,
  });

  useEffect(() => {
    if (!lastMessage) return;
    const parsed = safeJsonParse<unknown>(String(lastMessage.data));
    if (!isRecord(parsed) || typeof parsed.type !== 'string') return;
    const message = parsed as unknown as WebSocketEvent;
    if (message.type !== 'REGISTER_SESSION_UPDATED') return;
    const payload = message.payload as RegisterSessionUpdatedPayload;
    if (payload.deviceId === deviceId && !payload.active) {
      closeLaneSessionClient('', 'employee');
      onInvalidated();
    }
  }, [deviceId, lastMessage, onInvalidated]);

  useEffect(() => {
    if (!lastError) return;
    console.error('WebSocket connection error:', lastError);
  }, [lastError]);

  return null;
}
