import { useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { LockScreen, type StaffSession } from './LockScreen';
import { ShiftsView } from './ShiftsView';
import { OfficeShell } from './OfficeShell';
import { DemoOverview } from './DemoOverview';
import { LaneMonitorView } from './LaneMonitorView';
import { WaitlistManagementView } from './WaitlistManagementView';
import { CustomerAdminToolsView } from './CustomerAdminToolsView';
import { ReportsDemoView } from './ReportsDemoView';
import { MessagesView } from './MessagesView';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';

// Material Design Dark Theme - Matching Dashboard Aesthetic
const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#2B66B8', // Accent blue
      light: '#4F7FD0',
      dark: '#1E4F93',
    },
    secondary: {
      main: '#A0A1A2', // Muted
      light: '#C0C1C2',
      dark: '#808182',
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
      default: '#282828', // Background
      paper: '#2B2B2D', // Cards/surfaces
    },
    text: {
      primary: '#EFF0F1', // Primary text
      secondary: '#A0A1A2', // Secondary text
    },
    divider: '#3F4042', // Borders
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
          backgroundColor: '#2B2B2D',
          border: '1px solid #3F4042',
          backgroundImage:
            'linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(0,0,0,0.10) 100%)',
          boxShadow: '0 10px 25px rgba(0,0,0,0.35), 0 2px 6px rgba(0,0,0,0.25)',
          overflow: 'hidden',
          position: 'relative',
          transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
          '&::before': {
            content: '""',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '2px',
            background: 'linear-gradient(90deg, transparent, rgba(43,102,184,0.85), transparent)',
            zIndex: 1,
          },
          '&::after': {
            content: '""',
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '40%',
            background:
              'radial-gradient(ellipse at top left, rgba(43,102,184,0.14), transparent 70%)',
            pointerEvents: 'none',
            zIndex: 0,
          },
          '&:hover': {
            borderColor: '#2B66B8',
            boxShadow: '0 12px 30px rgba(0,0,0,0.4), 0 4px 8px rgba(0,0,0,0.3)',
            transform: 'translateY(-2px)',
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundColor: '#2B2B2D',
          border: '1px solid #3F4042',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: '#2B2B2D',
          borderBottom: '1px solid #3F4042',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.3)',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: '#2B2B2D',
          borderRight: '1px solid #3F4042',
          boxShadow: '0 1px 5px rgba(0, 0, 0, 0.3), 0 2px 2px rgba(0, 0, 0, 0.2)',
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderColor: '#3F4042',
        },
        head: {
          backgroundColor: '#2B2B2D',
          color: '#A0A1A2',
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
          backgroundColor: '#282828',
          '&:hover': {
            borderColor: '#3F4042',
          },
          '&.Mui-focused': {
            borderColor: '#2B66B8',
            boxShadow: '0 0 0 3px rgba(43, 102, 184, 0.1)',
          },
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderColor: '#3F4042',
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: '#3F4042',
          },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: '#2B66B8',
          },
        },
      },
    },
  },
});

function App() {
  const [session, setSession] = useState<StaffSession | null>(() => {
    // Load session from localStorage on mount
    const stored = window.localStorage.getItem('staff_session');
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
    const storage = window.localStorage;
    let id = storage.getItem('device_id');
    if (!id) {
      id = `device-${crypto.randomUUID()}`;
      storage.setItem('device_id', id);
    }
    return id;
  })[0];

  const handleLogin = (newSession: StaffSession) => {
    setSession(newSession);
    window.localStorage.setItem('staff_session', JSON.stringify(newSession));
  };

  const handleLogout = async () => {
    if (session?.sessionToken) {
      try {
        await fetch(`/api/v1/auth/logout`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.sessionToken}`,
          },
        });
      } catch (error) {
        console.error('Logout error:', error);
      }
    }
    setSession(null);
    window.localStorage.removeItem('staff_session');
  };

  // Show lock screen if not authenticated
  if (!session) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <LockScreen onLogin={handleLogin} deviceType="desktop" deviceId={deviceId} />
      </ThemeProvider>
    );
  }

  const isAdmin = session.role === 'ADMIN';

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Routes>
        <Route path="/" element={<Navigate to={isAdmin ? '/overview' : '/schedule'} replace />} />
        <Route element={<OfficeShell session={session} onLogout={handleLogout} />}>
          <Route
            path="/overview"
            element={
              isAdmin ? <DemoOverview session={session} /> : <Navigate to="/schedule" replace />
            }
          />
          <Route
            path="/monitor"
            element={
              isAdmin ? <LaneMonitorView session={session} /> : <Navigate to="/schedule" replace />
            }
          />
          <Route
            path="/waitlist"
            element={
              isAdmin ? (
                <WaitlistManagementView session={session} />
              ) : (
                <Navigate to="/schedule" replace />
              )
            }
          />
          <Route
            path="/reports"
            element={
              isAdmin ? <ReportsDemoView session={session} /> : <Navigate to="/schedule" replace />
            }
          />
          <Route
            path="/customers"
            element={
              isAdmin ? (
                <CustomerAdminToolsView session={session} />
              ) : (
                <Navigate to="/schedule" replace />
              )
            }
          />

          <Route
            path="/schedule"
            element={<ShiftsView session={session} limitedAccess={!isAdmin} />}
          />
          <Route
            path="/messages"
            element={isAdmin ? <Navigate to="/overview" replace /> : <MessagesView />}
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ThemeProvider>
  );
}

export default App;
