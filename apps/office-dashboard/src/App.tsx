import { useEffect, useState } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { RoomStatus, RoomType, type DetailedInventory, type WebSocketEvent, type InventoryUpdatedPayload } from '@club-ops/shared';
import { LockScreen, type StaffSession } from './LockScreen';
import { AdminView } from './AdminView';

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
      <LockScreen
        onLogin={handleLogin}
        deviceType="desktop"
        deviceId={deviceId}
      />
    );
  }

  // Render routes
  return (
    <Routes>
      <Route path="/admin" element={<AdminView session={session} />} />
      <Route path="/" element={<DashboardContent session={session} />} />
    </Routes>
  );
}

function DashboardContent({ session }: { session: StaffSession }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [activeTab, setActiveTab] = useState<'rooms' | 'lockers' | 'staff'>('rooms');
  const [inventory, setInventory] = useState<InventorySummary | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);

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
    // Clear session and reload
    localStorage.removeItem('staff_session');
    window.location.href = '/';
  };

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
    fetch('/api/v1/inventory/rooms')
      .then((res) => res.json())
      .then((data: { rooms: Room[] }) => setRooms(data.rooms))
      .catch(console.error);

    // Connect to WebSocket
    const ws = new WebSocket(`ws://${window.location.hostname}:3001/ws`);

    ws.onopen = () => {
      console.log('WebSocket connected');
      setWsConnected(true);
      
      // Subscribe to inventory updates
      ws.send(JSON.stringify({
        type: 'subscribe',
        events: ['INVENTORY_UPDATED', 'ROOM_STATUS_CHANGED'],
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
          fetch('/api/v1/inventory/rooms')
            .then((res) => res.json())
            .then((data: { rooms: Room[] }) => setRooms(data.rooms))
            .catch(console.error);
        } else if (message.type === 'ROOM_STATUS_CHANGED') {
          // Refresh rooms list when room status changes
          fetch('/api/v1/inventory/rooms')
            .then((res) => res.json())
            .then((data: { rooms: Room[] }) => setRooms(data.rooms))
            .catch(console.error);
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    return () => ws.close();
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
          {session.role === 'ADMIN' && (
            <button
              className={`nav-item ${location.pathname === '/admin' ? 'active' : ''}`}
              onClick={() => navigate('/admin')}
            >
              ⚙️ Operations Admin
            </button>
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
              onClick={handleLogout}
              style={{
                marginLeft: '1rem',
                padding: '0.5rem 1rem',
                background: 'var(--error)',
                border: 'none',
                borderRadius: '0.375rem',
                color: 'white',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
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

          {activeTab !== 'rooms' && (
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

