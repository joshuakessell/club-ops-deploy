import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { StaffSession } from './LockScreen';
import type { RegisterSessionUpdatedPayload, WebSocketEvent } from '@club-ops/shared';
import { useLaneSession } from '@club-ops/shared';
import { safeJsonParse } from '@club-ops/ui';
import { wsBaseUrl } from './api';
import { getApiUrl } from '@club-ops/shared';

const API_BASE = getApiUrl('/api');

interface RegisterSession {
  registerNumber: 1 | 2 | 3;
  active: boolean;
  sessionId: string | null;
  employee: {
    id: string;
    displayName: string;
    role: string;
  } | null;
  deviceId: string | null;
  createdAt: string | null;
  lastHeartbeatAt: string | null;
  secondsSinceHeartbeat: number | null;
}

interface RegistersViewProps {
  session: StaffSession;
}

export function RegistersView({ session }: RegistersViewProps) {
  const navigate = useNavigate();
  const [registers, setRegisters] = useState<RegisterSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [forceSignOutLoading, setForceSignOutLoading] = useState<number | null>(null);

  const fetchRegisters = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/v1/admin/register-sessions`, {
        headers: {
          Authorization: `Bearer ${session.sessionToken}`,
        },
      });
      if (response.ok) {
        const data = await response.json();
        setRegisters(data);
      }
    } catch (error) {
      console.error('Failed to fetch registers:', error);
    } finally {
      setLoading(false);
    }
  }, [session.sessionToken]);

  useEffect(() => {
    fetchRegisters();
  }, [fetchRegisters]);

  const rawEnv = import.meta.env as unknown as Record<string, unknown>;
  const kioskToken =
    typeof rawEnv.VITE_KIOSK_TOKEN === 'string' && rawEnv.VITE_KIOSK_TOKEN.trim()
      ? rawEnv.VITE_KIOSK_TOKEN.trim()
      : '';
  void wsBaseUrl;
  const { lastMessage } = useLaneSession({
    laneId: '',
    role: 'employee',
    kioskToken,
    enabled: !!kioskToken,
  });

  useEffect(() => {
    if (!lastMessage) return;
    const message = safeJsonParse<WebSocketEvent>(String(lastMessage.data));
    if (!message) return;
    if (message.type === 'REGISTER_SESSION_UPDATED') {
      const payload = message.payload as RegisterSessionUpdatedPayload;
      setRegisters((prev) =>
        prev.map((reg) =>
          reg.registerNumber === payload.registerNumber
            ? {
                registerNumber: payload.registerNumber,
                active: payload.active,
                sessionId: payload.sessionId,
                employee: payload.employee,
                deviceId: payload.deviceId,
                createdAt: payload.createdAt,
                lastHeartbeatAt: payload.lastHeartbeatAt,
                secondsSinceHeartbeat: payload.lastHeartbeatAt
                  ? Math.floor((Date.now() - new Date(payload.lastHeartbeatAt).getTime()) / 1000)
                  : null,
              }
            : reg
        )
      );
    }
  }, [lastMessage]);

  const handleForceSignOut = async (registerNumber: number) => {
    setForceSignOutLoading(registerNumber);
    try {
      const response = await fetch(
        `${API_BASE}/v1/admin/register-sessions/${registerNumber}/force-signout`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.sessionToken}`,
          },
        }
      );
      if (response.ok) {
        await fetchRegisters();
      } else {
        alert('Failed to force sign out');
      }
    } catch (error) {
      console.error('Failed to force sign out:', error);
      alert('Failed to force sign out');
    } finally {
      setForceSignOutLoading(null);
    }
  };

  const formatTimeAgo = (seconds: number | null): string => {
    if (seconds === null) return 'N/A';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p>Loading register status...</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '1600px', margin: '0 auto' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '2rem',
        }}
      >
        <h1 style={{ fontSize: '2rem', fontWeight: 600 }}>Register Monitoring</h1>
        <button
          onClick={() => navigate('/')}
          style={{
            padding: '0.75rem 1.5rem',
            background: '#374151',
            border: 'none',
            borderRadius: '6px',
            color: '#f9fafb',
            cursor: 'pointer',
            fontSize: '1rem',
          }}
        >
          ← Back to Dashboard
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1.5rem' }}>
        {registers.map((register) => (
          <div
            key={register.registerNumber}
            style={{
              border: '1px solid #374151',
              borderRadius: '8px',
              padding: '1.5rem',
              background: register.active ? '#1f2937' : '#111827',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '1rem',
              }}
            >
              <h2 style={{ fontSize: '1.5rem', fontWeight: 600 }}>
                Register {register.registerNumber}
              </h2>
              <span
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '6px',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  background: register.active ? '#10b981' : '#6b7280',
                  color: '#fff',
                }}
              >
                {register.active ? 'In Use' : 'Available'}
              </span>
            </div>

            {register.active ? (
              <>
                <div style={{ marginBottom: '1rem' }}>
                  <div style={{ marginBottom: '0.5rem' }}>
                    <strong>Employee:</strong> {register.employee?.displayName || 'Unknown'}
                  </div>
                  <div style={{ marginBottom: '0.5rem' }}>
                    <strong>Role:</strong> {register.employee?.role || 'Unknown'}
                  </div>
                  <div style={{ marginBottom: '0.5rem' }}>
                    <strong>Device ID:</strong> {register.deviceId || 'Unknown'}
                  </div>
                  <div style={{ marginBottom: '0.5rem' }}>
                    <strong>Last Heartbeat:</strong> {formatTimeAgo(register.secondsSinceHeartbeat)}
                  </div>
                  {register.createdAt && (
                    <div style={{ marginBottom: '0.5rem', fontSize: '0.875rem', color: '#9ca3af' }}>
                      Started: {new Date(register.createdAt).toLocaleString()}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => handleForceSignOut(register.registerNumber)}
                  disabled={forceSignOutLoading === register.registerNumber}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    background:
                      forceSignOutLoading === register.registerNumber ? '#6b7280' : '#ef4444',
                    border: 'none',
                    borderRadius: '6px',
                    color: '#fff',
                    cursor:
                      forceSignOutLoading === register.registerNumber ? 'not-allowed' : 'pointer',
                    fontSize: '1rem',
                    fontWeight: 600,
                  }}
                >
                  {forceSignOutLoading === register.registerNumber
                    ? 'Signing Out...'
                    : 'Force Sign Out'}
                </button>
              </>
            ) : (
              <div style={{ color: '#9ca3af', textAlign: 'center', padding: '2rem 0' }}>
                No active session
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
