import { useEffect, useState, useRef } from 'react';
import type { 
  SessionUpdatedPayload, 
  WebSocketEvent,
  CustomerConfirmationRequiredPayload,
  AssignmentCreatedPayload,
  InventoryUpdatedPayload,
} from '@club-ops/shared';
import { CheckinMode } from '@club-ops/shared';
import logoImage from './assets/the-clubs-logo.png';

interface HealthStatus {
  status: string;
  timestamp: string;
  uptime: number;
}

interface SessionState {
  sessionId: string | null;
  customerName: string | null;
  membershipNumber: string | null;
  allowedRentals: string[];
  visitId?: string;
  mode?: CheckinMode;
  blockEndsAt?: string; // ISO timestamp of when current block ends
}

interface Agreement {
  id: string;
  version: string;
  title: string;
  bodyText: string;
}

type AppView = 'idle' | 'selection' | 'agreement' | 'complete';

// Map rental types to display names
function getRentalDisplayName(rental: string): string {
  switch (rental) {
    case 'LOCKER':
      return 'Locker';
    case 'STANDARD':
      return 'Regular Room';
    case 'DOUBLE':
      return 'Double Room';
    case 'SPECIAL':
      return 'Special Room';
    case 'GYM_LOCKER':
      return 'Gym Locker';
    default:
      return rental;
  }
}

function App() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [session, setSession] = useState<SessionState>({
    sessionId: null,
    customerName: null,
    membershipNumber: null,
    allowedRentals: [],
  });
  const [view, setView] = useState<AppView>('idle');
  const [selectedRental, setSelectedRental] = useState<string | null>(null);
  const [agreement, setAgreement] = useState<Agreement | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [showUpgradeDisclaimer, setShowUpgradeDisclaimer] = useState(false);
  const [upgradeAction, setUpgradeAction] = useState<'waitlist' | 'accept' | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checkinMode, setCheckinMode] = useState<CheckinMode | null>(null);
  const [showRenewalDisclaimer, setShowRenewalDisclaimer] = useState(false);
  const [showCustomerConfirmation, setShowCustomerConfirmation] = useState(false);
  const [customerConfirmationData, setCustomerConfirmationData] = useState<CustomerConfirmationRequiredPayload | null>(null);
  const [inventory, setInventory] = useState<{ rooms: Record<string, number>; lockers: number } | null>(null);
  const [showWaitlistModal, setShowWaitlistModal] = useState(false);
  const [waitlistDesiredType, setWaitlistDesiredType] = useState<string | null>(null);
  const [waitlistBackupType, setWaitlistBackupType] = useState<string | null>(null);
  const signatureCanvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const idleTimeoutRef = useRef<number | null>(null);

  // Get lane from URL query param or localStorage, default to 'lane-1'
  const lane = (() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('lane') || localStorage.getItem('lane') || 'lane-1';
  })();

  const API_BASE = '/api';

  useEffect(() => {
    // Check API health
    fetch(`${API_BASE}/health`)
      .then((res) => res.json())
      .then((data: HealthStatus) => setHealth(data))
      .catch(console.error);

    // Fetch initial inventory
    fetch(`${API_BASE}/v1/inventory/available`)
      .then((res) => res.json())
      .then((data: { rooms: Record<string, number>; lockers: number }) => {
        setInventory(data);
      })
      .catch(console.error);

    // Connect to WebSocket with lane parameter
    const ws = new WebSocket(`ws://${window.location.hostname}:3001/ws?lane=${encodeURIComponent(lane)}`);

    ws.onopen = () => {
      console.log('WebSocket connected to lane:', lane);
      setWsConnected(true);
      
      // Subscribe to relevant events
      ws.send(JSON.stringify({
        type: 'subscribe',
        events: ['SESSION_UPDATED', 'CUSTOMER_CONFIRMATION_REQUIRED', 'ASSIGNMENT_CREATED', 'INVENTORY_UPDATED'],
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

        if (message.type === 'SESSION_UPDATED') {
          const payload = message.payload as SessionUpdatedPayload;
          setSession({
            sessionId: payload.sessionId || null,
            customerName: payload.customerName,
            membershipNumber: payload.membershipNumber || null,
            allowedRentals: payload.allowedRentals,
            visitId: payload.visitId,
            mode: payload.mode,
            blockEndsAt: payload.blockEndsAt,
          });
          // Set check-in mode from payload
          if (payload.mode) {
            setCheckinMode(payload.mode);
          }
          if (payload.customerName) {
            setView('selection');
          }
          // Handle completion status
          if ((payload as any).status === 'COMPLETED') {
            setView('complete');
            // Clear any existing timeout to prevent race conditions
            if (idleTimeoutRef.current !== null) {
              clearTimeout(idleTimeoutRef.current);
            }
            // Return to idle after delay
            idleTimeoutRef.current = window.setTimeout(() => {
              setView('idle');
              setSession({
                sessionId: null,
                customerName: null,
                membershipNumber: null,
                allowedRentals: [],
                blockEndsAt: undefined,
              });
              setSelectedRental(null);
              setAgreed(false);
              setSignatureData(null);
              setShowUpgradeDisclaimer(false);
              setUpgradeAction(null);
              setShowRenewalDisclaimer(false);
              setCheckinMode(null);
              setShowWaitlistModal(false);
              setWaitlistDesiredType(null);
              setWaitlistBackupType(null);
              idleTimeoutRef.current = null;
            }, 5000);
          }
        } else if (message.type === 'CUSTOMER_CONFIRMATION_REQUIRED') {
          const payload = message.payload as CustomerConfirmationRequiredPayload;
          setCustomerConfirmationData(payload);
          setShowCustomerConfirmation(true);
        } else if (message.type === 'ASSIGNMENT_CREATED') {
          const payload = message.payload as AssignmentCreatedPayload;
          // Assignment successful - could show confirmation message
          console.log('Assignment created:', payload);
        } else if (message.type === 'INVENTORY_UPDATED') {
          const payload = message.payload as InventoryUpdatedPayload;
          // Update inventory counts for availability warnings
          if (payload.inventory) {
            const rooms: Record<string, number> = {};
            if (payload.inventory.byType) {
              Object.entries(payload.inventory.byType).forEach(([type, summary]) => {
                rooms[type] = summary.clean;
              });
            }
            setInventory({
              rooms,
              lockers: payload.inventory.lockers?.clean || 0,
            });
          }
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    return () => ws.close();
  }, [lane]);

  // Load active agreement when agreement view is shown
  useEffect(() => {
    if (view === 'agreement' && !agreement) {
      fetch(`${API_BASE}/v1/agreements/active`)
        .then((res) => res.json())
        .then((data: Agreement) => {
          setAgreement({
            id: data.id,
            version: data.version,
            title: data.title,
            bodyText: data.bodyText,
          });
        })
        .catch((error) => {
          console.error('Failed to load agreement:', error);
          alert('Failed to load agreement. Please try again.');
        });
    }
  }, [view, agreement]);

  const handleRentalSelection = async (rental: string) => {
    if (!session.sessionId) {
      alert('No active session. Please wait for staff to start a session.');
      return;
    }

    const availableCount = inventory?.rooms[rental] || (rental === 'LOCKER' || rental === 'GYM_LOCKER' ? inventory?.lockers : 0) || 0;
    
    // If unavailable, show waitlist modal
    if (availableCount === 0) {
      setWaitlistDesiredType(rental);
      setShowWaitlistModal(true);
      return;
    }

    setSelectedRental(rental);
    setIsSubmitting(true);

    try {
      // Call the select-rental endpoint (requires staff auth, so this is a placeholder)
      // In production, the employee register would call this on behalf of the customer
      // For now, we'll proceed to agreement screen
      
      // If renewal mode, show renewal disclaimer before agreement
      if (checkinMode === CheckinMode.RENEWAL) {
        setIsSubmitting(false);
        setShowRenewalDisclaimer(true);
      } else {
        // Show agreement screen after selection
        setIsSubmitting(false);
        setView('agreement');
      }
    } catch (error) {
      console.error('Failed to process rental selection:', error);
      alert('Failed to process selection. Please try again.');
      setIsSubmitting(false);
    }
  };

  const handleJoinWaitlist = () => {
    setUpgradeAction('waitlist');
    setShowUpgradeDisclaimer(true);
  };

  const handleAcceptUpgrade = () => {
    setUpgradeAction('accept');
    setShowUpgradeDisclaimer(true);
  };

  const handleDisclaimerAcknowledge = async () => {
    if (!session.sessionId || !upgradeAction) return;

    // Upgrade disclaimer is informational only - no signature required
    // Just acknowledge and close the modal
    // The actual upgrade processing happens on the employee register side
    setShowUpgradeDisclaimer(false);
    setUpgradeAction(null);
    
    // After acknowledging upgrade disclaimer, do NOT proceed to agreement
    // Upgrades don't require agreement signing - that's only for initial check-ins and renewals
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (idleTimeoutRef.current !== null) {
        clearTimeout(idleTimeoutRef.current);
        idleTimeoutRef.current = null;
      }
    };
  }, []);

  // Initialize signature canvas
  useEffect(() => {
    const canvas = signatureCanvasRef.current;
    if (canvas && view === 'agreement') {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
      }
    }
  }, [view]);

  const handleSignatureStart = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    isDrawingRef.current = true;
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0]!.clientX - rect.left : e.clientX - rect.left;
    const y = 'touches' in e ? e.touches[0]!.clientY - rect.top : e.clientY - rect.top;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.beginPath();
      ctx.moveTo(x, y);
    }
  };

  const handleSignatureMove = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0]!.clientX - rect.left : e.clientX - rect.left;
    const y = 'touches' in e ? e.touches[0]!.clientY - rect.top : e.clientY - rect.top;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  };

  const handleSignatureEnd = () => {
    isDrawingRef.current = false;
    const canvas = signatureCanvasRef.current;
    if (canvas) {
      setSignatureData(canvas.toDataURL('image/png'));
    }
  };

  const handleClearSignature = () => {
    const canvas = signatureCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      setSignatureData(null);
    }
  };

  const handleSubmitAgreement = async () => {
    if (!agreed || !signatureData || !session.sessionId) {
      alert('Please acknowledge the agreement and provide a signature.');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/sign-agreement`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          signaturePayload: signatureData, // Full data URL or base64
          sessionId: session.sessionId || undefined,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to sign agreement');
      }

      setView('complete');
      
      // Clear any existing timeout to prevent race conditions
      if (idleTimeoutRef.current !== null) {
        clearTimeout(idleTimeoutRef.current);
      }
      // Return to idle after a delay (will be handled by WebSocket COMPLETED status)
      // Keep this as fallback only if WebSocket doesn't send COMPLETED status
      idleTimeoutRef.current = window.setTimeout(() => {
        setView('idle');
        setSession({
          sessionId: null,
          customerName: null,
          membershipNumber: null,
          allowedRentals: [],
          blockEndsAt: undefined,
        });
        setSelectedRental(null);
        setAgreed(false);
        setSignatureData(null);
        setShowUpgradeDisclaimer(false);
        setUpgradeAction(null);
        setShowRenewalDisclaimer(false);
        setCheckinMode(null);
        setShowWaitlistModal(false);
        setWaitlistDesiredType(null);
        setWaitlistBackupType(null);
        idleTimeoutRef.current = null;
      }, 5000);
    } catch (error) {
      console.error('Failed to sign agreement:', error);
      alert(error instanceof Error ? error.message : 'Failed to sign agreement. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Idle state: logo only, centered
  if (view === 'idle') {
    return (
      <div className="idle-container">
        <img src={logoImage} alt="Club Dallas" className="logo-idle" />
      </div>
    );
  }

  // Agreement signing view
  if (view === 'agreement') {
    return (
      <div className="active-container">
        <img src={logoImage} alt="Club Dallas" className="logo-header" />
        
        <main className="main-content">
          <div className="agreement-screen">
            <h1 className="agreement-title">
              {agreement?.title || 'Club Agreement'}
            </h1>
            
            <div className="agreement-scroll-area">
              {/* Placeholder - no text displayed for now */}
              <p className="agreement-placeholder">
                Agreement content will be displayed here.
              </p>
            </div>

            <div className="agreement-actions">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                />
                <span>I agree</span>
              </label>

              <div className="signature-section">
                <p className="signature-label">Signature required to continue</p>
                <canvas
                  ref={signatureCanvasRef}
                  className="signature-canvas"
                  width={600}
                  height={200}
                  onMouseDown={handleSignatureStart}
                  onMouseMove={handleSignatureMove}
                  onMouseUp={handleSignatureEnd}
                  onMouseLeave={handleSignatureEnd}
                  onTouchStart={handleSignatureStart}
                  onTouchMove={handleSignatureMove}
                  onTouchEnd={handleSignatureEnd}
                />
                <button
                  type="button"
                  className="clear-signature-btn"
                  onClick={handleClearSignature}
                >
                  Clear
                </button>
              </div>

              <button
                className="submit-agreement-btn"
                onClick={handleSubmitAgreement}
                disabled={!agreed || !signatureData || isSubmitting}
              >
                {isSubmitting ? 'Submitting...' : 'Submit'}
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Complete view
  if (view === 'complete') {
    return (
      <div className="active-container">
        <img src={logoImage} alt="Club Dallas" className="logo-header" />
        <main className="main-content">
          <div className="complete-screen">
            <h1>Thank you!</h1>
            <p>Please wait for staff to complete payment and assignment.</p>
            <p style={{ fontSize: '0.875rem', color: '#94a3b8', marginTop: '1rem' }}>
              Your check-in is being processed...
            </p>
          </div>
        </main>
      </div>
    );
  }

  // Selection view (default active session state)
  return (
    <div className="active-container">
      <img src={logoImage} alt="Club Dallas" className="logo-header" />
      
      <main className="main-content">
        <div className="customer-info">
          <h1 className="customer-name">{session.customerName}</h1>
          {session.membershipNumber && (
            <p className="membership-number">Membership: {session.membershipNumber}</p>
          )}
        </div>

        <div className="package-options">
          {session.allowedRentals.length > 0 ? (
            session.allowedRentals.map((rental) => {
              const availableCount = inventory?.rooms[rental] || (rental === 'LOCKER' || rental === 'GYM_LOCKER' ? inventory?.lockers : 0) || 0;
              const showWarning = availableCount > 0 && availableCount < 3;
              const isUnavailable = availableCount === 0;
              
              return (
                <div key={rental}>
                  <div
                    className="package-option"
                    onClick={() => handleRentalSelection(rental)}
                    style={{ opacity: 1, cursor: 'pointer' }}
                  >
                    <div className="package-name">{getRentalDisplayName(rental)}</div>
                    {showWarning && (
                      <div style={{ fontSize: '0.875rem', color: '#f59e0b', marginTop: '0.5rem', fontWeight: 600 }}>
                        ⚠️ Only {availableCount} available
                      </div>
                    )}
                    {isUnavailable && (
                      <div style={{ fontSize: '0.875rem', color: '#ef4444', marginTop: '0.5rem', fontWeight: 600 }}>
                        Currently unavailable - Tap to join waitlist
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="package-option">
              <div className="package-name">No options available</div>
            </div>
          )}
        </div>

        {/* Waitlist button (shown when higher tier available) */}
        {session.allowedRentals.includes('STANDARD') && (
          <button
            className="waitlist-btn"
            onClick={handleJoinWaitlist}
          >
            Join Waitlist for Upgrade
          </button>
        )}
      </main>

      {/* Upgrade Disclaimer Modal */}
      {showUpgradeDisclaimer && (
        <div className="modal-overlay" onClick={() => setShowUpgradeDisclaimer(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Upgrade Disclaimer</h2>
            <div className="disclaimer-text">
              <p><strong>Upgrade Disclaimer</strong></p>
              <ul style={{ listStyle: 'disc', paddingLeft: '1.5rem', textAlign: 'left', marginTop: '1rem' }}>
                <li style={{ marginBottom: '0.5rem' }}>
                  Upgrade fees apply only to remaining time in your current stay.
                </li>
                <li style={{ marginBottom: '0.5rem' }}>
                  Upgrades do not extend your stay. Your checkout time remains the same.
                </li>
                <li style={{ marginBottom: '0.5rem', fontWeight: 600, color: '#ef4444' }}>
                  No refunds under any circumstances.
                </li>
                <li style={{ marginBottom: '0.5rem' }}>
                  Upgrade fees are charged only when an upgrade becomes available and you choose to accept it.
                </li>
              </ul>
            </div>
            <button
              className="modal-ok-btn"
              onClick={handleDisclaimerAcknowledge}
              disabled={isSubmitting}
            >
              OK
            </button>
          </div>
        </div>
      )}

      {/* Customer Confirmation Modal */}
      {showCustomerConfirmation && customerConfirmationData && (
        <div className="modal-overlay" onClick={() => {}}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Staff Selected Different Option</h2>
            <div className="disclaimer-text">
              <p>You requested: <strong>{getRentalDisplayName(customerConfirmationData.requestedType)}</strong></p>
              <p>Staff selected: <strong>{getRentalDisplayName(customerConfirmationData.selectedType)} {customerConfirmationData.selectedNumber}</strong></p>
              <p>Do you accept this selection?</p>
            </div>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
              <button
                className="modal-ok-btn"
                onClick={async () => {
                  try {
                    const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/customer-confirm`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        sessionId: customerConfirmationData.sessionId,
                        confirmed: true,
                      }),
                    });
                    if (response.ok) {
                      setShowCustomerConfirmation(false);
                      setCustomerConfirmationData(null);
                    }
                  } catch (error) {
                    console.error('Failed to confirm:', error);
                    alert('Failed to confirm selection. Please try again.');
                  }
                }}
                disabled={isSubmitting}
              >
                Accept
              </button>
              <button
                className="modal-ok-btn"
                style={{ backgroundColor: '#ef4444' }}
                onClick={async () => {
                  try {
                    const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/customer-confirm`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        sessionId: customerConfirmationData.sessionId,
                        confirmed: false,
                      }),
                    });
                    if (response.ok) {
                      setShowCustomerConfirmation(false);
                      setCustomerConfirmationData(null);
                    }
                  } catch (error) {
                    console.error('Failed to decline:', error);
                    alert('Failed to decline selection. Please try again.');
                  }
                }}
                disabled={isSubmitting}
              >
                Decline
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Waitlist Modal */}
      {showWaitlistModal && waitlistDesiredType && (
        <div className="modal-overlay" onClick={() => setShowWaitlistModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>None Available - Join Waiting List?</h2>
            <div className="disclaimer-text">
              <p>
                <strong>{getRentalDisplayName(waitlistDesiredType)}</strong> is currently unavailable.
              </p>
              <p>To join the waitlist, please select a backup rental that is available now.</p>
              <p style={{ fontSize: '0.875rem', color: '#94a3b8', marginTop: '1rem' }}>
                You will be charged for the backup rental. If an upgrade becomes available, you may accept it (upgrade fees apply).
              </p>
            </div>
            <div style={{ marginTop: '1.5rem' }}>
              <p style={{ fontWeight: 600, marginBottom: '0.75rem' }}>Select backup rental:</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {session.allowedRentals
                  .filter(rental => rental !== waitlistDesiredType)
                  .map(rental => {
                    const availableCount = inventory?.rooms[rental] || (rental === 'LOCKER' || rental === 'GYM_LOCKER' ? inventory?.lockers : 0) || 0;
                    const isAvailable = availableCount > 0;
                    
                    return (
                      <button
                        key={rental}
                        className="modal-ok-btn"
                        onClick={() => handleWaitlistBackupSelection(rental)}
                        disabled={!isAvailable || isSubmitting}
                        style={{
                          opacity: isAvailable ? 1 : 0.5,
                          cursor: isAvailable && !isSubmitting ? 'pointer' : 'not-allowed',
                        }}
                      >
                        {getRentalDisplayName(rental)}
                        {!isAvailable && ' (Unavailable)'}
                      </button>
                    );
                  })}
              </div>
            </div>
            <button
              className="modal-ok-btn"
              onClick={() => setShowWaitlistModal(false)}
              disabled={isSubmitting}
              style={{ marginTop: '1rem', backgroundColor: '#64748b' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Renewal Disclaimer Modal */}
      {showRenewalDisclaimer && (
        <div className="modal-overlay" onClick={() => setShowRenewalDisclaimer(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Renewal Notice</h2>
            <div className="disclaimer-text">
              <ul style={{ listStyle: 'disc', paddingLeft: '1.5rem', textAlign: 'left' }}>
                <li style={{ marginBottom: '0.5rem' }}>
                  This renewal extends your stay for 6 hours from your current checkout time.
                  {session.blockEndsAt && (
                    <span> (Current checkout: {new Date(session.blockEndsAt).toLocaleString()})</span>
                  )}
                </li>
                <li style={{ marginBottom: '0.5rem', color: '#f59e0b', fontWeight: 600 }}>
                  ⚠️ You are approaching the 14-hour maximum stay for a single visit.
                </li>
                <li style={{ marginBottom: '0.5rem' }}>
                  At the end of this 6-hour renewal, you may extend one final time for 2 additional hours for a flat $20 fee (same for lockers or any room type).
                </li>
                <li style={{ marginBottom: '0.5rem' }}>
                  The $20 fee is not charged now; it applies only if you choose the final 2-hour extension later.
                </li>
              </ul>
            </div>
            <button
              className="modal-ok-btn"
              onClick={() => {
                setShowRenewalDisclaimer(false);
                // Proceed to agreement screen
                setView('agreement');
              }}
              disabled={isSubmitting}
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
