import { useEffect, useState, useRef } from 'react';
import { RoomStatus, RoomType } from '@club-ops/shared';
import { LockScreen, type StaffSession } from './LockScreen';

interface HealthStatus {
  status: string;
  timestamp: string;
  uptime: number;
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
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [scanMode, setScanMode] = useState<'id' | 'membership' | null>(null);
  const [scanBuffer, setScanBuffer] = useState('');
  const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [manualEntry, setManualEntry] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [membershipNumber, setMembershipNumber] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [agreementSigned, setAgreementSigned] = useState(false);
  const [lane] = useState(() => {
    // Get lane from URL query param or localStorage, default to 'lane-1'
    const params = new URLSearchParams(window.location.search);
    return params.get('lane') || localStorage.getItem('lane') || 'lane-1';
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

  // Show lock screen if not authenticated
  if (!session) {
    return (
      <LockScreen
        onLogin={handleLogin}
        deviceType="tablet"
        deviceId={deviceId}
      />
    );
  }

  // Handle barcode scanner input (keyboard wedge mode)
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Barcode scanners typically send characters quickly and end with Enter
      if (e.key === 'Enter' && scanBuffer.trim()) {
        const scannedValue = scanBuffer.trim();
        handleScan(scannedValue);
        setScanBuffer('');
        if (scanTimeoutRef.current) {
          clearTimeout(scanTimeoutRef.current);
          scanTimeoutRef.current = null;
        }
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Accumulate characters (barcode scanner input)
        setScanBuffer(prev => prev + e.key);
        
        // Clear buffer after 1 second of no input (normal typing)
        if (scanTimeoutRef.current) {
          clearTimeout(scanTimeoutRef.current);
        }
        scanTimeoutRef.current = setTimeout(() => {
          setScanBuffer('');
        }, 1000);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => {
      window.removeEventListener('keydown', handleKeyPress);
      if (scanTimeoutRef.current) {
        clearTimeout(scanTimeoutRef.current);
      }
    };
  }, [scanBuffer]);

  const handleScan = async (scannedValue: string) => {
    if (!scanMode) {
      // Auto-detect: if it looks like a UUID, treat as ID; otherwise membership number
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(scannedValue);
      const mode = isUuid ? 'id' : 'membership';
      setScanMode(mode);
      await sendScan(mode, scannedValue);
    } else {
      await sendScan(scanMode, scannedValue);
    }
  };

  const sendScan = async (mode: 'id' | 'membership', value: string) => {
    if (!session?.sessionToken) {
      alert('Not authenticated');
      return;
    }

    try {
      // For ID scan, we'll extract name from the scan (simplified - in production, parse ID format)
      // For membership scan, we'll update the membership number
      if (mode === 'id') {
        // Simplified: treat scanned ID as customer name for now
        // In production, parse ID format to extract name
        await updateLaneSession(value, null);
      } else {
        // Membership scan - update existing session with membership number
        // First get current session or use a placeholder name
        await updateLaneSession(customerName || 'Customer', value);
      }

      // Reset scan mode after successful scan
      setScanMode(null);
    } catch (error) {
      console.error('Failed to send scan:', error);
      alert('Failed to process scan. Please try again.');
    }
  };

  const updateLaneSession = async (name: string, membership: string | null) => {
    if (!session?.sessionToken) {
      alert('Not authenticated');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/lanes/${lane}/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({
          customerName: name,
          membershipNumber: membership,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update session');
      }

      const data = await response.json();
      console.log('Session updated:', data);
      
      // Update local state
      if (name) setCustomerName(name);
      if (membership !== null) setMembershipNumber(membership || '');
      if (data.sessionId) setCurrentSessionId(data.sessionId);
      
      // Fetch agreement status if session ID is available
      if (data.sessionId) {
        fetchAgreementStatus(data.sessionId);
      }
      
      // Clear manual entry mode if active
      if (manualEntry) {
        setManualEntry(false);
      }
    } catch (error) {
      console.error('Failed to update session:', error);
      alert(error instanceof Error ? error.message : 'Failed to update session');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName.trim()) {
      alert('Please enter customer name');
      return;
    }
    await updateLaneSession(customerName.trim(), membershipNumber.trim() || null);
  };

  const fetchAgreementStatus = async (sessionId: string) => {
    if (!session?.sessionToken) return;

    try {
      const response = await fetch(`${API_BASE}/v1/sessions/active`, {
        headers: {
          'Authorization': `Bearer ${session.sessionToken}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        const activeSession = data.sessions?.find((s: { id: string }) => s.id === sessionId);
        if (activeSession) {
          setAgreementSigned(activeSession.agreementSigned || false);
        }
      }
    } catch (error) {
      console.error('Failed to fetch agreement status:', error);
    }
  };

  const handleClearSession = async () => {
    if (!session?.sessionToken) {
      alert('Not authenticated');
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/v1/lanes/${lane}/clear`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.sessionToken}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to clear session');
      }

      setCustomerName('');
      setMembershipNumber('');
      setCurrentSessionId(null);
      setAgreementSigned(false);
      setManualEntry(false);
      console.log('Session cleared');
    } catch (error) {
      console.error('Failed to clear session:', error);
      alert('Failed to clear session');
    }
  };

  useEffect(() => {
    // Check API health
    fetch('/api/health')
      .then((res) => res.json())
      .then((data: HealthStatus) => setHealth(data))
      .catch(console.error);

    // Connect to WebSocket
    const ws = new WebSocket(`ws://${window.location.hostname}:3001/ws`);

    ws.onopen = () => {
      console.log('WebSocket connected');
      setWsConnected(true);
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setWsConnected(false);
    };

    ws.onmessage = (event) => {
      console.log('WebSocket message:', event.data);
    };

    return () => ws.close();
  }, []);

  // Sample inventory data for display
  const inventoryDemo = {
    [RoomType.STANDARD]: { clean: 12, cleaning: 3, dirty: 5 },
    [RoomType.DELUXE]: { clean: 4, cleaning: 1, dirty: 2 },
    [RoomType.VIP]: { clean: 2, cleaning: 0, dirty: 1 },
  };

  return (
    <div className="container">
      <header className="header">
        <h1>Employee Register</h1>
        <div className="status-badges">
          <span className={`badge ${health?.status === 'ok' ? 'badge-success' : 'badge-error'}`}>
            API: {health?.status ?? '...'}
          </span>
          <span className={`badge ${wsConnected ? 'badge-success' : 'badge-error'}`}>
            WS: {wsConnected ? 'Live' : 'Offline'}
          </span>
          <span className="badge badge-info">Lane: {lane}</span>
          <span className="badge badge-info">{session.name} ({session.role})</span>
          <button
            onClick={handleLogout}
            style={{
              padding: '0.375rem 0.75rem',
              background: 'rgba(239, 68, 68, 0.2)',
              border: '1px solid var(--error)',
              borderRadius: '9999px',
              color: 'var(--error)',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Sign Out
          </button>
        </div>
      </header>

      <main className="main">
        <section className="inventory-panel">
          <h2>Room Inventory</h2>
          <div className="inventory-grid">
            {Object.entries(inventoryDemo).map(([type, counts]) => (
              <div key={type} className="inventory-card">
                <h3>{type}</h3>
                <div className="counts">
                  <div className="count count-clean">
                    <span className="count-value">{counts.clean}</span>
                    <span className="count-label">{RoomStatus.CLEAN}</span>
                  </div>
                  <div className="count count-cleaning">
                    <span className="count-value">{counts.cleaning}</span>
                    <span className="count-label">{RoomStatus.CLEANING}</span>
                  </div>
                  <div className="count count-dirty">
                    <span className="count-value">{counts.dirty}</span>
                    <span className="count-label">{RoomStatus.DIRTY}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="actions-panel">
          <h2>Lane Session</h2>
          <div className="action-buttons">
            <button 
              className={`action-btn ${scanMode === 'id' ? 'active' : ''}`}
              onClick={() => {
                setScanMode(scanMode === 'id' ? null : 'id');
                setManualEntry(false);
              }}
            >
              <span className="btn-icon">🆔</span>
              {scanMode === 'id' ? 'Scanning ID...' : 'Scan ID'}
            </button>
            <button 
              className={`action-btn ${scanMode === 'membership' ? 'active' : ''}`}
              onClick={() => {
                setScanMode(scanMode === 'membership' ? null : 'membership');
                setManualEntry(false);
              }}
            >
              <span className="btn-icon">🏷️</span>
              {scanMode === 'membership' ? 'Scanning Membership...' : 'Scan Membership'}
            </button>
            <button 
              className={`action-btn ${manualEntry ? 'active' : ''}`}
              onClick={() => {
                setManualEntry(!manualEntry);
                setScanMode(null);
              }}
            >
              <span className="btn-icon">✏️</span>
              Manual Entry
            </button>
            <button 
              className="action-btn"
              onClick={handleClearSession}
              disabled={isSubmitting}
            >
              <span className="btn-icon">🗑️</span>
              Clear Session
            </button>
          </div>
          
          {scanMode && (
            <div className="scan-status">
              <p>
                {scanMode === 'id' ? 'Ready to scan ID' : 'Ready to scan membership card'}
              </p>
              <p className="scan-hint">
                Point barcode scanner and scan, or press Enter
              </p>
            </div>
          )}

          {manualEntry && (
            <form className="manual-entry-form" onSubmit={handleManualSubmit}>
              <div className="form-group">
                <label htmlFor="customerName">Customer Name *</label>
                <input
                  id="customerName"
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Enter customer name"
                  disabled={isSubmitting}
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="membershipNumber">Membership Number (optional)</label>
                <input
                  id="membershipNumber"
                  type="text"
                  value={membershipNumber}
                  onChange={(e) => setMembershipNumber(e.target.value)}
                  placeholder="Enter membership number"
                  disabled={isSubmitting}
                />
              </div>
              <div className="form-actions">
                <button
                  type="submit"
                  className="submit-btn"
                  disabled={isSubmitting || !customerName.trim()}
                >
                  {isSubmitting ? 'Submitting...' : 'Update Session'}
                </button>
                <button
                  type="button"
                  className="cancel-btn"
                  onClick={() => {
                    setManualEntry(false);
                    setCustomerName('');
                    setMembershipNumber('');
                  }}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {(customerName || membershipNumber) && !manualEntry && (
            <div className="current-session">
              <p><strong>Current Session:</strong></p>
              <p>Name: {customerName || 'Not set'}</p>
              {membershipNumber && <p>Membership: {membershipNumber}</p>}
              {currentSessionId && (
                <p className={agreementSigned ? 'agreement-status signed' : 'agreement-status unsigned'}>
                  {agreementSigned ? 'Agreement signed ✓' : 'Agreement pending'}
                </p>
              )}
            </div>
          )}
        </section>
      </main>

      <footer className="footer">
        <p>Employee-facing tablet • Runs alongside Square POS</p>
      </footer>
    </div>
  );
}

export default App;

