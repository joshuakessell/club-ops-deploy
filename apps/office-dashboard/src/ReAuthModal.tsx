import { useState, useEffect } from 'react';

const API_BASE = '/api';

interface ReAuthModalProps {
  sessionToken: string;
  onSuccess: () => void;
  onCancel: () => void;
}

type AuthMethod = 'webauthn' | 'pin';

export function ReAuthModal({ sessionToken, onSuccess, onCancel }: ReAuthModalProps) {
  const [authMethod, setAuthMethod] = useState<AuthMethod>('webauthn');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [webauthnSupported, setWebauthnSupported] = useState(false);

  useEffect(() => {
    // Check if WebAuthn is supported
    const supported = typeof window !== 'undefined' &&
      typeof window.PublicKeyCredential !== 'undefined' &&
      typeof navigator.credentials !== 'undefined';
    setWebauthnSupported(supported);

    // Try WebAuthn first if supported
    if (supported && authMethod === 'webauthn') {
      handleWebAuthnReauth().catch(() => {
        // If WebAuthn fails, fall back to PIN
        setAuthMethod('pin');
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleWebAuthnReauth = async () => {
    if (!webauthnSupported) {
      setAuthMethod('pin');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Get WebAuthn options
      const optionsResponse = await fetch(`${API_BASE}/v1/auth/reauth/webauthn/options`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionToken}`,
        },
      });

      if (!optionsResponse.ok) {
        throw new Error('Failed to get WebAuthn options');
      }

      const options = await optionsResponse.json();

      // Request WebAuthn authentication
      const credential = await navigator.credentials.get({
        publicKey: options,
      });

      if (!credential) {
        throw new Error('WebAuthn authentication cancelled');
      }

      // Verify WebAuthn response
      const verifyResponse = await fetch(`${API_BASE}/v1/auth/reauth/webauthn/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          credentialResponse: credential,
          deviceId: 'office-dashboard',
        }),
      });

      if (!verifyResponse.ok) {
        const errorData = await verifyResponse.json();
        throw new Error(errorData.message || 'WebAuthn verification failed');
      }

      onSuccess();
    } catch (error) {
      console.error('WebAuthn re-auth error:', error);
      // Fall back to PIN on error
      setAuthMethod('pin');
      setError(null); // Don't show error, just switch to PIN
    } finally {
      setIsLoading(false);
    }
  };

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!pin.trim()) {
      setError('Please enter your PIN');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/v1/auth/reauth-pin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          pin: pin.trim(),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Re-authentication failed');
      }

      onSuccess();
      setPin('');
    } catch (error) {
      console.error('Re-auth error:', error);
      setError(error instanceof Error ? error.message : 'Invalid PIN');
      setPin('');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1002,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: '#1f2937',
          padding: '2rem',
          borderRadius: '12px',
          maxWidth: '400px',
          width: '90%',
          boxShadow: '0 10px 25px rgba(0, 0, 0, 0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ marginBottom: '1rem', fontSize: '1.5rem', color: '#f9fafb' }}>
          Re-authentication Required
        </h2>
        <p style={{ marginBottom: '1.5rem', color: '#9ca3af', fontSize: '0.875rem' }}>
          This action requires re-authentication. {authMethod === 'webauthn' ? 'Use your passkey or enter your PIN.' : 'Please enter your PIN to continue.'}
        </p>

        {error && (
          <div
            style={{
              marginBottom: '1rem',
              padding: '0.75rem',
              background: '#7f1d1d',
              border: '1px solid #991b1b',
              borderRadius: '6px',
              color: '#fca5a5',
              fontSize: '0.875rem',
            }}
          >
            {error}
          </div>
        )}

        {authMethod === 'webauthn' && webauthnSupported && (
          <div style={{ marginBottom: '1.5rem' }}>
            <button
              type="button"
              onClick={handleWebAuthnReauth}
              disabled={isLoading}
              style={{
                width: '100%',
                padding: '0.75rem',
                background: '#8b5cf6',
                border: 'none',
                borderRadius: '6px',
                color: '#f9fafb',
                cursor: isLoading ? 'not-allowed' : 'pointer',
                fontSize: '1rem',
                fontWeight: 600,
                opacity: isLoading ? 0.5 : 1,
                marginBottom: '0.5rem',
              }}
            >
              {isLoading ? 'Authenticating...' : 'Use Passkey'}
            </button>
            <button
              type="button"
              onClick={() => setAuthMethod('pin')}
              disabled={isLoading}
              style={{
                width: '100%',
                padding: '0.5rem',
                background: 'transparent',
                border: 'none',
                color: '#9ca3af',
                cursor: isLoading ? 'not-allowed' : 'pointer',
                fontSize: '0.875rem',
                textDecoration: 'underline',
              }}
            >
              Use PIN instead
            </button>
          </div>
        )}

        {authMethod === 'pin' && (
          <form onSubmit={handlePinSubmit}>
            <div style={{ marginBottom: '1.5rem' }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: '0.5rem',
                  fontWeight: 500,
                  color: '#f9fafb',
                }}
              >
                PIN
              </label>
              <input
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
                autoFocus
                disabled={isLoading}
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  background: '#111827',
                  border: '1px solid #374151',
                  borderRadius: '6px',
                  color: '#f9fafb',
                  fontSize: '1rem',
                }}
              />
            </div>

            {webauthnSupported && (
              <button
                type="button"
                onClick={() => {
                  setAuthMethod('webauthn');
                  handleWebAuthnReauth();
                }}
                disabled={isLoading}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  background: 'transparent',
                  border: 'none',
                  color: '#9ca3af',
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                  fontSize: '0.875rem',
                  textDecoration: 'underline',
                  marginBottom: '1rem',
                }}
              >
                Use Passkey instead
              </button>
            )}

            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={onCancel}
                disabled={isLoading}
                style={{
                  padding: '0.75rem 1.5rem',
                  background: '#374151',
                  border: 'none',
                  borderRadius: '6px',
                  color: '#f9fafb',
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                  fontSize: '1rem',
                  opacity: isLoading ? 0.5 : 1,
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading || pin.trim().length !== 6}
                style={{
                  padding: '0.75rem 1.5rem',
                  background: '#8b5cf6',
                  border: 'none',
                  borderRadius: '6px',
                  color: '#f9fafb',
                  cursor: isLoading || pin.trim().length !== 6 ? 'not-allowed' : 'pointer',
                  fontSize: '1rem',
                  fontWeight: 600,
                  opacity: isLoading || pin.trim().length !== 6 ? 0.5 : 1,
                }}
              >
                {isLoading ? 'Verifying...' : 'Continue'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

