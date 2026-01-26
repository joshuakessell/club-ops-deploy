import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { StaffSession } from './LockScreen';
import type { WebSocketEvent } from '@club-ops/shared';
import { useLaneSession } from '@club-ops/shared';
import { safeJsonParse } from '@club-ops/ui';
import { getApiUrl } from '@club-ops/shared';
import { RaisedCard } from './views/RaisedCard';

const API_BASE = getApiUrl('/api');

interface KPI {
  roomsOccupied: number;
  roomsUnoccupied: number;
  roomsDirty: number;
  roomsCleaning: number;
  roomsClean: number;
  lockersOccupied: number;
  lockersAvailable: number;
  waitingListCount: number;
}

interface RoomExpiration {
  roomId: string;
  roomNumber: string;
  roomTier: string;
  sessionId: string;
  customerName: string;
  membershipNumber: string | null;
  checkoutAt: string;
  minutesPast: number | null;
  minutesRemaining: number | null;
  isExpired: boolean;
  isExpiringSoon: boolean;
}

interface MetricsSummary {
  from: string;
  to: string;
  averageDirtyTimeMinutes: number | null;
  dirtyTimeSampleCount: number;
  averageCleaningDurationMinutes: number | null;
  cleaningDurationSampleCount: number;
  totalRoomsCleaned: number;
}

interface MetricsByStaff extends MetricsSummary {
  staffId: string;
  staffName: string;
}

interface StaffMember {
  id: string;
  name: string;
  role: string;
}

interface AdminViewProps {
  session: StaffSession;
}

type AdminTab = 'operations' | 'metrics';

export function AdminView({ session }: AdminViewProps) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<AdminTab>('operations');
  const [kpi, setKpi] = useState<KPI | null>(null);
  const [expirations, setExpirations] = useState<RoomExpiration[]>([]);
  const [metricsSummary, setMetricsSummary] = useState<MetricsSummary | null>(null);
  const [metricsByStaff, setMetricsByStaff] = useState<MetricsByStaff[]>([]);
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string>('');
  const [dateFrom, setDateFrom] = useState<string>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setTime(d.getTime() - 24 * 60 * 60 * 1000); // Subtract 24 hours
    return d.toISOString().slice(0, 16);
  });
  const [dateTo, setDateTo] = useState<string>(() => {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d.toISOString().slice(0, 16);
  });
  const [isLoading, setIsLoading] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);

  const activeTabRef = useRef<AdminTab>(activeTab);
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  const loadOperationsData = async () => {
    if (!session.sessionToken) return;

    const headers = {
      Authorization: `Bearer ${session.sessionToken}`,
    };

    // Load KPI
    const kpiRes = await fetch(`${API_BASE}/v1/admin/kpi`, { headers });
    if (kpiRes.ok) {
      const kpiData = await kpiRes.json();
      setKpi(kpiData);
    }

    // Load expirations
    const expRes = await fetch(`${API_BASE}/v1/admin/rooms/expirations`, { headers });
    if (expRes.ok) {
      const expData = await expRes.json();
      setExpirations(expData.expirations || []);
    }
  };

  const loadOperationsDataRef = useRef(loadOperationsData);
  useEffect(() => {
    loadOperationsDataRef.current = loadOperationsData;
  });

  const loadData = async () => {
    if (!session.sessionToken) return;

    setIsLoading(true);
    try {
      const headers = {
        Authorization: `Bearer ${session.sessionToken}`,
      };

      // Load staff members (needed for both tabs)
      const staffRes = await fetch(`${API_BASE}/v1/admin/staff`, { headers }).catch(() => null);
      if (staffRes?.ok) {
        const staffData = await staffRes.json();
        setStaffMembers(staffData.staff || []);
      }

      if (activeTab === 'operations') {
        await loadOperationsData();
      } else if (activeTab === 'metrics') {
        await loadMetricsData();
      }
    } catch (error) {
      console.error('Failed to load admin data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Check admin role and load data
  useEffect(() => {
    if (session.role !== 'ADMIN') {
      return;
    }

    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.role, activeTab]);

  const loadMetricsData = useCallback(async () => {
    if (!session.sessionToken) return;

    try {
      const from = new Date(dateFrom).toISOString();
      const to = new Date(dateTo).toISOString();
      const params = new URLSearchParams({ from, to });

      const headers = {
        Authorization: `Bearer ${session.sessionToken}`,
      };

      // Load overall summary
      const res = await fetch(`${API_BASE}/v1/admin/metrics/summary?${params}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setMetricsSummary(data);
      }

      // Load per-staff breakdown
      const perStaffData: MetricsByStaff[] = [];
      for (const staff of staffMembers) {
        const byStaffParams = new URLSearchParams({ from, to, staffId: staff.id });
        const byStaffRes = await fetch(`${API_BASE}/v1/admin/metrics/by-staff?${byStaffParams}`, {
          headers,
        });
        if (byStaffRes.ok) {
          const byStaffData = await byStaffRes.json();
          perStaffData.push({
            ...byStaffData,
            staffName: staff.name,
          });
        }
      }
      setMetricsByStaff(perStaffData);

      // Note: detailed per-staff metrics are already included in perStaffData above.
    } catch (error) {
      console.error('Failed to load metrics:', error);
    }
  }, [dateFrom, dateTo, session.sessionToken, staffMembers]);

  useEffect(() => {
    if (session.role === 'ADMIN' && activeTab === 'metrics') {
      loadMetricsData();
    }
  }, [activeTab, loadMetricsData, session.role]);

  if (session.role !== 'ADMIN') {
    return (
      <div className="admin-container">
        <div className="admin-unauthorized">
          <h1>Not authorized</h1>
          <p>You must be an administrator to access this page.</p>
          <button onClick={() => navigate('/')} className="cs-liquid-button">
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const formatMinutes = (minutes: number | null): string => {
    if (minutes === null) return '-';
    if (minutes < 0) return `${Math.abs(minutes)}m past`;
    return `${minutes}m`;
  };

  return (
    <div
      className="admin-container"
      style={{ padding: '2rem', maxWidth: '1600px', margin: '0 auto' }}
    >
      <AdminWs
        activeTabRef={activeTabRef}
        loadOperationsDataRef={loadOperationsDataRef}
        onConnectedChange={setWsConnected}
      />
      <div
        className="admin-header"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '2rem',
        }}
      >
        <h1 style={{ fontSize: '2rem', fontWeight: 600 }}>Admin Console</h1>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.875rem',
              color: '#9ca3af',
            }}
          >
            <span
              className={`dot ${wsConnected ? 'dot-live' : 'dot-offline'}`}
              style={{ width: '8px', height: '8px', borderRadius: '50%' }}
            ></span>
            <span>{wsConnected ? 'Live' : 'Offline'}</span>
          </div>
          <button
            onClick={() => navigate('/admin/staff')}
            className="cs-liquid-button cs-liquid-button--secondary"
          >
            Staff Management
          </button>
          <button
            onClick={() => navigate('/')}
            className="cs-liquid-button cs-liquid-button--secondary"
          >
            ← Back to Dashboard
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          marginBottom: '2rem',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <button
          onClick={() => {
            setActiveTab('operations');
            loadOperationsData();
          }}
          className={[
            'cs-liquid-button',
            'cs-liquid-button--pill',
            activeTab === 'operations'
              ? 'cs-liquid-button--selected'
              : 'cs-liquid-button--secondary',
          ].join(' ')}
        >
          Operations
        </button>
        <button
          onClick={() => {
            setActiveTab('metrics');
            loadMetricsData();
          }}
          className={[
            'cs-liquid-button',
            'cs-liquid-button--pill',
            activeTab === 'metrics' ? 'cs-liquid-button--selected' : 'cs-liquid-button--secondary',
          ].join(' ')}
        >
          Metrics
        </button>
      </div>

      {isLoading && (
        <div style={{ padding: '1rem', textAlign: 'center', color: '#9ca3af' }}>Loading...</div>
      )}

      {activeTab === 'operations' && (
        <>
          {/* KPI Cards */}
          <section style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1rem' }}>
              Key Performance Indicators
            </h2>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '1rem',
              }}
            >
              <RaisedCard padding="lg">
                <div style={{ fontSize: '2rem', fontWeight: 700, color: '#f9fafb' }}>
                  {kpi?.roomsOccupied ?? 0}
                </div>
                <div style={{ fontSize: '0.875rem', color: '#9ca3af', marginTop: '0.5rem' }}>
                  Rooms Occupied
                </div>
              </RaisedCard>
              <RaisedCard padding="lg">
                <div style={{ fontSize: '2rem', fontWeight: 700, color: '#f9fafb' }}>
                  {kpi?.roomsUnoccupied ?? 0}
                </div>
                <div style={{ fontSize: '0.875rem', color: '#9ca3af', marginTop: '0.5rem' }}>
                  Rooms Unoccupied
                </div>
              </RaisedCard>
              <RaisedCard padding="lg">
                <div style={{ fontSize: '2rem', fontWeight: 700, color: '#f9fafb' }}>
                  {kpi?.lockersOccupied ?? 0}
                </div>
                <div style={{ fontSize: '0.875rem', color: '#9ca3af', marginTop: '0.5rem' }}>
                  Lockers Occupied
                </div>
              </RaisedCard>
              <RaisedCard padding="lg">
                <div style={{ fontSize: '2rem', fontWeight: 700, color: '#f9fafb' }}>
                  {kpi?.lockersAvailable ?? 0}
                </div>
                <div style={{ fontSize: '0.875rem', color: '#9ca3af', marginTop: '0.5rem' }}>
                  Lockers Available
                </div>
              </RaisedCard>
            </div>
          </section>

          {/* Rooms Nearing or Past Expiration */}
          <section>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1rem' }}>
              Room Expirations
            </h2>
            <div style={{ background: '#1f2937', borderRadius: '8px', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#111827', borderBottom: '1px solid #374151' }}>
                    <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600 }}>Room</th>
                    <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600 }}>Tier</th>
                    <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600 }}>
                      Customer / Member
                    </th>
                    <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600 }}>
                      Checkout At
                    </th>
                    <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {expirations.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af' }}
                      >
                        No active room stays
                      </td>
                    </tr>
                  ) : (
                    expirations.map((exp) => (
                      <tr
                        key={exp.sessionId}
                        style={{
                          borderBottom: '1px solid #374151',
                          background: exp.isExpired
                            ? 'rgba(239, 68, 68, 0.1)'
                            : exp.isExpiringSoon
                              ? 'rgba(245, 158, 11, 0.1)'
                              : 'transparent',
                        }}
                      >
                        <td style={{ padding: '1rem', fontWeight: 600 }}>{exp.roomNumber}</td>
                        <td style={{ padding: '1rem' }}>
                          <span
                            style={{
                              padding: '0.25rem 0.75rem',
                              borderRadius: '4px',
                              fontSize: '0.875rem',
                              background:
                                exp.roomTier === 'SPECIAL'
                                  ? '#7c3aed'
                                  : exp.roomTier === 'DOUBLE'
                                    ? '#3b82f6'
                                    : '#374151',
                              color: '#f9fafb',
                            }}
                          >
                            {exp.roomTier}
                          </span>
                        </td>
                        <td style={{ padding: '1rem' }}>
                          <div>{exp.customerName}</div>
                          {exp.membershipNumber && (
                            <div style={{ fontSize: '0.875rem', color: '#9ca3af' }}>
                              Member: {exp.membershipNumber}
                            </div>
                          )}
                          <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                            {exp.sessionId.slice(0, 8)}...
                          </div>
                        </td>
                        <td style={{ padding: '1rem', color: '#9ca3af' }}>
                          {new Date(exp.checkoutAt).toLocaleString()}
                        </td>
                        <td style={{ padding: '1rem' }}>
                          {exp.isExpired ? (
                            <span
                              style={{
                                padding: '0.25rem 0.75rem',
                                borderRadius: '4px',
                                fontSize: '0.875rem',
                                background: '#ef4444',
                                color: '#f9fafb',
                              }}
                            >
                              {formatMinutes(exp.minutesPast)} past
                            </span>
                          ) : (
                            <span
                              style={{
                                padding: '0.25rem 0.75rem',
                                borderRadius: '4px',
                                fontSize: '0.875rem',
                                background: '#f59e0b',
                                color: '#f9fafb',
                              }}
                            >
                              {formatMinutes(exp.minutesRemaining)} remaining
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {activeTab === 'metrics' && (
        <section>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1rem' }}>
            Cleaning Performance Metrics
          </h2>

          <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
            <div>
              <label
                htmlFor="dateFrom"
                style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}
              >
                From:
              </label>
              <input
                id="dateFrom"
                type="datetime-local"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                style={{
                  padding: '0.75rem',
                  background: '#1f2937',
                  border: '1px solid #374151',
                  borderRadius: '6px',
                  color: '#f9fafb',
                  fontSize: '1rem',
                }}
              />
            </div>
            <div>
              <label
                htmlFor="dateTo"
                style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}
              >
                To:
              </label>
              <input
                id="dateTo"
                type="datetime-local"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                style={{
                  padding: '0.75rem',
                  background: '#1f2937',
                  border: '1px solid #374151',
                  borderRadius: '6px',
                  color: '#f9fafb',
                  fontSize: '1rem',
                }}
              />
            </div>
            <div>
              <label
                htmlFor="staffSelect"
                style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}
              >
                Staff Member:
              </label>
              <select
                id="staffSelect"
                value={selectedStaffId}
                onChange={(e) => setSelectedStaffId(e.target.value)}
                style={{
                  padding: '0.75rem',
                  background: '#1f2937',
                  border: '1px solid #374151',
                  borderRadius: '6px',
                  color: '#f9fafb',
                  fontSize: '1rem',
                  minWidth: '200px',
                }}
              >
                <option value="">All Staff</option>
                {staffMembers.map((staff) => (
                  <option key={staff.id} value={staff.id}>
                    {staff.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Overall Metrics Cards */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
              gap: '1rem',
              marginBottom: '2rem',
            }}
          >
            <div style={{ background: '#1f2937', padding: '1.5rem', borderRadius: '8px' }}>
              <h3
                style={{
                  fontSize: '1rem',
                  fontWeight: 600,
                  marginBottom: '0.5rem',
                  color: '#9ca3af',
                }}
              >
                Average Dirty Duration
              </h3>
              <div
                style={{
                  fontSize: '2rem',
                  fontWeight: 700,
                  color: '#f9fafb',
                  marginBottom: '0.5rem',
                }}
              >
                {metricsSummary?.averageDirtyTimeMinutes !== null &&
                metricsSummary?.averageDirtyTimeMinutes !== undefined
                  ? `${Math.round(metricsSummary.averageDirtyTimeMinutes)} min`
                  : 'N/A'}
              </div>
              <div style={{ fontSize: '0.875rem', color: '#9ca3af' }}>
                Sample size: {metricsSummary?.dirtyTimeSampleCount ?? 0}
              </div>
            </div>

            <div style={{ background: '#1f2937', padding: '1.5rem', borderRadius: '8px' }}>
              <h3
                style={{
                  fontSize: '1rem',
                  fontWeight: 600,
                  marginBottom: '0.5rem',
                  color: '#9ca3af',
                }}
              >
                Average Cleaning Duration
              </h3>
              <div
                style={{
                  fontSize: '2rem',
                  fontWeight: 700,
                  color: '#f9fafb',
                  marginBottom: '0.5rem',
                }}
              >
                {metricsSummary?.averageCleaningDurationMinutes !== null &&
                metricsSummary?.averageCleaningDurationMinutes !== undefined
                  ? `${Math.round(metricsSummary.averageCleaningDurationMinutes)} min`
                  : 'N/A'}
              </div>
              <div style={{ fontSize: '0.875rem', color: '#9ca3af' }}>
                Sample size: {metricsSummary?.cleaningDurationSampleCount ?? 0}
              </div>
            </div>

            <div style={{ background: '#1f2937', padding: '1.5rem', borderRadius: '8px' }}>
              <h3
                style={{
                  fontSize: '1rem',
                  fontWeight: 600,
                  marginBottom: '0.5rem',
                  color: '#9ca3af',
                }}
              >
                Total Rooms Cleaned
              </h3>
              <div
                style={{
                  fontSize: '2rem',
                  fontWeight: 700,
                  color: '#f9fafb',
                  marginBottom: '0.5rem',
                }}
              >
                {metricsSummary?.totalRoomsCleaned ?? 0}
              </div>
              <div style={{ fontSize: '0.875rem', color: '#9ca3af' }}>In selected time range</div>
            </div>
          </div>

          {/* Per-Staff Breakdown Table */}
          <div style={{ background: '#1f2937', borderRadius: '8px', overflow: 'hidden' }}>
            <h3
              style={{
                fontSize: '1.25rem',
                fontWeight: 600,
                padding: '1.5rem',
                borderBottom: '1px solid #374151',
              }}
            >
              Per-Staff Breakdown
            </h3>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#111827', borderBottom: '1px solid #374151' }}>
                  <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600 }}>
                    Staff Member
                  </th>
                  <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600 }}>
                    Rooms Cleaned
                  </th>
                  <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600 }}>
                    Avg Dirty Duration
                  </th>
                  <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600 }}>
                    Avg Cleaning Duration
                  </th>
                </tr>
              </thead>
              <tbody>
                {metricsByStaff.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af' }}
                    >
                      No metrics data available for selected time range
                    </td>
                  </tr>
                ) : (
                  metricsByStaff
                    .filter((staff) => !selectedStaffId || staff.staffId === selectedStaffId)
                    .map((staff) => (
                      <tr key={staff.staffId} style={{ borderBottom: '1px solid #374151' }}>
                        <td style={{ padding: '1rem', fontWeight: 600 }}>{staff.staffName}</td>
                        <td style={{ padding: '1rem' }}>{staff.totalRoomsCleaned ?? 0}</td>
                        <td style={{ padding: '1rem' }}>
                          {staff.averageDirtyTimeMinutes !== null &&
                          staff.averageDirtyTimeMinutes !== undefined
                            ? `${Math.round(staff.averageDirtyTimeMinutes)} min (n=${staff.dirtyTimeSampleCount})`
                            : 'N/A'}
                        </td>
                        <td style={{ padding: '1rem' }}>
                          {staff.averageCleaningDurationMinutes !== null &&
                          staff.averageCleaningDurationMinutes !== undefined
                            ? `${Math.round(staff.averageCleaningDurationMinutes)} min (n=${staff.cleaningDurationSampleCount})`
                            : 'N/A'}
                        </td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function AdminWs({
  activeTabRef,
  loadOperationsDataRef,
  onConnectedChange,
}: {
  activeTabRef: { current: AdminTab };
  loadOperationsDataRef: { current: () => Promise<void> };
  onConnectedChange: (connected: boolean) => void;
}) {
  const rawEnv = import.meta.env as unknown as Record<string, unknown>;
  const kioskToken =
    typeof rawEnv.VITE_KIOSK_TOKEN === 'string' && rawEnv.VITE_KIOSK_TOKEN.trim()
      ? rawEnv.VITE_KIOSK_TOKEN.trim()
      : '';
  const { connected, lastMessage } = useLaneSession({
    laneId: '',
    role: 'employee',
    kioskToken,
    enabled: !!kioskToken,
  });

  useEffect(() => {
    if (!lastMessage) return;
    const message = safeJsonParse<WebSocketEvent>(String(lastMessage.data));
    if (!message) return;
    if (
      message.type === 'INVENTORY_UPDATED' ||
      message.type === 'ROOM_STATUS_CHANGED' ||
      message.type === 'SESSION_UPDATED'
    ) {
      if (activeTabRef.current === 'operations') {
        loadOperationsDataRef.current().catch(console.error);
      }
    }
  }, [lastMessage, loadOperationsDataRef, activeTabRef]);

  useEffect(() => {
    onConnectedChange(connected);
  }, [onConnectedChange, connected]);

  return null;
}
