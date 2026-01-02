import { useMemo } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import type { StaffSession } from './LockScreen';

type NavItem = { to: string; label: string; icon: string; adminOnly?: boolean; staffOnly?: boolean };

export function OfficeShell({
  session,
  onLogout,
}: {
  session: StaffSession;
  onLogout: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const isAdmin = session.role === 'ADMIN';

  const navItems = useMemo<NavItem[]>(() => {
    const admin: NavItem[] = [
      { to: '/overview', label: 'Overview', icon: '📍', adminOnly: true },
      { to: '/monitor', label: 'Monitor', icon: '🛰️', adminOnly: true },
      { to: '/waitlist', label: 'Waitlist', icon: '🕒', adminOnly: true },
      { to: '/reports', label: 'Reports', icon: '📊', adminOnly: true },
      { to: '/customers', label: 'Customers', icon: '🗂️', adminOnly: true },
    ];

    const staff: NavItem[] = [
      { to: '/schedule', label: 'Schedule', icon: '📅', staffOnly: true },
      { to: '/messages', label: 'Messages', icon: '💬', staffOnly: true },
    ];

    return [...admin, ...staff];
  }, []);

  return (
    <div className="dashboard">
      <aside className="sidebar">
        <div className="logo" onClick={() => navigate(isAdmin ? '/overview' : '/schedule')} style={{ cursor: 'pointer' }}>
          <span className="logo-icon">🏢</span>
          <span className="logo-text">Club Ops</span>
        </div>

        <nav className="nav">
          {navItems
            .filter((i) => (i.adminOnly ? isAdmin : i.staffOnly ? !isAdmin : true))
            .map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              >
                <span aria-hidden="true">{item.icon}</span>
                <span>{item.label}</span>
              </NavLink>
            ))}
        </nav>

        <div className="sidebar-footer">
          <div className="connection-status">
            <span className="dot dot-live"></span>
            <span>Realtime</span>
          </div>
          <div style={{ marginTop: '0.75rem', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
            {session.name} ({session.role})
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <h1>
            {isAdmin ? 'Office Dashboard (Admin)' : 'Office Dashboard (Staff)'}
          </h1>
          <div className="topbar-status" style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{ color: 'var(--text-muted)' }}>{location.pathname}</span>
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
              }}
            >
              Sign Out
            </button>
          </div>
        </header>

        <div className="content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}


