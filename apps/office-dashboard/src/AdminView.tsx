import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { StaffSession } from './LockScreen';

const API_BASE = '/api';

interface KPI {
  roomsOccupied: number;
  roomsUnoccupied: number;
  roomsDirty: number;
  roomsCleaning: number;
  roomsClean: number;
  lockersInUse: number;
  waitingListCount: number;
}

interface RoomExpiration {
  roomId: string;
  roomNumber: string;
  sessionId: string;
  customerName: string;
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
}

interface MetricsByStaff extends MetricsSummary {
  staffId: string;
}

interface StaffMember {
  id: string;
  name: string;
  role: string;
}

interface AdminViewProps {
  session: StaffSession;
}

export function AdminView({ session }: AdminViewProps) {
  const navigate = useNavigate();
  const [kpi, setKpi] = useState<KPI | null>(null);
  const [expirations, setExpirations] = useState<RoomExpiration[]>([]);
  const [metricsSummary, setMetricsSummary] = useState<MetricsSummary | null>(null);
  const [metricsByStaff, setMetricsByStaff] = useState<MetricsByStaff | null>(null);
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string>('');
  const [dateFrom, setDateFrom] = useState<string>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 16);
  });
  const [dateTo, setDateTo] = useState<string>(() => {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d.toISOString().slice(0, 16);
  });
  const [isLoading, setIsLoading] = useState(false);

  // Check admin role
  useEffect(() => {
    if (session.role !== 'ADMIN') {
      // Not authorized - will show message below
      return;
    }

    loadData();
  }, [session.role]);

  const loadData = async () => {
    if (!session.sessionToken) return;

    setIsLoading(true);
    try {
      const headers = {
        'Authorization': `Bearer ${session.sessionToken}`,
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

      // Load staff members
      const staffRes = await fetch(`${API_BASE}/v1/admin/staff`, { headers }).catch(() => null);
      if (staffRes?.ok) {
        const staffData = await staffRes.json();
        setStaffMembers(staffData.staff || []);
      }

      // Load metrics summary
      await loadMetricsSummary();
    } catch (error) {
      console.error('Failed to load admin data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadMetricsSummary = async () => {
    if (!session.sessionToken) return;

    try {
      const from = new Date(dateFrom).toISOString();
      const to = new Date(dateTo).toISOString();
      const params = new URLSearchParams({ from, to });

      const headers = {
        'Authorization': `Bearer ${session.sessionToken}`,
      };

      const res = await fetch(`${API_BASE}/v1/admin/metrics/summary?${params}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setMetricsSummary(data);
      }

      if (selectedStaffId) {
        const byStaffParams = new URLSearchParams({ from, to, staffId: selectedStaffId });
        const byStaffRes = await fetch(`${API_BASE}/v1/admin/metrics/by-staff?${byStaffParams}`, { headers });
        if (byStaffRes.ok) {
          const byStaffData = await byStaffRes.json();
          setMetricsByStaff(byStaffData);
        }
      } else {
        setMetricsByStaff(null);
      }
    } catch (error) {
      console.error('Failed to load metrics:', error);
    }
  };

  useEffect(() => {
    if (session.role === 'ADMIN') {
      loadMetricsSummary();
    }
  }, [dateFrom, dateTo, selectedStaffId, session.sessionToken, session.role]);

  if (session.role !== 'ADMIN') {
    return (
      <div className="admin-container">
        <div className="admin-unauthorized">
          <h1>Not authorized</h1>
          <p>You must be an administrator to access this page.</p>
          <button onClick={() => navigate('/')} className="btn-primary">
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
    <div className="admin-container">
      <div className="admin-header">
        <h1>Operations Admin</h1>
        <button onClick={() => navigate('/')} className="btn-secondary">
          ← Back to Dashboard
        </button>
      </div>

      {isLoading && <div className="loading">Loading...</div>}

      {/* KPI Cards */}
      <section className="admin-section">
        <h2>Key Performance Indicators</h2>
        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="kpi-value">{kpi?.roomsOccupied ?? 0}</div>
            <div className="kpi-label">Rooms Occupied</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-value">{kpi?.roomsUnoccupied ?? 0}</div>
            <div className="kpi-label">Rooms Unoccupied</div>
          </div>
          <div className="kpi-card kpi-dirty">
            <div className="kpi-value">{kpi?.roomsDirty ?? 0}</div>
            <div className="kpi-label">Rooms Dirty</div>
          </div>
          <div className="kpi-card kpi-cleaning">
            <div className="kpi-value">{kpi?.roomsCleaning ?? 0}</div>
            <div className="kpi-label">Rooms Cleaning</div>
          </div>
          <div className="kpi-card kpi-clean">
            <div className="kpi-value">{kpi?.roomsClean ?? 0}</div>
            <div className="kpi-label">Rooms Clean</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-value">{kpi?.lockersInUse ?? 0}</div>
            <div className="kpi-label">Lockers in Use</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-value">{kpi?.waitingListCount ?? 0}</div>
            <div className="kpi-label">Waiting List</div>
          </div>
        </div>
      </section>

      {/* Rooms Nearing or Past Expiration */}
      <section className="admin-section">
        <h2>Rooms Nearing or Past Expiration</h2>
        <div className="panel-content">
          <table className="expirations-table">
            <thead>
              <tr>
                <th>Room</th>
                <th>Customer / Session</th>
                <th>Checkout At</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {expirations.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty-state">No active room sessions</td>
                </tr>
              ) : (
                expirations.map((exp) => (
                  <tr
                    key={exp.sessionId}
                    className={exp.isExpired ? 'expired-row' : exp.isExpiringSoon ? 'expiring-row' : ''}
                  >
                    <td className="room-number">{exp.roomNumber}</td>
                    <td>
                      <div>{exp.customerName}</div>
                      <div className="session-id">{exp.sessionId.slice(0, 8)}...</div>
                    </td>
                    <td>{new Date(exp.checkoutAt).toLocaleString()}</td>
                    <td>
                      {exp.isExpired ? (
                        <span className="status-badge status-expired">
                          {formatMinutes(exp.minutesPast)} past
                        </span>
                      ) : (
                        <span className="status-badge status-expiring">
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

      {/* Metrics Section */}
      <section className="admin-section">
        <h2>Cleaning Metrics</h2>
        
        <div className="metrics-filters">
          <div className="filter-group">
            <label htmlFor="dateFrom">From:</label>
            <input
              id="dateFrom"
              type="datetime-local"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div className="filter-group">
            <label htmlFor="dateTo">To:</label>
            <input
              id="dateTo"
              type="datetime-local"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <div className="filter-group">
            <label htmlFor="staffSelect">Staff Member:</label>
            <select
              id="staffSelect"
              value={selectedStaffId}
              onChange={(e) => setSelectedStaffId(e.target.value)}
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

        <div className="metrics-grid">
          <div className="metric-card">
            <h3>Average Dirty Time</h3>
            <div className="metric-value">
              {metricsSummary?.averageDirtyTimeMinutes !== null && metricsSummary?.averageDirtyTimeMinutes !== undefined
                ? `${Math.round(metricsSummary.averageDirtyTimeMinutes)} min`
                : 'N/A'}
            </div>
            <div className="metric-sample">
              Sample size: {metricsSummary?.dirtyTimeSampleCount ?? 0}
            </div>
            {selectedStaffId && metricsByStaff && (
              <div className="metric-staff">
                <strong>Selected Staff:</strong> {Math.round(metricsByStaff.averageDirtyTimeMinutes || 0)} min
                (n={metricsByStaff.dirtyTimeSampleCount})
              </div>
            )}
          </div>

          <div className="metric-card">
            <h3>Average Cleaning Duration</h3>
            <div className="metric-value">
              {metricsSummary?.averageCleaningDurationMinutes !== null && metricsSummary?.averageCleaningDurationMinutes !== undefined
                ? `${Math.round(metricsSummary.averageCleaningDurationMinutes)} min`
                : 'N/A'}
            </div>
            <div className="metric-sample">
              Sample size: {metricsSummary?.cleaningDurationSampleCount ?? 0}
            </div>
            {selectedStaffId && metricsByStaff && (
              <div className="metric-staff">
                <strong>Selected Staff:</strong> {Math.round(metricsByStaff.averageCleaningDurationMinutes || 0)} min
                (n={metricsByStaff.cleaningDurationSampleCount})
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

