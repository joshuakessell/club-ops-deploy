import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { StaffSession } from './LockScreen';

const API_BASE = '/api';

interface Shift {
  id: string;
  employeeId: string;
  employeeName: string;
  shiftCode: 'A' | 'B' | 'C';
  scheduledStart: string;
  scheduledEnd: string;
  actualClockIn: string | null;
  actualClockOut: string | null;
  workedMinutesInWindow: number;
  scheduledMinutes: number;
  compliancePercent: number;
  flags: {
    lateClockIn: boolean;
    earlyClockOut: boolean;
    missingClockOut: boolean;
    noShow: boolean;
  };
  status: string;
  notes: string | null;
}

interface ShiftsViewProps {
  session: StaffSession;
}

const SHIFT_LABELS: Record<'A' | 'B' | 'C', string> = {
  A: 'Shift A (12:00 AM–8:00 AM)',
  B: 'Shift B (7:45 AM–4:00 PM)',
  C: 'Shift C (3:45 PM–12:00 AM)',
};

export function ShiftsView({ session }: ShiftsViewProps) {
  const navigate = useNavigate();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split('T')[0]!;
  });
  const [dateTo, setDateTo] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().split('T')[0]!;
  });
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [employees, setEmployees] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);

  useEffect(() => {
    fetchEmployees();
  }, []);

  useEffect(() => {
    fetchShifts();
  }, [dateFrom, dateTo, employeeFilter]);

  const fetchEmployees = async () => {
    try {
      const response = await fetch(`${API_BASE}/v1/admin/staff`, {
        headers: { 'Authorization': `Bearer ${session.sessionToken}` },
      });
      if (response.ok) {
        const data = await response.json();
        setEmployees(data.staff || []);
      }
    } catch (error) {
      console.error('Failed to fetch employees:', error);
    }
  };

  const fetchShifts = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.append('from', `${dateFrom}T00:00:00Z`);
      if (dateTo) params.append('to', `${dateTo}T23:59:59Z`);
      if (employeeFilter) params.append('employeeId', employeeFilter);

      const response = await fetch(`${API_BASE}/v1/admin/shifts?${params}`, {
        headers: { 'Authorization': `Bearer ${session.sessionToken}` },
      });
      if (response.ok) {
        const data = await response.json();
        setShifts(data);
      }
    } catch (error) {
      console.error('Failed to fetch shifts:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (isoString: string): string => {
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true,
      timeZone: 'America/Chicago'
    });
  };

  const formatDate = (isoString: string): string => {
    const date = new Date(isoString);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      timeZone: 'America/Chicago'
    });
  };

  const getComplianceBadge = (shift: Shift) => {
    if (shift.flags.noShow) {
      return { text: 'No Show', color: '#ef4444' };
    }
    if (shift.compliancePercent >= 95) {
      return { text: `${shift.compliancePercent}%`, color: '#10b981' };
    }
    if (shift.compliancePercent >= 80) {
      return { text: `${shift.compliancePercent}%`, color: '#f59e0b' };
    }
    return { text: `${shift.compliancePercent}%`, color: '#ef4444' };
  };

  // Group shifts by date
  const groupedShifts = shifts.reduce((acc, shift) => {
    const date = new Date(shift.scheduledStart).toLocaleDateString('en-US', { timeZone: 'America/Chicago' });
    if (!acc[date]) acc[date] = [];
    acc[date]!.push(shift);
    return acc;
  }, {} as Record<string, Shift[]>);

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p>Loading shifts...</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '1600px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 600 }}>Shifts</h1>
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

      {/* Filters */}
      <div style={{ 
        display: 'flex', 
        gap: '1rem', 
        marginBottom: '2rem',
        padding: '1rem',
        background: '#1f2937',
        borderRadius: '8px',
      }}>
        <div>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            style={{
              padding: '0.5rem',
              background: '#111827',
              border: '1px solid #374151',
              borderRadius: '6px',
              color: '#f9fafb',
            }}
          />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            style={{
              padding: '0.5rem',
              background: '#111827',
              border: '1px solid #374151',
              borderRadius: '6px',
              color: '#f9fafb',
            }}
          />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>Employee</label>
          <select
            value={employeeFilter}
            onChange={(e) => setEmployeeFilter(e.target.value)}
            style={{
              padding: '0.5rem',
              background: '#111827',
              border: '1px solid #374151',
              borderRadius: '6px',
              color: '#f9fafb',
              minWidth: '200px',
            }}
          >
            <option value="">All Employees</option>
            {employees.map(emp => (
              <option key={emp.id} value={emp.id}>{emp.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Shifts grouped by date */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {Object.entries(groupedShifts).map(([date, dateShifts]) => (
          <div key={date} style={{ border: '1px solid #374151', borderRadius: '8px', overflow: 'hidden' }}>
            <div style={{ 
              padding: '1rem', 
              background: '#374151', 
              fontWeight: 600,
              fontSize: '1.125rem',
            }}>
              {date}
            </div>
            <div style={{ padding: '1rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #374151' }}>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Employee</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Shift</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Scheduled</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Actual</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Compliance</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Flags</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {dateShifts.map(shift => {
                    const badge = getComplianceBadge(shift);
                    return (
                      <tr key={shift.id} style={{ borderBottom: '1px solid #374151' }}>
                        <td style={{ padding: '0.75rem' }}>{shift.employeeName}</td>
                        <td style={{ padding: '0.75rem' }}>{SHIFT_LABELS[shift.shiftCode]}</td>
                        <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>
                          {formatTime(shift.scheduledStart)} – {formatTime(shift.scheduledEnd)}
                        </td>
                        <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>
                          {shift.actualClockIn ? (
                            <>
                              {formatTime(shift.actualClockIn)}
                              {shift.actualClockOut && ` – ${formatTime(shift.actualClockOut)}`}
                            </>
                          ) : (
                            <span style={{ color: '#9ca3af' }}>—</span>
                          )}
                        </td>
                        <td style={{ padding: '0.75rem' }}>
                          <span style={{
                            padding: '0.25rem 0.75rem',
                            borderRadius: '4px',
                            background: badge.color,
                            color: '#fff',
                            fontSize: '0.875rem',
                            fontWeight: 600,
                          }}>
                            {badge.text}
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>
                          {shift.flags.lateClockIn && <span style={{ color: '#f59e0b' }}>⚠️ Late</span>}
                          {shift.flags.earlyClockOut && <span style={{ color: '#f59e0b' }}>⚠️ Early</span>}
                          {shift.flags.missingClockOut && <span style={{ color: '#ef4444' }}>⚠️ No Out</span>}
                          {shift.flags.noShow && <span style={{ color: '#ef4444' }}>❌ No Show</span>}
                        </td>
                        <td style={{ padding: '0.75rem' }}>
                          <button
                            onClick={() => {
                              setSelectedShift(shift);
                              setShowEditModal(true);
                            }}
                            style={{
                              padding: '0.5rem 1rem',
                              background: '#374151',
                              border: 'none',
                              borderRadius: '6px',
                              color: '#f9fafb',
                              cursor: 'pointer',
                              fontSize: '0.875rem',
                            }}
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      {shifts.length === 0 && !loading && (
        <div style={{ textAlign: 'center', padding: '4rem 0', color: '#9ca3af' }}>
          <p>No shifts found for the selected date range</p>
        </div>
      )}

      {/* Edit Shift Modal */}
      {showEditModal && selectedShift && (
        <EditShiftModal
          shift={selectedShift}
          onClose={() => {
            setShowEditModal(false);
            setSelectedShift(null);
          }}
          onSave={async (updates) => {
            try {
              const response = await fetch(`${API_BASE}/v1/admin/shifts/${selectedShift.id}`, {
                method: 'PATCH',
                headers: {
                  'Authorization': `Bearer ${session.sessionToken}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(updates),
              });
              if (response.ok) {
                await fetchShifts();
                setShowEditModal(false);
                setSelectedShift(null);
              } else {
                alert('Failed to update shift');
              }
            } catch (error) {
              console.error('Failed to update shift:', error);
              alert('Failed to update shift');
            }
          }}
        />
      )}
    </div>
  );
}

function EditShiftModal({
  shift,
  onClose,
  onSave,
}: {
  shift: Shift;
  onClose: () => void;
  onSave: (updates: any) => Promise<void>;
}) {
  const [startsAt, setStartsAt] = useState(shift.scheduledStart.slice(0, 16));
  const [endsAt, setEndsAt] = useState(shift.scheduledEnd.slice(0, 16));
  const [status, setStatus] = useState(shift.status);
  const [notes, setNotes] = useState(shift.notes || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        starts_at: new Date(startsAt).toISOString(),
        ends_at: new Date(endsAt).toISOString(),
        status,
        notes: notes || null,
      });
    } finally {
      setSaving(false);
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
        background: 'rgba(0, 0, 0, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#1f2937',
          borderRadius: '8px',
          padding: '2rem',
          maxWidth: '500px',
          width: '90%',
          border: '1px solid #374151',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1.5rem' }}>
          Edit Shift
        </h2>
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: 600 }}>
            Start Time
          </label>
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
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
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: 600 }}>
            End Time
          </label>
          <input
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
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
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: 600 }}>
            Status
          </label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            style={{
              width: '100%',
              padding: '0.75rem',
              background: '#111827',
              border: '1px solid #374151',
              borderRadius: '6px',
              color: '#f9fafb',
              fontSize: '1rem',
            }}
          >
            <option value="SCHEDULED">Scheduled</option>
            <option value="UPDATED">Updated</option>
            <option value="CANCELED">Canceled</option>
          </select>
        </div>
        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: 600 }}>
            Notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
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
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              padding: '0.75rem 1.5rem',
              background: '#374151',
              border: 'none',
              borderRadius: '6px',
              color: '#f9fafb',
              cursor: saving ? 'not-allowed' : 'pointer',
              fontSize: '1rem',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '0.75rem 1.5rem',
              background: saving ? '#6b7280' : '#10b981',
              border: 'none',
              borderRadius: '6px',
              color: '#fff',
              cursor: saving ? 'not-allowed' : 'pointer',
              fontSize: '1rem',
              fontWeight: 600,
            }}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

