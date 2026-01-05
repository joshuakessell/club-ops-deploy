import { useState, useEffect, useRef, useCallback } from 'react';
import { SignInModal } from './SignInModal';
import type { WebSocketEvent, RegisterSessionUpdatedPayload } from '@club-ops/shared';

const API_BASE = '/api';

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
  children: React.ReactNode;
}

export function RegisterSignIn({ deviceId, onSignedIn, children }: RegisterSignInProps) {
  const [showSignInModal, setShowSignInModal] = useState(false);
  const [registerSession, setRegisterSession] = useState<RegisterSession | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [heartbeatInterval, setHeartbeatInterval] = useState<NodeJS.Timeout | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  
  const handleSessionInvalidated = useCallback(() => {
    // Clear heartbeat interval
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      setHeartbeatInterval(null);
    }

    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Clear register session state
    setRegisterSession(null);

    // Clear staff session from localStorage
    localStorage.removeItem('staff_session');

    // Return to splash (component will re-render showing sign-in modal)
  }, [heartbeatInterval]);

  const checkRegisterStatus = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch(`${API_BASE}/v1/registers/status?deviceId=${encodeURIComponent(deviceId)}`);
      if (!response.ok) return false;
      
      const data = await readJson<{
        signedIn?: boolean;
        employee?: { id?: string; name?: string };
        registerNumber?: number;
      }>(response);
      if (data.signedIn && data.employee && typeof data.employee.id === 'string' && typeof data.employee.name === 'string' && typeof data.registerNumber === 'number') {
        setRegisterSession({
          employeeId: data.employee.id,
          employeeName: data.employee.name,
          registerNumber: data.registerNumber,
          deviceId,
        });
        startHeartbeat();
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

  // Set up WebSocket subscription for register session updates
  useEffect(() => {
    if (!registerSession) return;

    // Use the Vite proxy path instead of direct connection
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'subscribe',
        events: ['REGISTER_SESSION_UPDATED'],
      }));
    };

    ws.onerror = (error) => {
      console.error('WebSocket connection error:', error);
      // Don't disconnect on error - connection might recover
    };

    ws.onclose = () => {
      // WebSocket closed - this is normal on cleanup
      wsRef.current = null;
    };

    ws.onmessage = (event) => {
      try {
        const parsed: unknown = JSON.parse(String(event.data)) as unknown;
        if (!isRecord(parsed) || typeof parsed.type !== 'string') return;
        const message = parsed as unknown as WebSocketEvent;
        if (message.type === 'REGISTER_SESSION_UPDATED') {
          const payload = message.payload as RegisterSessionUpdatedPayload;
          // If this event targets our device and session is no longer active, sign out
          if (payload.deviceId === deviceId && !payload.active) {
            handleSessionInvalidated();
          }
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      wsRef.current = null;
    };
  }, [registerSession, deviceId, handleSessionInvalidated]);

  const startHeartbeat = () => {
    // Clear existing interval
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }

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
          if (response.status === 404 || (isRecord(errorPayload) && errorPayload.code === 'DEVICE_DISABLED')) {
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

    setHeartbeatInterval(interval);
  };

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
    startHeartbeat();
    onSignedIn(sessionWithoutPin);
  };

  const handleSignOut = async () => {
    try {
      // Get session token from localStorage (from staff session)
      const stored = localStorage.getItem('staff_session');
      if (stored) {
        const parsed: unknown = JSON.parse(stored) as unknown;
        const token = isRecord(parsed) && typeof parsed.sessionToken === 'string' ? parsed.sessionToken : null;
        if (!token) return;
        await fetch(`${API_BASE}/v1/registers/signout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ deviceId }),
        });
      }
    } catch (error) {
      console.error('Sign out error:', error);
    }

    // Clear heartbeat
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      setHeartbeatInterval(null);
    }

    setRegisterSession(null);
    setMenuOpen(false);
    // Clear staff session as well
    localStorage.removeItem('staff_session');
    // Reload to show sign-in screen
    window.location.reload();
  };

  // If not signed in, show initial state
  if (!registerSession) {
    return (
      <div 
        className="register-sign-in-container"
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          background: '#0f172a',
          color: '#e2e8f0',
          position: 'relative',
        }}
      >
        <div 
          className="register-sign-in-logo"
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            fontSize: '3rem',
            fontWeight: 700,
            textAlign: 'center',
            zIndex: 1,
            color: '#e2e8f0',
          }}
        >
          Club Dallas
        </div>
        <button
          className="register-sign-in-button"
          onClick={() => setShowSignInModal(true)}
          style={{
            position: 'absolute',
            top: '60%',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '1rem 2rem',
            background: '#111827',
            color: '#e2e8f0',
            border: '1px solid #1e293b',
            borderRadius: '0.5rem',
            fontSize: '1.125rem',
            fontWeight: 600,
            cursor: 'pointer',
            zIndex: 3,
            transition: 'all 0.2s',
            boxShadow: '0 1px 5px rgba(0, 0, 0, 0.32), 0 2px 2px rgba(0, 0, 0, 0.22)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(148, 163, 184, 0.12)';
            e.currentTarget.style.borderColor = '#3c50e0';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = '#111827';
            e.currentTarget.style.borderColor = '#1e293b';
          }}
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
      <div className="register-sign-in-logo">Club Dallas</div>
      
      <div className="register-top-bar">
        <button
          className="register-menu-button"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Menu"
        >
          ☰
        </button>
        <div className="register-top-bar-center">
          {registerSession.employeeName} • Register {registerSession.registerNumber}
        </div>
        <div style={{ width: '40px' }} /> {/* Spacer for alignment */}
      </div>

      <div className={`register-menu ${menuOpen ? 'open' : ''}`}>
        <button
          className="register-menu-item"
          onClick={() => void handleSignOut()}
        >
          Sign Out
        </button>
      </div>

      {children}
    </div>
  );
}

