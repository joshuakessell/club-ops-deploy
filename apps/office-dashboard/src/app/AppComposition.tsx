import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { LockScreen, type StaffSession } from '../LockScreen';
import { ShiftsView } from '../ShiftsView';
import { OfficeShell } from '../OfficeShell';
import { DemoOverview } from '../DemoOverview';
import { LaneMonitorView } from '../LaneMonitorView';
import { WaitlistManagementView } from '../WaitlistManagementView';
import { CustomerAdminToolsView } from '../CustomerAdminToolsView';
import { ReportsDemoView } from '../ReportsDemoView';
import { MessagesView } from '../MessagesView';
import { TelemetryView } from '../TelemetryView';
import { Box, Button, CircularProgress, Typography } from '@mui/material';
import { getApiUrl } from '@club-ops/shared';


export function AppComposition() {
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
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ maxWidth: 520, textAlign: 'center' }}
        >
          If you see this for more than a few seconds, the API may be down or your token may have
          expired.
        </Typography>
        <Button variant="outlined" color="inherit" onClick={clearSession}>
          Return to Lock Screen
        </Button>
      </Box>
    );
  }

  if (session && sessionValidationError) {
    return (
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
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ maxWidth: 640, textAlign: 'center' }}
        >
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
    );
  }

  // Show lock screen if not authenticated
  if (!session) {
    return <LockScreen onLogin={handleLogin} deviceType="desktop" deviceId={deviceId} />;
  }

  const isAdmin = session.role === 'ADMIN';

  return (
    <Routes>
      <Route path="/" element={<Navigate to={isAdmin ? '/overview' : '/schedule'} replace />} />
      <Route element={<OfficeShell session={session} onLogout={handleLogout} />}>
        <Route
          path="/overview"
          element={isAdmin ? <DemoOverview session={session} /> : <Navigate to="/schedule" replace />}
        />
        <Route
          path="/monitor"
          element={isAdmin ? <LaneMonitorView session={session} /> : <Navigate to="/schedule" replace />}
        />
        <Route
          path="/waitlist"
          element={
            isAdmin ? <WaitlistManagementView session={session} /> : <Navigate to="/schedule" replace />
          }
        />
        <Route
          path="/reports"
          element={isAdmin ? <ReportsDemoView session={session} /> : <Navigate to="/schedule" replace />}
        />
        <Route
          path="/customers"
          element={
            isAdmin ? <CustomerAdminToolsView session={session} /> : <Navigate to="/schedule" replace />
          }
        />
        <Route
          path="/telemetry"
          element={isAdmin ? <TelemetryView session={session} /> : <Navigate to="/schedule" replace />}
        />

        <Route path="/schedule" element={<ShiftsView session={session} limitedAccess={!isAdmin} />} />
        <Route
          path="/messages"
          element={isAdmin ? <Navigate to="/overview" replace /> : <MessagesView />}
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
