import { useState, useEffect, type FormEvent } from 'react';
import {
  isWebAuthnSupported,
  requestAuthenticationOptions,
  getCredential,
  authenticationCredentialToJSON,
  verifyAuthentication,
} from './webauthn';

const API_BASE = '/api';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getErrorMessage(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const err = value['error'];
  const msg = value['message'];
  if (typeof err === 'string' && err.trim()) return err;
  if (typeof msg === 'string' && msg.trim()) return msg;
  return undefined;
}

function parseStaffSession(value: unknown): StaffSession | null {
  if (!isRecord(value)) return null;
  const staffId = value['staffId'];
  const name = value['name'];
  const role = value['role'];
  const sessionToken = value['sessionToken'];
  if (typeof staffId !== 'string') return null;
  if (typeof name !== 'string') return null;
  if (role !== 'STAFF' && role !== 'ADMIN') return null;
  if (typeof sessionToken !== 'string') return null;
  return { staffId, name, role, sessionToken };
}

export interface StaffSession {
  staffId: string;
  name: string;
  role: 'STAFF' | 'ADMIN';
  sessionToken: string;
}

interface LockScreenProps {
  onLogin: (session: StaffSession) => void;
  deviceType: 'tablet' | 'kiosk' | 'desktop';
  deviceId: string;
}

export function LockScreen({ onLogin, deviceId }: LockScreenProps) {
  const [mode, setMode] = useState<'webauthn' | 'pin'>('webauthn');
  const [staffLookup, setStaffLookup] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [webauthnSupported, setWebauthnSupported] = useState(false);

  // Check WebAuthn support on mount
  useEffect(() => {
    setWebauthnSupported(isWebAuthnSupported());
    if (!isWebAuthnSupported()) {
      setMode('pin');
    }
  }, []);

  const handleWebAuthnLogin = async () => {
    if (!staffLookup.trim()) {
      setError('Please enter your name or staff ID');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Request authentication options
      const options = await requestAuthenticationOptions(staffLookup.trim(), deviceId);

      // Get credential from authenticator
      const credential = await getCredential(options);

      // Convert to JSON
      const credentialResponse = authenticationCredentialToJSON(credential);

      // Verify with server
      const result = await verifyAuthentication(deviceId, credentialResponse);

      if (result.verified) {
        onLogin({
          staffId: result.staffId,
          name: result.name,
          role: result.role as 'STAFF' | 'ADMIN',
          sessionToken: result.sessionToken,
        });
      } else {
        throw new Error('Authentication verification failed');
      }
    } catch (error) {
      console.error('WebAuthn login error:', error);
      setError(error instanceof Error ? error.message : 'Fingerprint authentication failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePinSubmit = async (e: FormEvent) => {
    e.preventDefault();
    
    if (!staffLookup.trim() || !pin.trim()) {
      setError('Please enter your name/ID and PIN');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/v1/auth/login-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffLookup: staffLookup.trim(),
          deviceId,
          pin: pin.trim(),
        }),
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Login failed');
      }

      const payload: unknown = await response.json();
      const session = parseStaffSession(payload);
      if (!session) {
        throw new Error('Invalid login response');
      }
      onLogin(session);
      setPin('');
      setStaffLookup('');
    } catch (error) {
      console.error('Login error:', error);
      setError(error instanceof Error ? error.message : 'Invalid credentials');
      setPin('');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="lock-screen">
      <div className="lock-screen-content">
        <div className="lock-screen-header">
          <h1>Staff Login</h1>
          <p>Sign in with fingerprint or PIN</p>
        </div>

        <div className="lock-screen-tabs">
          {webauthnSupported && (
            <button
              className={`tab-button ${mode === 'webauthn' ? 'active' : ''}`}
              onClick={() => {
                setMode('webauthn');
                setError(null);
              }}
              disabled={isLoading}
            >
              Fingerprint
            </button>
          )}
          <button
            className={`tab-button ${mode === 'pin' ? 'active' : ''}`}
            onClick={() => {
              setMode('pin');
              setError(null);
            }}
            disabled={isLoading}
          >
            PIN
          </button>
        </div>

        {error && (
          <div className="lock-screen-error">
            {error}
          </div>
        )}

        {mode === 'webauthn' ? (
          <div className="lock-screen-webauthn">
            <input
              type="text"
              className="staff-lookup-input"
              placeholder="Enter your name or staff ID"
              value={staffLookup}
              onChange={(e) => setStaffLookup(e.target.value)}
              disabled={isLoading}
              autoFocus
            />
            <button
              type="button"
              className="webauthn-button"
              onClick={() => void handleWebAuthnLogin()}
              disabled={isLoading || !staffLookup.trim()}
            >
              {isLoading ? 'Authenticating...' : 'Sign in with fingerprint'}
            </button>
            <button
              type="button"
              className="pin-fallback-button"
              onClick={() => {
                setMode('pin');
                setError(null);
              }}
              disabled={isLoading}
            >
              Use PIN instead
            </button>
          </div>
        ) : (
          <form className="lock-screen-pin" onSubmit={(e) => void handlePinSubmit(e)}>
            <input
              type="text"
              className="staff-lookup-input"
              placeholder="Enter your name or staff ID"
              value={staffLookup}
              onChange={(e) => setStaffLookup(e.target.value)}
              disabled={isLoading}
              autoFocus
            />
            <input
              type="password"
              className="pin-input"
              placeholder="Enter PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              disabled={isLoading}
              maxLength={10}
            />
            <button
              type="submit"
              className="pin-submit-button"
              disabled={isLoading || !pin.trim() || !staffLookup.trim()}
            >
              {isLoading ? 'Logging in...' : 'Login'}
            </button>
            {webauthnSupported && (
              <button
                type="button"
                className="webauthn-fallback-button"
                onClick={() => {
                  setMode('webauthn');
                  setError(null);
                }}
                disabled={isLoading}
              >
                Use fingerprint instead
              </button>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
