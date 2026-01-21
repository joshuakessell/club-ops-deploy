import { useState, useEffect } from 'react';
import {
  Box,
  Container,
  Typography,
  Button,
  TextField,
  Card,
  CardContent,
  Avatar,
  CircularProgress,
  Alert,
  Fade,
  Paper,
  Stack,
} from '@mui/material';
import {
  Person,
  Lock,
  Login as LoginIcon,
  BusinessCenter,
  Schedule,
  Assessment,
} from '@mui/icons-material';
import { getApiUrl } from '@/lib/apiBase';

const API_BASE = getApiUrl('/api');

export interface StaffSession {
  staffId: string;
  name: string;
  role: 'STAFF' | 'ADMIN';
  sessionToken: string;
}

interface LockScreenProps {
  onLogin: (session: StaffSession) => void;
  deviceType: 'tablet' | 'kiosk' | 'desktop';
  deviceId: string;
}

// Employee definitions
interface Employee {
  id: string;
  name: string;
  role: 'STAFF' | 'ADMIN';
  accessLevel: 'limited' | 'full';
  description: string;
  icon: React.ReactNode;
}

export function LockScreen({ onLogin, deviceType, deviceId }: LockScreenProps) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingEmployees, setIsLoadingEmployees] = useState(true);

  // Fetch employees from API
  useEffect(() => {
    const loadEmployees = async () => {
      try {
        const response = await fetch(`${API_BASE}/v1/auth/staff`);
        if (response.ok) {
          const data = await response.json();
          const staffList: Employee[] = (data.staff || []).map(
            (staff: { id: string; name: string; role: 'STAFF' | 'ADMIN' }) => ({
              id: staff.id,
              name: staff.name,
              role: staff.role,
              accessLevel: staff.role === 'ADMIN' ? 'full' : 'limited',
              description:
                staff.role === 'ADMIN'
                  ? 'Admin — Monitor, Waitlist, Reports, Customer Tools'
                  : 'Staff — Schedule, Messages (stub)',
              icon: staff.role === 'ADMIN' ? <Assessment /> : <Schedule />,
            })
          );
          setEmployees(staffList);
        } else {
          setError('Failed to load staff list');
        }
      } catch (error) {
        console.error('Failed to load employees:', error);
        setError('Failed to load staff list');
      } finally {
        setIsLoadingEmployees(false);
      }
    };

    loadEmployees();
  }, []);

  const handleEmployeeSelect = (employee: Employee) => {
    setSelectedEmployee(employee);
    setPin('');
    setError(null);
  };

  const handleBack = () => {
    setSelectedEmployee(null);
    setPin('');
    setError(null);
  };

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedEmployee || !pin.trim()) {
      setError('Please enter your PIN');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/v1/auth/login-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffLookup: selectedEmployee.name,
          deviceId,
          pin: pin.trim(),
          deviceType: deviceType, // Pass device type for proper session creation
        }),
      });

      if (!response.ok) {
        let errorMessage = 'Login failed';
        try {
          const errorData = await response.json();
          errorMessage = errorData.message || errorData.error || 'Login failed';
          console.error('Login API error:', errorData);
        } catch (parseError) {
          console.error('Failed to parse error response:', parseError);
          errorMessage = `Login failed (${response.status} ${response.statusText})`;
        }
        throw new Error(errorMessage);
      }

      const session: StaffSession = await response.json();

      // Use the session data from the server (authenticated and verified)
      onLogin(session);
      setPin('');
      setSelectedEmployee(null);
    } catch (error) {
      console.error('Login error:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Invalid PIN. Please try again.';
      setError(errorMessage);
      setPin('');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Box
        sx={{
          minHeight: '100vh',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 3,
        }}
      >
        <Container maxWidth="sm">
          <Fade in timeout={500}>
            <Paper
              elevation={24}
              sx={{
                borderRadius: 4,
                overflow: 'hidden',
                background: 'white',
              }}
            >
              {!selectedEmployee ? (
                <Box sx={{ p: 4 }}>
                  {/* Header */}
                  <Box sx={{ textAlign: 'center', mb: 4 }}>
                    <Box
                      sx={{
                        width: 64,
                        height: 64,
                        borderRadius: '50%',
                        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto 16px',
                        boxShadow: '0 4px 12px rgba(102, 126, 234, 0.4)',
                      }}
                    >
                      <BusinessCenter sx={{ fontSize: 32, color: 'white' }} />
                    </Box>
                    <Typography variant="h4" sx={{ mb: 1, color: '#1a1a1a', fontWeight: 700 }}>
                      Club Operations
                    </Typography>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      Select your account to continue
                    </Typography>
                  </Box>

                  {/* Employee Selection */}
                  {isLoadingEmployees ? (
                    <Box sx={{ textAlign: 'center', py: 4 }}>
                      <CircularProgress />
                      <Typography variant="body2" sx={{ mt: 2, color: 'text.secondary' }}>
                        Loading staff...
                      </Typography>
                    </Box>
                  ) : employees.length === 0 ? (
                    <Alert severity="error">
                      No active staff members found. Please contact an administrator.
                    </Alert>
                  ) : (
                    <Stack spacing={2}>
                      {employees.map((employee) => (
                        <Card
                          key={employee.id}
                          sx={{
                            cursor: 'pointer',
                            border: '2px solid transparent',
                            '&:hover': {
                              borderColor: 'primary.main',
                            },
                          }}
                          onClick={() => handleEmployeeSelect(employee)}
                        >
                          <CardContent>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                              <Avatar
                                sx={{
                                  bgcolor:
                                    employee.role === 'ADMIN' ? 'primary.main' : 'secondary.main',
                                  width: 48,
                                  height: 48,
                                }}
                              >
                                {employee.icon}
                              </Avatar>
                              <Box sx={{ flex: 1 }}>
                                <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }}>
                                  {employee.name}
                                </Typography>
                                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                                  {employee.description}
                                </Typography>
                              </Box>
                              <LoginIcon sx={{ color: 'text.secondary' }} />
                            </Box>
                          </CardContent>
                        </Card>
                      ))}
                    </Stack>
                  )}
                </Box>
              ) : (
                <Box sx={{ p: 4 }}>
                  {/* Back Button */}
                  <Button
                    startIcon={<Person />}
                    onClick={handleBack}
                    sx={{ mb: 3, color: 'text.secondary' }}
                  >
                    Back to Employee Selection
                  </Button>

                  {/* Selected Employee Info */}
                  <Box sx={{ textAlign: 'center', mb: 4 }}>
                    <Avatar
                      sx={{
                        bgcolor:
                          selectedEmployee.role === 'ADMIN' ? 'primary.main' : 'secondary.main',
                        width: 80,
                        height: 80,
                        margin: '0 auto 16px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                      }}
                    >
                      {selectedEmployee.icon}
                    </Avatar>
                    <Typography variant="h5" sx={{ mb: 1, fontWeight: 600 }}>
                      {selectedEmployee.name}
                    </Typography>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      {selectedEmployee.description}
                    </Typography>
                  </Box>

                  {/* PIN Entry Form */}
                  <form onSubmit={handlePinSubmit}>
                    <Stack spacing={3}>
                      {error && (
                        <Alert severity="error" onClose={() => setError(null)}>
                          {error}
                        </Alert>
                      )}

                      <TextField
                        fullWidth
                        type="password"
                        label="Enter PIN"
                        value={pin}
                        onChange={(e) => {
                          // Only allow numeric input
                          const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                          setPin(value);
                        }}
                        disabled={isLoading}
                        autoFocus
                        inputProps={{
                          maxLength: 6,
                          inputMode: 'numeric',
                          pattern: '[0-9]*',
                        }}
                        InputProps={{
                          startAdornment: <Lock sx={{ mr: 1, color: 'text.secondary' }} />,
                        }}
                        sx={{
                          '& .MuiOutlinedInput-root': {
                            borderRadius: 2,
                          },
                          '& input': {
                            textAlign: 'center',
                            fontSize: '1.5rem',
                            letterSpacing: '0.5rem',
                            fontFamily: 'monospace',
                          },
                        }}
                      />

                      <Button
                        type="submit"
                        fullWidth
                        variant="contained"
                        size="large"
                        disabled={isLoading || pin.trim().length !== 6}
                        startIcon={isLoading ? <CircularProgress size={20} /> : <LoginIcon />}
                        sx={{
                          py: 1.5,
                          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                          '&:hover': {
                            background: 'linear-gradient(135deg, #5568d3 0%, #6a4190 100%)',
                          },
                        }}
                      >
                        {isLoading ? 'Signing In...' : 'Sign In'}
                      </Button>
                    </Stack>
                  </form>
                </Box>
              )}
            </Paper>
          </Fade>
        </Container>
      </Box>
  );
}
