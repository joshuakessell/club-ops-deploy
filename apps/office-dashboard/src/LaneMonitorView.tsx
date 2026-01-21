import { useEffect, useMemo, useState } from 'react';
import type { RegisterSessionUpdatedPayload, WebSocketEvent } from '@club-ops/shared';
import { useLaneSession } from '@club-ops/shared';
import { safeJsonParse } from '@club-ops/ui';
import type { StaffSession } from './LockScreen';
import { apiJson, wsBaseUrl } from './api';

type LaneId = '1' | '2';

type RegisterSession = {
  registerNumber: 1 | 2;
  active: boolean;
  sessionId: string | null;
  employee: { id: string; displayName: string; role: string } | null;
  deviceId: string | null;
  createdAt: string | null;
  lastHeartbeatAt: string | null;
  secondsSinceHeartbeat: number | null;
};

type LaneSessionSummary = {
  laneId: string;
  status: string;
  customerName?: string;
  membershipNumber?: string;
  desiredRentalType?: string;
  assignedResource?: { type: 'room' | 'locker'; number: string };
  staffName?: string;
  createdAt: string;
};

export function LaneMonitorView({ session }: { session: StaffSession }) {
  const [lane, setLane] = useState<LaneId>('1');
  const [register, setRegister] = useState<RegisterSession | null>(null);
  const [laneSession, setLaneSession] = useState<LaneSessionSummary | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [lastLaneEvent, setLastLaneEvent] = useState<string | null>(null);

  const laneNumber = useMemo(() => (lane === '1' ? 1 : 2) as 1 | 2, [lane]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const regs = await apiJson<RegisterSession[]>('/v1/admin/register-sessions', {
        sessionToken: session.sessionToken,
      });
      const reg = regs.find((r) => r.registerNumber === laneNumber) || null;
      if (mounted) setRegister(reg);

      const sessions = await apiJson<{ sessions: LaneSessionSummary[] }>(
        '/v1/checkin/lane-sessions',
        { sessionToken: session.sessionToken }
      );
      const ls = (sessions.sessions || []).find((s) => String(s.laneId) === String(lane)) || null;
      if (mounted) setLaneSession(ls);
    };
    load().catch(console.error);
    return () => {
      mounted = false;
    };
  }, [lane, laneNumber, session.sessionToken]);

  const rawEnv = import.meta.env as unknown as Record<string, unknown>;
  const kioskToken =
    typeof rawEnv.VITE_KIOSK_TOKEN === 'string' && rawEnv.VITE_KIOSK_TOKEN.trim()
      ? rawEnv.VITE_KIOSK_TOKEN.trim()
      : '';
  void wsBaseUrl;
  const { connected: wsLive, lastMessage } = useLaneSession({
    laneId: String(lane),
    role: 'employee',
    kioskToken,
    enabled: !!kioskToken,
  });

  useEffect(() => {
    if (!lastMessage) return;
    const msg = safeJsonParse<WebSocketEvent>(String(lastMessage.data));
    if (!msg) return;
    if (msg.type === 'SESSION_UPDATED') {
      setLastLaneEvent(msg.timestamp);
      void apiJson<{ sessions: LaneSessionSummary[] }>('/v1/checkin/lane-sessions', {
        sessionToken: session.sessionToken,
      })
        .then((sessions) => {
          setLaneSession((sessions.sessions || []).find((s) => String(s.laneId) === String(lane)) || null);
        })
        .catch(console.error);
    }
    if (msg.type === 'REGISTER_SESSION_UPDATED') {
      const payload = msg.payload as RegisterSessionUpdatedPayload;
      if (payload.registerNumber === laneNumber) {
        void apiJson<RegisterSession[]>('/v1/admin/register-sessions', {
          sessionToken: session.sessionToken,
        })
          .then((regs) => setRegister(regs.find((r) => r.registerNumber === laneNumber) || null))
          .catch(console.error);
      }
    }
  }, [lane, laneNumber, lastMessage, session.sessionToken]);

  useEffect(() => {
    setWsConnected(wsLive);
  }, [wsLive]);

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      <section className="panel cs-liquid-card" style={{ marginBottom: '1.5rem' }}>
        <div className="panel-header">
          <h2>Live Lane Monitor</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div className="connection-status" style={{ border: 'none', padding: 0 }}>
              <span className={`dot ${wsConnected ? 'dot-live' : 'dot-offline'}`}></span>
              <span>{wsConnected ? 'Live' : 'Offline'}</span>
            </div>
            <select
              value={lane}
              onChange={(e) => setLane(e.target.value as LaneId)}
              style={{
                padding: '0.5rem 0.75rem',
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                color: 'var(--text)',
                fontWeight: 600,
              }}
            >
              <option value="1">Lane 1</option>
              <option value="2">Lane 2</option>
            </select>
          </div>
        </div>
        <div className="panel-content" style={{ padding: '1.25rem' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            Mirrored summary of employee-register + customer-kiosk lane state. Last lane event:{' '}
            {lastLaneEvent ? new Date(lastLaneEvent).toLocaleString() : '—'}
          </div>
        </div>
      </section>

      <div
        style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1.5rem' }}
      >
        <section className="panel cs-liquid-card">
          <div className="panel-header">
            <h2>Employee Register (Lane {lane})</h2>
          </div>
          <div className="panel-content" style={{ padding: '1.25rem' }}>
            {!register ? (
              <div style={{ color: 'var(--text-muted)' }}>Loading…</div>
            ) : (
              <table className="rooms-table">
                <tbody>
                  <tr>
                    <td style={{ color: 'var(--text-muted)' }}>Status</td>
                    <td>
                      <span
                        className={`status-badge ${register.active ? 'status-clean' : 'status-dirty'}`}
                      >
                        {register.active ? 'IN USE' : 'AVAILABLE'}
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td style={{ color: 'var(--text-muted)' }}>Employee</td>
                    <td>{register.employee?.displayName || '—'}</td>
                  </tr>
                  <tr>
                    <td style={{ color: 'var(--text-muted)' }}>Role</td>
                    <td>{register.employee?.role || '—'}</td>
                  </tr>
                  <tr>
                    <td style={{ color: 'var(--text-muted)' }}>Device</td>
                    <td>{register.deviceId || '—'}</td>
                  </tr>
                  <tr>
                    <td style={{ color: 'var(--text-muted)' }}>Last Heartbeat</td>
                    <td>
                      {register.lastHeartbeatAt
                        ? new Date(register.lastHeartbeatAt).toLocaleString()
                        : '—'}
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className="panel cs-liquid-card">
          <div className="panel-header">
            <h2>Customer Kiosk (Lane {lane})</h2>
          </div>
          <div className="panel-content" style={{ padding: '1.25rem' }}>
            {!laneSession ? (
              <div className="placeholder">
                <span className="placeholder-icon">🧍</span>
                <p>No active lane session</p>
              </div>
            ) : (
              <table className="rooms-table">
                <tbody>
                  <tr>
                    <td style={{ color: 'var(--text-muted)' }}>Status</td>
                    <td>
                      <span className="status-badge status-cleaning">{laneSession.status}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style={{ color: 'var(--text-muted)' }}>Customer</td>
                    <td>{laneSession.customerName || '—'}</td>
                  </tr>
                  <tr>
                    <td style={{ color: 'var(--text-muted)' }}>Membership</td>
                    <td>{laneSession.membershipNumber || '—'}</td>
                  </tr>
                  <tr>
                    <td style={{ color: 'var(--text-muted)' }}>Desired Rental</td>
                    <td>{laneSession.desiredRentalType || '—'}</td>
                  </tr>
                  <tr>
                    <td style={{ color: 'var(--text-muted)' }}>Assigned</td>
                    <td>
                      {laneSession.assignedResource
                        ? `${laneSession.assignedResource.type === 'room' ? 'Room' : 'Locker'} ${laneSession.assignedResource.number}`
                        : '—'}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ color: 'var(--text-muted)' }}>Staff</td>
                    <td>{laneSession.staffName || '—'}</td>
                  </tr>
                  <tr>
                    <td style={{ color: 'var(--text-muted)' }}>Started</td>
                    <td>{new Date(laneSession.createdAt).toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
