import { useEffect, useState } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { RoomStatus, RoomType, type DetailedInventory, type WebSocketEvent, type InventoryUpdatedPayload } from '@club-ops/shared';
import { LockScreen, type StaffSession } from './LockScreen';
import { AdminView } from './AdminView';
import { StaffManagement } from './StaffManagement';
import { RegistersView } from './RegistersView';
import { DevicesView } from './DevicesView';
import { ShiftsView } from './ShiftsView';
import { TimeclockView } from './TimeclockView';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { Box } from '@mui/material';

interface HealthStatus {
  status: string;
  timestamp: string;
  uptime: number;
}

interface Room {
  id: string;
  number: string;
  type: string;
  status: RoomStatus;
  floor: number;
  lastStatusChange: Date;
  assignedTo?: string;
  assignedMemberName?: string;
  overrideFlag: boolean;
}

interface InventorySummary {
  byType: Record<string, { clean: number; cleaning: number; dirty: number; total: number }>;
  overall: { clean: number; cleaning: number; dirty: number; total: number };
  lockers: { clean: number; cleaning: number; dirty: number; total: number };
}

const API_BASE = '/api';

// Material Design Dark Theme - Matching Dashboard Aesthetic
const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#8b5cf6',        // Purple
      light: '#a78bfa',
      dark: '#7c3aed',
    },
    secondary: {
      main: '#0ea5e9',        // Sky Blue
      light: '#38bdf8',
      dark: '#0284c7',
    },
    success: {
      main: '#22c55e',
      light: '#4ade80',
      dark: '#16a34a',
    },
    warning: {
      main: '#f59e0b',
      light: '#fbbf24',
      dark: '#d97706',
    },
    error: {
      main: '#ef4444',
      light: '#f87171',
      dark: '#dc2626',
    },
    info: {
      main: '#3b82f6',
      light: '#60a5fa',
      dark: '#2563eb',
    },
    background: {
      default: '#111827',     // Dark gray-900
      paper: '#1f2937',       // Dark gray-800
    },
    text: {
      primary: '#f9fafb',      // Light gray-50
      secondary: '#9ca3af',   // Gray-400
    },
    divider: '#374151',       // Gray-700
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h4: {
      fontWeight: 600,
      letterSpacing: '-0.02em',
      color: '#f9fafb',
    },
    h5: {
      fontWeight: 600,
      letterSpacing: '-0.01em',
      color: '#f9fafb',
    },
    h6: {
      fontWeight: 600,
      color: '#f9fafb',
    },
    button: {
      textTransform: 'none',
      fontWeight: 600,
    },
    body1: {
      color: '#f9fafb',
    },
    body2: {
      color: '#9ca3af',
    },
  },
  shape: {
    borderRadius: 12,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          padding: '10px 24px',
          fontSize: '0.9375rem',
          boxShadow: '0 1px 5px rgba(0, 0, 0, 0.3), 0 2px 2px rgba(0, 0, 0, 0.2)',
          transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
          '&:hover': {
            boxShadow: '0 1px 8px rgba(0, 0, 0, 0.3), 0 3px 4px rgba(0, 0, 0, 0.2)',
            transform: 'translateY(-2px)',
          },
          '&:active': {
            transform: 'translateY(0)',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.3)',
          },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundColor: '#1f2937',
          border: '1px solid #374151',
          boxShadow: '0 1px 5px rgba(0, 0, 0, 0.3), 0 2px 2px rgba(0, 0, 0, 0.2)',
          transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
          '&:hover': {
            boxShadow: '0 2px 4px rgba(0, 0, 0, 0.3), 0 7px 13px rgba(0, 0, 0, 0.2)',
            transform: 'translateY(-2px)',
            borderColor: '#4b5563',
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundColor: '#1f2937',
          border: '1px solid #374151',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: '#1f2937',
          borderBottom: '1px solid #374151',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.3)',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: '#1f2937',
          borderRight: '1px solid #374151',
          boxShadow: '0 1px 5px rgba(0, 0, 0, 0.3), 0 2px 2px rgba(0, 0, 0, 0.2)',
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderColor: '#374151',
        },
        head: {
          backgroundColor: '#1f2937',
          color: '#9ca3af',
          fontWeight: 600,
          textTransform: 'uppercase',
          fontSize: '0.75rem',
          letterSpacing: '0.05em',
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          '&:hover': {
            backgroundColor: 'rgba(255, 255, 255, 0.05)',
          },
        },
      },
    },
    MuiInputBase: {
      styleOverrides: {
        root: {
          backgroundColor: '#111827',
          '&:hover': {
            borderColor: '#4b5563',
          },
          '&.Mui-focused': {
            borderColor: '#8b5cf6',
            boxShadow: '0 0 0 3px rgba(139, 92, 246, 0.1)',
          },
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderColor: '#374151',
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: '#4b5563',
          },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: '#8b5cf6',
          },
        },
      },
    },
  },
});

function App() {
  const [session, setSession] = useState<StaffSession | null>(() => {
    // Load session from localStorage on mount
    const stored = localStorage.getItem('staff_session');
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        return null;
      }
    }
    return null;
  });

  const deviceId = useState(() => {
    // Generate or retrieve device ID
    let id = localStorage.getItem('device_id');
    if (!id) {
      id = `device-${crypto.randomUUID()}`;
      localStorage.setItem('device_id', id);
    }
    return id;
  })[0];

  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [activeTab, setActiveTab] = useState<'rooms' | 'lockers' | 'staff'>('rooms');
  const [inventory, setInventory] = useState<InventorySummary | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);

  const handleLogin = (newSession: StaffSession) => {
    setSession(newSession);
    localStorage.setItem('staff_session', JSON.stringify(newSession));
  };

  const handleLogout = async () => {
    if (session?.sessionToken) {
      try {
        await fetch(`${API_BASE}/v1/auth/logout`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.sessionToken}`,
          },
        });
      } catch (error) {
        console.error('Logout error:', error);
      }
    }
    setSession(null);
    localStorage.removeItem('staff_session');
  };

  const location = useLocation();
  const navigate = useNavigate();

  // Show lock screen if not authenticated
  if (!session) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <LockScreen
          onLogin={handleLogin}
          deviceType="desktop"
          deviceId={deviceId}
        />
      </ThemeProvider>
    );
  }

  // Render routes - protect admin routes
  // John Erikson has limited access (only schedule view)
  // Cruz and other admins have full access
  const isAdmin = session.role === 'ADMIN';
  const isLimitedAccess = session.name === 'John Erikson';
  const hasFullAccess = isAdmin && !isLimitedAccess;
  
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Routes>
        <Route path="/admin" element={hasFullAccess ? <AdminView session={session} /> : <NotAuthorizedView />} />
        <Route path="/admin/staff" element={hasFullAccess ? <StaffManagement session={session} /> : <NotAuthorizedView />} />
        <Route path="/admin/registers" element={hasFullAccess ? <RegistersView session={session} /> : <NotAuthorizedView />} />
        <Route path="/admin/devices" element={hasFullAccess ? <DevicesView session={session} /> : <NotAuthorizedView />} />
        <Route path="/admin/shifts" element={(hasFullAccess || isLimitedAccess) ? <ShiftsView session={session} limitedAccess={isLimitedAccess} /> : <NotAuthorizedView />} />
        <Route path="/admin/timeclock" element={hasFullAccess ? <TimeclockView session={session} /> : <NotAuthorizedView />} />
        <Route path="/" element={<DashboardContent session={session} onLogout={handleLogout} />} />
      </Routes>
    </ThemeProvider>
  );
}

function NotAuthorizedView() {
  const navigate = useNavigate();
  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <h1>Not authorized</h1>
      <p>You must be an administrator to access this page.</p>
      <button
        onClick={() => navigate('/')}
        style={{
          marginTop: '1rem',
          padding: '0.75rem 1.5rem',
          background: '#8b5cf6',
          border: 'none',
          borderRadius: '6px',
          color: '#f9fafb',
          cursor: 'pointer',
          fontSize: '1rem',
        }}
      >
        Return to Dashboard
      </button>
    </div>
  );
}

interface LaneSession {
  id: string;
  laneId: string;
  status: string;
  customerName?: string;
  membershipNumber?: string;
  desiredRentalType?: string;
  assignedResource?: { type: 'room' | 'locker'; number: string };
  staffName?: string;
  createdAt: string;
}

function DashboardContent({ session, onLogout }: { session: StaffSession; onLogout: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [activeTab, setActiveTab] = useState<'rooms' | 'lockers' | 'staff'>('rooms');
  const [inventory, setInventory] = useState<InventorySummary | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [laneSessions, setLaneSessions] = useState<LaneSession[]>([]);
  
  const isAdmin = session.role === 'ADMIN';
  const isLimitedAccess = session.name === 'John Erikson';
  const hasFullAccess = isAdmin && !isLimitedAccess;

  useEffect(() => {
    // Check API health
    fetch('/api/health')
      .then((res) => res.json())
      .then((data: HealthStatus) => setHealth(data))
      .catch(console.error);

    // Fetch initial inventory summary
    fetch('/api/v1/inventory/summary')
      .then((res) => res.json())
      .then((data: InventorySummary) => setInventory(data))
      .catch(console.error);

    // Fetch initial rooms list
    fetch('/api/v1/inventory/rooms', {
      headers: {
        'Authorization': `Bearer ${session.sessionToken}`,
      },
    })
      .then((res) => res.json())
      .then((data: { rooms: Room[] }) => setRooms(data.rooms))
      .catch(console.error);

    // Fetch active lane sessions
    fetch('/api/v1/checkin/lane-sessions', {
      headers: {
        'Authorization': `Bearer ${session.sessionToken}`,
      },
    })
      .then((res) => res.json())
      .then((data: { sessions: typeof laneSessions }) => setLaneSessions(data.sessions || []))
      .catch(console.error);

    // Connect to WebSocket
    const ws = new WebSocket(`ws://${window.location.hostname}:3001/ws`);

    ws.onopen = () => {
      console.log('WebSocket connected');
      setWsConnected(true);
      
      // Subscribe to inventory updates, session updates, and register session updates
      ws.send(JSON.stringify({
        type: 'subscribe',
        events: ['INVENTORY_UPDATED', 'ROOM_STATUS_CHANGED', 'SESSION_UPDATED', 'REGISTER_SESSION_UPDATED'],
      }));
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setWsConnected(false);
    };

    ws.onmessage = (event) => {
      try {
        const message: WebSocketEvent = JSON.parse(event.data);
        console.log('WebSocket message:', message);

        if (message.type === 'INVENTORY_UPDATED') {
          const payload = message.payload as InventoryUpdatedPayload;
          setInventory({
            byType: payload.inventory.byType,
            overall: payload.inventory.overall,
            lockers: payload.inventory.lockers,
          });
          
          // Refresh rooms list when inventory updates
          fetch('/api/v1/inventory/rooms', {
            headers: {
              'Authorization': `Bearer ${session.sessionToken}`,
            },
          })
            .then((res) => res.json())
            .then((data: { rooms: Room[] }) => setRooms(data.rooms))
            .catch(console.error);
        } else if (message.type === 'ROOM_STATUS_CHANGED') {
          // Refresh rooms list when room status changes
          fetch('/api/v1/inventory/rooms', {
            headers: {
              'Authorization': `Bearer ${session.sessionToken}`,
            },
          })
            .then((res) => res.json())
            .then((data: { rooms: Room[] }) => setRooms(data.rooms))
            .catch(console.error);
        } else if (message.type === 'SESSION_UPDATED') {
          // Refresh lane sessions when session updates
          fetch('/api/v1/checkin/lane-sessions', {
            headers: {
              'Authorization': `Bearer ${session.sessionToken}`,
            },
          })
            .then((res) => res.json())
            .then((data: { sessions: typeof laneSessions }) => setLaneSessions(data.sessions || []))
            .catch(console.error);
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    return () => {
      wsConnection.close();
      setWs(null);
    };
  }, []);

  return (
    <div className="dashboard">
      <aside className="sidebar">
        <div className="logo">
          <span className="logo-icon">🏢</span>
          <span className="logo-text">Club Ops</span>
        </div>
        <nav className="nav">
          <button
            className={`nav-item ${activeTab === 'rooms' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('rooms');
              navigate('/');
            }}
          >
            🚪 Rooms
          </button>
          <button
            className={`nav-item ${activeTab === 'lockers' ? 'active' : ''}`}
            onClick={() => setActiveTab('lockers')}
          >
            🔐 Lockers
          </button>
          <button
            className={`nav-item ${activeTab === 'staff' ? 'active' : ''}`}
            onClick={() => setActiveTab('staff')}
          >
            👥 Staff
          </button>
          <button
            className={`nav-item ${activeTab === 'checkins' ? 'active' : ''}`}
            onClick={() => setActiveTab('checkins')}
          >
            🏁 Check-ins
          </button>
          {(hasFullAccess || isLimitedAccess) && (
            <button
              className={`nav-item ${location.pathname === '/admin/shifts' ? 'active' : ''}`}
              onClick={() => navigate('/admin/shifts')}
            >
              📅 Shifts
            </button>
          )}
          {hasFullAccess && (
            <button
              className={`nav-item ${location.pathname === '/admin/timeclock' ? 'active' : ''}`}
              onClick={() => navigate('/admin/timeclock')}
            >
              ⏰ Timeclock
            </button>
          )}
          {hasFullAccess && (
            <>
              <button
                className={`nav-item ${location.pathname === '/admin/staff' ? 'active' : ''}`}
                onClick={() => navigate('/admin/staff')}
              >
                👤 Staff Management
              </button>
              <button
                className={`nav-item ${location.pathname === '/admin/registers' ? 'active' : ''}`}
                onClick={() => navigate('/admin/registers')}
              >
                🖥️ Registers
              </button>
              <button
                className={`nav-item ${location.pathname === '/admin/devices' ? 'active' : ''}`}
                onClick={() => navigate('/admin/devices')}
              >
                📱 Devices
              </button>
              <button
                className={`nav-item ${location.pathname === '/admin' ? 'active' : ''}`}
                onClick={() => navigate('/admin')}
              >
                ⚙️ Operations Admin
              </button>
            </>
          )}
        </nav>
        <div className="sidebar-footer">
          <div className="connection-status">
            <span className={`dot ${wsConnected ? 'dot-live' : 'dot-offline'}`}></span>
            <span>{wsConnected ? 'Live' : 'Offline'}</span>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <h1>Office Dashboard</h1>
          <div className="topbar-status">
            <span className="api-status">
              API: <strong className={health?.status === 'ok' ? 'text-success' : 'text-error'}>
                {health?.status ?? 'checking...'}
              </strong>
            </span>
            <span style={{ marginLeft: '1rem', color: 'var(--text-muted)' }}>
              {session.name} ({session.role})
            </span>
            <button
              onClick={onLogout}
              style={{
                marginLeft: '1rem',
                padding: '0.5rem 1rem',
                background: '#d32f2f',
                border: 'none',
                borderRadius: '0.375rem',
                color: 'white',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#c62828'}
              onMouseLeave={(e) => e.currentTarget.style.background = '#d32f2f'}
            >
              Sign Out
            </button>
          </div>
        </header>

        <div className="content">
          {activeTab === 'rooms' && (
            <>
              <section className="stats-grid">
                <div className="stat-card">
                  <span className="stat-value">{inventory?.overall.total ?? 0}</span>
                  <span className="stat-label">Total Rooms</span>
                </div>
                <div className="stat-card stat-available">
                  <span className="stat-value">{inventory?.overall.clean ?? 0}</span>
                  <span className="stat-label">{RoomStatus.CLEAN}</span>
                </div>
                <div className="stat-card stat-cleaning">
                  <span className="stat-value">{inventory?.overall.cleaning ?? 0}</span>
                  <span className="stat-label">{RoomStatus.CLEANING}</span>
                </div>
                <div className="stat-card stat-occupied">
                  <span className="stat-value">{inventory?.overall.dirty ?? 0}</span>
                  <span className="stat-label">{RoomStatus.DIRTY}</span>
                </div>
              </section>

              {inventory && (
                <section className="inventory-breakdown">
                  <h2>Inventory by Type</h2>
                  <div className="inventory-type-grid">
                    {Object.entries(inventory.byType).map(([type, counts]) => (
                      <div key={type} className="inventory-type-card">
                        <h3>{type}</h3>
                        <div className="inventory-counts">
                          <div className="count-item">
                            <span className="count-label">{RoomStatus.CLEAN}:</span>
                            <span className="count-value">{counts.clean}</span>
                          </div>
                          <div className="count-item">
                            <span className="count-label">{RoomStatus.CLEANING}:</span>
                            <span className="count-value">{counts.cleaning}</span>
                          </div>
                          <div className="count-item">
                            <span className="count-label">{RoomStatus.DIRTY}:</span>
                            <span className="count-value">{counts.dirty}</span>
                          </div>
                          <div className="count-item count-total">
                            <span className="count-label">Total:</span>
                            <span className="count-value">{counts.total}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section className="panel">
                <div className="panel-header">
                  <h2>Rooms Detail</h2>
                  <button className="btn-override">⚡ Override Mode</button>
                </div>
                <div className="panel-content">
                  <table className="rooms-table">
                    <thead>
                      <tr>
                        <th>Room</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th>Last Change</th>
                        <th>Assigned To</th>
                        <th>Override</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rooms.map((room) => (
                        <tr key={room.id}>
                          <td className="room-number">{room.number}</td>
                          <td>{room.type}</td>
                          <td>
                            <span className={`status-badge status-${room.status.toLowerCase()}`}>
                              {room.status}
                            </span>
                          </td>
                          <td className="last-change">
                            {new Date(room.lastStatusChange).toLocaleString()}
                          </td>
                          <td className="assigned-to">
                            {room.assignedMemberName || '-'}
                          </td>
                          <td>
                            {room.overrideFlag && (
                              <span className="override-flag">⚠️</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          {activeTab === 'checkins' && (
            <section className="panel">
              <div className="panel-header">
                <h2>Active Check-in Sessions</h2>
              </div>
              <div className="panel-content">
                {laneSessions.length === 0 ? (
                  <div className="placeholder">
                    <span className="placeholder-icon">🏁</span>
                    <p>No active check-in sessions</p>
                  </div>
                ) : (
                  <table className="rooms-table">
                    <thead>
                      <tr>
                        <th>Lane</th>
                        <th>Status</th>
                        <th>Customer</th>
                        <th>Membership</th>
                        <th>Rental Type</th>
                        <th>Assigned</th>
                        <th>Staff</th>
                        <th>Started</th>
                      </tr>
                    </thead>
                    <tbody>
                      {laneSessions.map((session) => (
                        <tr key={session.id}>
                          <td className="room-number">{session.laneId}</td>
                          <td>
                            <span className={`status-badge status-${session.status.toLowerCase()}`}>
                              {session.status}
                            </span>
                          </td>
                          <td>{session.customerName || '-'}</td>
                          <td>{session.membershipNumber || '-'}</td>
                          <td>{session.desiredRentalType || '-'}</td>
                          <td>
                            {session.assignedResource
                              ? `${session.assignedResource.type === 'room' ? 'Room' : 'Locker'} ${session.assignedResource.number}`
                              : '-'}
                          </td>
                          <td>{session.staffName || '-'}</td>
                          <td className="last-change">
                            {new Date(session.createdAt).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          )}

          {activeTab !== 'rooms' && activeTab !== 'checkins' && (
            <section className="panel">
              <div className="panel-header">
                <h2>{activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} Overview</h2>
                <button className="btn-override">⚡ Override Mode</button>
              </div>
              <div className="panel-content">
                <div className="placeholder">
                  <span className="placeholder-icon">📊</span>
                  <p>
                    {activeTab === 'lockers' && 'Locker allocation matrix'}
                    {activeTab === 'staff' && 'Staff activity and shift assignments'}
                  </p>
                </div>
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;

