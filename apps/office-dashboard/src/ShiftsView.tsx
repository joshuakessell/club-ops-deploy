import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { StaffSession } from './LockScreen';
import { getApiUrl } from '@club-ops/shared';

const API_BASE = getApiUrl('/api');

interface Shift {
  id: string;
  employeeId: string;
  employeeName: string;
  shiftCode: 'A' | 'B' | 'C';
  scheduledStart: string;
  scheduledEnd: string;
  actualClockIn?: string | null;
  actualClockOut?: string | null;
  workedMinutesInWindow?: number;
  scheduledMinutes?: number;
  compliancePercent?: number;
  flags?: {
    lateClockIn: boolean;
    earlyClockOut: boolean;
    missingClockOut: boolean;
    noShow: boolean;
  };
  status?: string;
  notes: string | null;
}

interface ShiftsViewProps {
  session: StaffSession;
  limitedAccess: boolean;
}

interface TimeOffRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  day: string; // YYYY-MM-DD
  reason: string | null;
  status: 'PENDING' | 'APPROVED' | 'DENIED';
  decidedAt: string | null;
}

const SHIFT_LABELS: Record<'A' | 'B' | 'C', string> = {
  A: 'Shift A (12:00 AM–8:00 AM)',
  B: 'Shift B (7:45 AM–4:00 PM)',
  C: 'Shift C (3:45 PM–12:00 AM)',
};

const SHIFT_BADGE_LABELS: Record<'A' | 'B' | 'C', string> = {
  A: '1st',
  B: '2nd',
  C: '3rd',
};

const SHIFT_BADGE_COLORS: Record<'A' | 'B' | 'C', string> = {
  A: '#3b82f6',
  B: '#22c55e',
  C: '#a855f7',
};

export function ShiftsView({ session, limitedAccess }: ShiftsViewProps) {
  const navigate = useNavigate();
  const isAdmin = session.role === 'ADMIN';
  const [viewMode, setViewMode] = useState<'calendar' | 'list'>(() =>
    isAdmin ? 'calendar' : 'calendar'
  );

  // Calendar state (current month)
  const [monthShifts, setMonthShifts] = useState<Shift[]>([]);
  const [monthLoading, setMonthLoading] = useState(true);
  const [myTimeOffRequests, setMyTimeOffRequests] = useState<TimeOffRequest[]>([]);
  const [pendingTimeOffRequests, setPendingTimeOffRequests] = useState<TimeOffRequest[]>([]);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [requestReason, setRequestReason] = useState('');
  const [submittingRequest, setSubmittingRequest] = useState(false);

  // Existing list/compliance state (admin-only)
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

  const getCurrentMonthRange = useCallback(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }, []);

  const fetchMonthData = useCallback(async () => {
    const { start, end } = getCurrentMonthRange();
    setMonthLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('from', start.toISOString());
      params.append('to', end.toISOString());

      const shiftsUrl = limitedAccess
        ? `${API_BASE}/v1/schedule/shifts?${params}`
        : `${API_BASE}/v1/admin/shifts?${params}`;

      const [shiftsRes, myReqRes, pendingRes] = await Promise.all([
        fetch(shiftsUrl, {
          headers: { Authorization: `Bearer ${session.sessionToken}` },
        }),
        fetch(
          `${API_BASE}/v1/schedule/time-off-requests?from=${start.toISOString().slice(0, 10)}&to=${end.toISOString().slice(0, 10)}`,
          {
            headers: { Authorization: `Bearer ${session.sessionToken}` },
          }
        ),
        isAdmin
          ? fetch(`${API_BASE}/v1/admin/time-off-requests?status=PENDING`, {
              headers: { Authorization: `Bearer ${session.sessionToken}` },
            })
          : Promise.resolve(null),
      ]);

      if (shiftsRes.ok) {
        const data = await shiftsRes.json();
        setMonthShifts(Array.isArray(data) ? data : []);
      } else {
        setMonthShifts([]);
      }

      if (myReqRes.ok) {
        const data = await myReqRes.json();
        setMyTimeOffRequests(data.requests || []);
      } else {
        setMyTimeOffRequests([]);
      }

      if (pendingRes && pendingRes.ok) {
        const data = await pendingRes.json();
        setPendingTimeOffRequests(data.requests || []);
      } else if (!pendingRes) {
        setPendingTimeOffRequests([]);
      }
    } catch (e) {
      console.error('Failed to fetch month data:', e);
    } finally {
      setMonthLoading(false);
    }
  }, [getCurrentMonthRange, isAdmin, limitedAccess, session.sessionToken]);

  const fetchEmployees = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/v1/admin/staff`, {
        headers: { Authorization: `Bearer ${session.sessionToken}` },
      });
      if (response.ok) {
        const data = await response.json();
        setEmployees(data.staff || []);
      }
    } catch (error) {
      console.error('Failed to fetch employees:', error);
    }
  }, [session.sessionToken]);

  const fetchShifts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.append('from', `${dateFrom}T00:00:00Z`);
      if (dateTo) params.append('to', `${dateTo}T23:59:59Z`);

      // For limited access, filter to current employee only
      if (limitedAccess) {
        const currentEmployee = employees.find((e) => e.name === session.name);
        if (currentEmployee) {
          params.append('employeeId', currentEmployee.id);
        }
      } else if (employeeFilter) {
        params.append('employeeId', employeeFilter);
      }

      const response = await fetch(`${API_BASE}/v1/admin/shifts?${params}`, {
        headers: { Authorization: `Bearer ${session.sessionToken}` },
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
  }, [dateFrom, dateTo, employeeFilter, employees, limitedAccess, session.name, session.sessionToken]);

  useEffect(() => {
    if (!limitedAccess) {
      fetchEmployees();
    }
  }, [fetchEmployees, limitedAccess]);

  useEffect(() => {
    // For limited access, auto-filter to current employee
    if (limitedAccess && employees.length > 0) {
      const currentEmployee = employees.find((e) => e.name === session.name);
      if (currentEmployee && employeeFilter !== currentEmployee.id) {
        setEmployeeFilter(currentEmployee.id);
      }
    }
  }, [limitedAccess, employees, session.name, employeeFilter]);

  useEffect(() => {
    if (!limitedAccess) {
      fetchShifts();
    } else {
      setLoading(false);
    }
  }, [fetchShifts, limitedAccess]);

  useEffect(() => {
    void fetchMonthData();
  }, [fetchMonthData]);

  const formatTime = (isoString: string): string => {
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'America/Chicago',
    });
  };

  const getComplianceBadge = (shift: Shift) => {
    if (shift.flags?.noShow) {
      return { text: 'No Show', color: '#ef4444' };
    }
    if ((shift.compliancePercent ?? 0) >= 95) {
      return { text: `${shift.compliancePercent}%`, color: '#10b981' };
    }
    if ((shift.compliancePercent ?? 0) >= 80) {
      return { text: `${shift.compliancePercent}%`, color: '#f59e0b' };
    }
    return { text: `${shift.compliancePercent ?? 0}%`, color: '#ef4444' };
  };

  // Group shifts by date
  const groupedShifts = shifts.reduce(
    (acc, shift) => {
      const date = new Date(shift.scheduledStart).toLocaleDateString('en-US', {
        timeZone: 'America/Chicago',
      });
      if (!acc[date]) acc[date] = [];
      acc[date]!.push(shift);
      return acc;
    },
    {} as Record<string, Shift[]>
  );

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p>Loading shifts...</p>
      </div>
    );
  }

  // Calendar computed helpers (current month)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { start: monthStart } = getCurrentMonthRange();
  const monthTitle = monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const shiftsByDay = monthShifts.reduce(
    (acc, shift) => {
      const dayKey = new Date(shift.scheduledStart).toLocaleDateString('en-CA', {
        timeZone: 'America/Chicago',
      });
      if (!acc[dayKey]) acc[dayKey] = [];
      acc[dayKey]!.push(shift);
      return acc;
    },
    {} as Record<string, Shift[]>
  );

  const myRequestsByDay = myTimeOffRequests.reduce(
    (acc, r) => {
      acc[r.day] = r;
      return acc;
    },
    {} as Record<string, TimeOffRequest>
  );

  const firstOfMonth = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1);
  const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
  const startDow = firstOfMonth.getDay(); // 0=Sun
  const calendarCells: Array<Date | null> = [];
  for (let i = 0; i < startDow; i++) calendarCells.push(null);
  for (let d = 1; d <= daysInMonth; d++)
    calendarCells.push(new Date(monthStart.getFullYear(), monthStart.getMonth(), d));
  while (calendarCells.length < 42) calendarCells.push(null);

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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <h1 style={{ fontSize: '2rem', fontWeight: 600, margin: 0 }}>Schedule</h1>
          <div style={{ color: '#9ca3af' }}>{monthTitle}</div>
        </div>
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

      {/* View toggle (admin only) */}
      {isAdmin && (
        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
          <button
            onClick={() => setViewMode('calendar')}
            style={{
              padding: '0.6rem 1rem',
              background: viewMode === 'calendar' ? '#2B66B8' : '#374151',
              border: 'none',
              borderRadius: '8px',
              color: '#fff',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Calendar
          </button>
          <button
            onClick={() => setViewMode('list')}
            style={{
              padding: '0.6rem 1rem',
              background: viewMode === 'list' ? '#2B66B8' : '#374151',
              border: 'none',
              borderRadius: '8px',
              color: '#fff',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Shifts (detail)
          </button>
        </div>
      )}

      {/* Calendar view */}
      {viewMode === 'calendar' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isAdmin ? '1fr 420px' : '1fr',
            gap: '1.5rem',
            alignItems: 'start',
          }}
        >
          <div style={{ border: '1px solid #374151', borderRadius: '12px', overflow: 'hidden' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, 1fr)',
                background: '#111827',
                borderBottom: '1px solid #374151',
              }}
            >
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                <div
                  key={d}
                  style={{
                    padding: '0.75rem',
                    fontWeight: 700,
                    color: '#A0A1A2',
                    fontSize: '0.85rem',
                  }}
                >
                  {d}
                </div>
              ))}
            </div>

            {monthLoading ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af' }}>
                Loading month…
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
                {calendarCells.map((date, idx) => {
                  if (!date) {
                    return (
                      <div
                        key={idx}
                        style={{
                          minHeight: '140px',
                          borderRight: (idx + 1) % 7 === 0 ? 'none' : '1px solid #374151',
                          borderBottom: '1px solid #374151',
                          background: '#0b1220',
                        }}
                      />
                    );
                  }

                  const dayStr = date.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
                  const isPast = date.getTime() < today.getTime();
                  const isToday = date.getTime() === today.getTime();
                  const dayShifts = shiftsByDay[dayStr] || [];
                  const myReq = myRequestsByDay[dayStr];

                  return (
                    <div
                      key={idx}
                      onClick={() => {
                        if (isPast) return;
                        setSelectedDay(dayStr);
                        setRequestReason('');
                      }}
                      style={{
                        minHeight: '140px',
                        borderRight: (idx + 1) % 7 === 0 ? 'none' : '1px solid #374151',
                        borderBottom: '1px solid #374151',
                        background: isPast ? '#111827' : '#0b1220',
                        opacity: isPast ? 0.55 : 1,
                        cursor: isPast ? 'default' : 'pointer',
                        outline: isToday ? '2px solid #2B66B8' : 'none',
                        outlineOffset: '-2px',
                        padding: '0.5rem',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'baseline',
                          marginBottom: '0.25rem',
                        }}
                      >
                        <div style={{ fontWeight: 700 }}>{date.getDate()}</div>
                        {myReq && (
                          <div
                            style={{
                              fontSize: '0.75rem',
                              color:
                                myReq.status === 'APPROVED'
                                  ? '#22c55e'
                                  : myReq.status === 'DENIED'
                                    ? '#ef4444'
                                    : '#f59e0b',
                            }}
                          >
                            {myReq.status}
                          </div>
                        )}
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        {dayShifts.slice(0, 6).map((s) => (
                          <div
                            key={s.id}
                            style={{
                              display: 'flex',
                              gap: '0.4rem',
                              alignItems: 'center',
                              fontSize: '0.75rem',
                              lineHeight: 1.2,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            <span
                              style={{
                                padding: '0.1rem 0.4rem',
                                borderRadius: '999px',
                                background: SHIFT_BADGE_COLORS[s.shiftCode],
                                color: '#fff',
                                fontWeight: 800,
                                flex: '0 0 auto',
                              }}
                            >
                              {SHIFT_BADGE_LABELS[s.shiftCode]}
                            </span>
                            <span
                              style={{
                                color: '#e5e7eb',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {limitedAccess
                                ? SHIFT_LABELS[s.shiftCode].split(' ')[1]
                                : s.employeeName}
                            </span>
                          </div>
                        ))}
                        {dayShifts.length > 6 && (
                          <div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>
                            +{dayShifts.length - 6} more
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Admin pending requests */}
          {isAdmin && (
            <div style={{ border: '1px solid #374151', borderRadius: '12px', padding: '1rem' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '0.75rem',
                }}
              >
                <div style={{ fontWeight: 800, fontSize: '1.05rem' }}>Pending requests</div>
                <button
                  onClick={() => void fetchMonthData()}
                  style={{
                    padding: '0.4rem 0.8rem',
                    background: '#374151',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#fff',
                    cursor: 'pointer',
                    fontWeight: 700,
                  }}
                >
                  Refresh
                </button>
              </div>

              {pendingTimeOffRequests.length === 0 ? (
                <div style={{ color: '#9ca3af' }}>No pending requests.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {pendingTimeOffRequests.map((r) => (
                    <div
                      key={r.id}
                      style={{
                        border: '1px solid #374151',
                        borderRadius: '10px',
                        padding: '0.75rem',
                        background: '#111827',
                      }}
                    >
                      <div
                        style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}
                      >
                        <div style={{ fontWeight: 800 }}>{r.employeeName}</div>
                        <div style={{ color: '#93c5fd', fontWeight: 800 }}>{r.day}</div>
                      </div>
                      {r.reason && (
                        <div style={{ color: '#d1d5db', marginTop: '0.25rem', fontSize: '0.9rem' }}>
                          {r.reason}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                        <button
                          onClick={async () => {
                            await fetch(`${API_BASE}/v1/admin/time-off-requests/${r.id}`, {
                              method: 'PATCH',
                              headers: {
                                Authorization: `Bearer ${session.sessionToken}`,
                                'Content-Type': 'application/json',
                              },
                              body: JSON.stringify({ status: 'APPROVED' }),
                            });
                            await fetchMonthData();
                          }}
                          style={{
                            flex: 1,
                            padding: '0.55rem 0.8rem',
                            background: '#22c55e',
                            border: 'none',
                            borderRadius: '8px',
                            color: '#0b1220',
                            cursor: 'pointer',
                            fontWeight: 900,
                          }}
                        >
                          Approve
                        </button>
                        <button
                          onClick={async () => {
                            await fetch(`${API_BASE}/v1/admin/time-off-requests/${r.id}`, {
                              method: 'PATCH',
                              headers: {
                                Authorization: `Bearer ${session.sessionToken}`,
                                'Content-Type': 'application/json',
                              },
                              body: JSON.stringify({ status: 'DENIED' }),
                            });
                            await fetchMonthData();
                          }}
                          style={{
                            flex: 1,
                            padding: '0.55rem 0.8rem',
                            background: '#ef4444',
                            border: 'none',
                            borderRadius: '8px',
                            color: '#fff',
                            cursor: 'pointer',
                            fontWeight: 900,
                          }}
                        >
                          Deny
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Employee request modal */}
      {selectedDay && (
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
            zIndex: 2000,
          }}
          onClick={() => setSelectedDay(null)}
        >
          <div
            style={{
              background: '#1f2937',
              borderRadius: '12px',
              padding: '1.5rem',
              width: 'min(520px, 92vw)',
              border: '1px solid #374151',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 900, fontSize: '1.25rem', marginBottom: '0.5rem' }}>
              Request off: {selectedDay}
            </div>

            {myRequestsByDay[selectedDay] ? (
              <div style={{ color: '#9ca3af' }}>
                You already have a request for this day:{' '}
                <strong>{myRequestsByDay[selectedDay]!.status}</strong>
              </div>
            ) : (
              <>
                <div style={{ marginTop: '0.75rem' }}>
                  <label
                    style={{
                      display: 'block',
                      marginBottom: '0.35rem',
                      fontWeight: 800,
                      fontSize: '0.9rem',
                    }}
                  >
                    Reason (optional)
                  </label>
                  <textarea
                    value={requestReason}
                    onChange={(e) => setRequestReason(e.target.value)}
                    rows={3}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      background: '#111827',
                      border: '1px solid #374151',
                      borderRadius: '8px',
                      color: '#f9fafb',
                      fontSize: '0.95rem',
                    }}
                  />
                </div>

                <div
                  style={{
                    display: 'flex',
                    gap: '0.75rem',
                    justifyContent: 'flex-end',
                    marginTop: '1rem',
                  }}
                >
                  <button
                    onClick={() => setSelectedDay(null)}
                    style={{
                      padding: '0.7rem 1rem',
                      background: '#374151',
                      border: 'none',
                      borderRadius: '8px',
                      color: '#fff',
                      cursor: 'pointer',
                      fontWeight: 800,
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    disabled={submittingRequest}
                    onClick={async () => {
                      setSubmittingRequest(true);
                      try {
                        const res = await fetch(`${API_BASE}/v1/schedule/time-off-requests`, {
                          method: 'POST',
                          headers: {
                            Authorization: `Bearer ${session.sessionToken}`,
                            'Content-Type': 'application/json',
                          },
                          body: JSON.stringify({
                            day: selectedDay,
                            reason: requestReason || undefined,
                          }),
                        });
                        if (!res.ok) {
                          const body = await res.json().catch(() => ({}));
                          alert(body.error || 'Failed to submit request');
                          return;
                        }
                        await fetchMonthData();
                        setSelectedDay(null);
                      } finally {
                        setSubmittingRequest(false);
                      }
                    }}
                    style={{
                      padding: '0.7rem 1rem',
                      background: submittingRequest ? '#6b7280' : '#2B66B8',
                      border: 'none',
                      borderRadius: '8px',
                      color: '#fff',
                      cursor: submittingRequest ? 'not-allowed' : 'pointer',
                      fontWeight: 900,
                    }}
                  >
                    {submittingRequest ? 'Submitting…' : 'Submit request'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Filters */}
      {isAdmin && viewMode === 'list' && (
        <div
          style={{
            display: 'flex',
            gap: '1rem',
            marginBottom: '2rem',
            padding: '1rem',
            background: '#1f2937',
            borderRadius: '8px',
          }}
        >
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
              From
            </label>
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
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
              To
            </label>
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
          {!limitedAccess && (
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
                Employee
              </label>
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
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {limitedAccess && (
            <div
              style={{
                padding: '0.5rem',
                background: '#1e3a5f',
                borderRadius: '6px',
                color: '#93c5fd',
              }}
            >
              <strong>View Only:</strong> You can view your schedule only
            </div>
          )}
        </div>
      )}

      {/* Shifts grouped by date */}
      {isAdmin && viewMode === 'list' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {Object.entries(groupedShifts).map(([date, dateShifts]) => (
            <div
              key={date}
              style={{ border: '1px solid #374151', borderRadius: '8px', overflow: 'hidden' }}
            >
              <div
                style={{
                  padding: '1rem',
                  background: '#374151',
                  fontWeight: 600,
                  fontSize: '1.125rem',
                }}
              >
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
                    {dateShifts.map((shift) => {
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
                            <span
                              style={{
                                padding: '0.25rem 0.75rem',
                                borderRadius: '4px',
                                background: badge.color,
                                color: '#fff',
                                fontSize: '0.875rem',
                                fontWeight: 600,
                              }}
                            >
                              {badge.text}
                            </span>
                          </td>
                          <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>
                            {shift.flags?.lateClockIn && (
                              <span style={{ color: '#f59e0b' }}>⚠️ Late</span>
                            )}
                            {shift.flags?.earlyClockOut && (
                              <span style={{ color: '#f59e0b' }}>⚠️ Early</span>
                            )}
                            {shift.flags?.missingClockOut && (
                              <span style={{ color: '#ef4444' }}>⚠️ No Out</span>
                            )}
                            {shift.flags?.noShow && (
                              <span style={{ color: '#ef4444' }}>❌ No Show</span>
                            )}
                          </td>
                          <td style={{ padding: '0.75rem' }}>
                            {!limitedAccess && (
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
                            )}
                            {limitedAccess && (
                              <span style={{ color: '#9ca3af', fontSize: '0.875rem' }}>
                                View Only
                              </span>
                            )}
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
      )}

      {shifts.length === 0 && !loading && (
        <div style={{ textAlign: 'center', padding: '4rem 0', color: '#9ca3af' }}>
          <p>No shifts found for the selected date range</p>
        </div>
      )}

      {/* Edit Shift Modal */}
      {isAdmin && viewMode === 'list' && showEditModal && selectedShift && (
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
                  Authorization: `Bearer ${session.sessionToken}`,
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
        <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1.5rem' }}>Edit Shift</h2>
        <div style={{ marginBottom: '1rem' }}>
          <label
            style={{
              display: 'block',
              marginBottom: '0.5rem',
              fontSize: '0.875rem',
              fontWeight: 600,
            }}
          >
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
          <label
            style={{
              display: 'block',
              marginBottom: '0.5rem',
              fontSize: '0.875rem',
              fontWeight: 600,
            }}
          >
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
          <label
            style={{
              display: 'block',
              marginBottom: '0.5rem',
              fontSize: '0.875rem',
              fontWeight: 600,
            }}
          >
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
          <label
            style={{
              display: 'block',
              marginBottom: '0.5rem',
              fontSize: '0.875rem',
              fontWeight: 600,
            }}
          >
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
