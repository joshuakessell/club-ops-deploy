import { useEffect, useState } from 'react';
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
import { Box, Button, CircularProgress, Typography } from '@mui/material';
import CssBaseline from '@mui/material/CssBaseline';
import { getApiUrl } from '@/lib/apiBase';

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
          position: 'relative',
          overflow: 'hidden',
          borderRadius: 8,
          padding: '10px 24px',
          fontSize: '0.9375rem',
          background: 'rgba(255, 255, 255, 0.025)',
          border: '1px solid rgba(255, 255, 255, 0.5)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.75), 0 0 9px rgba(0,0,0,0.2), 0 3px 8px rgba(0,0,0,0.15)',
          color: '#fff',
          transition: 'background-color 300ms, border-color 300ms, box-shadow 300ms, transform 150ms',
          '&::before': {
            content: '""',
            position: 'absolute',
            inset: 0,
            borderRadius: 'inherit',
            pointerEvents: 'none',
            background: 'linear-gradient(to bottom right, rgba(255,255,255,0.6), rgba(255,255,255,0), rgba(255,255,255,0))',
            opacity: 0.7,
          },
          '&::after': {
            content: '""',
            position: 'absolute',
            inset: 0,
            borderRadius: 'inherit',
            pointerEvents: 'none',
            background: 'linear-gradient(to top left, rgba(255,255,255,0.3), rgba(255,255,255,0), rgba(255,255,255,0))',
            opacity: 0.5,
          },
          '&:hover': {
            background: 'rgba(255, 255, 255, 0.3)',
          },
          '&:active': {
            transform: 'translateY(1px)',
          },
          '&:focus-visible': {
            outline: '2px solid rgba(255,255,255,0.3)',
            outlineOffset: '2px',
          },
          '&.Mui-disabled': {
            opacity: 0.55,
            cursor: 'not-allowed',
          },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          position: 'relative',
          backgroundColor: 'rgba(0, 0, 0, 0.2)',
          border: '1px solid rgba(255,255,255,0.5)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.75), 0 0 9px rgba(0,0,0,0.2), 0 3px 8px rgba(0,0,0,0.15)',
          color: '#fff',
          overflow: 'hidden',
          transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
          '&::before': {
            content: '""',
            position: 'absolute',
            inset: 0,
            borderRadius: 'inherit',
            pointerEvents: 'none',
            zIndex: 0,
            background: 'linear-gradient(to bottom right, rgba(255,255,255,0.6), rgba(255,255,255,0), rgba(255,255,255,0))',
            opacity: 0.7,
          },
          '&::after': {
            content: '""',
            position: 'absolute',
            inset: 0,
            borderRadius: 'inherit',
            pointerEvents: 'none',
            zIndex: 0,
            background: 'linear-gradient(to top left, rgba(255,255,255,0.3), rgba(255,255,255,0), rgba(255,255,255,0))',
            opacity: 0.5,
          },
          '& > *': {
            position: 'relative',
            zIndex: 1,
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          position: 'relative',
          backgroundColor: 'rgba(0, 0, 0, 0.2)',
          border: '1px solid rgba(255,255,255,0.5)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.75), 0 0 9px rgba(0,0,0,0.2), 0 3px 8px rgba(0,0,0,0.15)',
          color: '#fff',
          overflow: 'hidden',
          '&::before': {
            content: '""',
            position: 'absolute',
            inset: 0,
            borderRadius: 'inherit',
            pointerEvents: 'none',
            zIndex: 0,
            background: 'linear-gradient(to bottom right, rgba(255,255,255,0.6), rgba(255,255,255,0), rgba(255,255,255,0))',
            opacity: 0.7,
          },
          '&::after': {
            content: '""',
            position: 'absolute',
            inset: 0,
            borderRadius: 'inherit',
            pointerEvents: 'none',
            zIndex: 0,
            background: 'linear-gradient(to top left, rgba(255,255,255,0.3), rgba(255,255,255,0), rgba(255,255,255,0))',
            opacity: 0.5,
          },
          '& > *': {
            position: 'relative',
            zIndex: 1,
          },
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
          backgroundColor: 'rgba(0, 0, 0, 0.2)',
          borderColor: 'rgba(255,255,255,0.5)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          color: '#fff',
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: 'rgba(255,255,255,0.5)',
          },
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: 'rgba(255,255,255,0.5)',
          },
          '&.Mui-focused': {
            backgroundColor: 'rgba(255,255,255,0.15)',
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: 'rgba(255,255,255,0.5)',
              boxShadow: '0 0 0 2px rgba(255,255,255,0.3)',
            },
          },
          '& input::placeholder': {
            color: 'rgba(255,255,255,0.7)',
            opacity: 1,
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

  // If we boot with a stored session, validate it once before mounting the app views.
  // This avoids spamming 401s when the token is expired/revoked.
  const [isValidatingSession, setIsValidatingSession] = useState<boolean>(() =>
    Boolean(window.localStorage.getItem('staff_session'))
  );
  const [sessionValidationError, setSessionValidationError] = useState<string | null>(null);

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

  const clearSession = () => {
    setSession(null);
    window.localStorage.removeItem('staff_session');
    setSessionValidationError(null);
    setIsValidatingSession(false);
  };

  useEffect(() => {
    if (!session?.sessionToken) {
      setIsValidatingSession(false);
      setSessionValidationError(null);
      return;
    }
    if (!isValidatingSession) return;

    const ac = new AbortController();
    (async () => {
      try {
        const res = await fetch(getApiUrl('/api/v1/auth/me'), {
          headers: { Authorization: `Bearer ${session.sessionToken}` },
          signal: ac.signal,
        });

        if (res.ok) {
          setSessionValidationError(null);
          setIsValidatingSession(false);
          return;
        }

        // Most common case: stale localStorage token.
        if (res.status === 401) {
          clearSession();
          return;
        }

        setSessionValidationError(`Failed to validate session (${res.status})`);
        setIsValidatingSession(false);
      } catch {
        if (ac.signal.aborted) return;
        setSessionValidationError('Could not reach the API to validate your session.');
        setIsValidatingSession(false);
      }
    })();

    return () => ac.abort();
  }, [session?.sessionToken, isValidatingSession]);

  const handleLogin = (newSession: StaffSession) => {
    setSession(newSession);
    window.localStorage.setItem('staff_session', JSON.stringify(newSession));
    setSessionValidationError(null);
    setIsValidatingSession(false);
  };

  const handleLogout = async () => {
    if (session?.sessionToken) {
      try {
        const res = await fetch(getApiUrl('/api/v1/auth/logout'), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.sessionToken}`,
          },
        });
        // If the token is already invalid/expired, treat as logged out.
        if (!res.ok && res.status !== 401) {
          console.error('Logout failed:', res.status);
        }
      } catch (error) {
        console.error('Logout error:', error);
      }
    }
    clearSession();
  };

  // Gate app mounting on validating any stored session.
  if (session && isValidatingSession) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Box
          sx={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: 2,
            p: 3,
          }}
        >
          <CircularProgress />
          <Typography variant="h6">Validating session…</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 520, textAlign: 'center' }}>
            If you see this for more than a few seconds, the API may be down or your token may have
            expired.
          </Typography>
          <Button variant="outlined" color="inherit" onClick={clearSession}>
            Return to Lock Screen
          </Button>
        </Box>
      </ThemeProvider>
    );
  }

  if (session && sessionValidationError) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Box
          sx={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: 2,
            p: 3,
          }}
        >
          <Typography variant="h6">Session check failed</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 640, textAlign: 'center' }}>
            {sessionValidationError}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              variant="contained"
              onClick={() => {
                setSessionValidationError(null);
                setIsValidatingSession(true);
              }}
            >
              Retry
            </Button>
            <Button variant="outlined" color="inherit" onClick={clearSession}>
              Return to Lock Screen
            </Button>
          </Box>
        </Box>
      </ThemeProvider>
    );
  }

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
