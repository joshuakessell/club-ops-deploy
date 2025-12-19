import { useEffect, useState, useRef } from 'react';
import type { SessionUpdatedPayload, WebSocketEvent } from '@club-ops/shared';
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
    case 'DELUXE':
      return 'Deluxe Room';
    case 'VIP':
      return 'VIP Room';
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
  const signatureCanvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);

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

    // Connect to WebSocket with lane parameter
    const ws = new WebSocket(`ws://${window.location.hostname}:3001/ws?lane=${encodeURIComponent(lane)}`);

    ws.onopen = () => {
      console.log('WebSocket connected to lane:', lane);
      setWsConnected(true);
      
      // Subscribe to SESSION_UPDATED events
      ws.send(JSON.stringify({
        type: 'subscribe',
        events: ['SESSION_UPDATED'],
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
          });
          if (payload.customerName) {
            setView('selection');
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

  const handleRentalSelection = (rental: string) => {
    setSelectedRental(rental);
    // Show agreement screen after selection
    setView('agreement');
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

    // Note: Upgrade endpoints require staff authentication.
    // For customer kiosk, these actions should be initiated by staff via employee-register.
    // This is a placeholder - in production, upgrades should be handled by staff.
    alert('Upgrade actions must be processed by staff. Please contact an employee.');
    setShowUpgradeDisclaimer(false);
    setUpgradeAction(null);
  };

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
      const response = await fetch(`${API_BASE}/v1/checkins/${session.sessionId}/agreement-sign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-device-type': 'customer-kiosk',
          'x-device-id': `kiosk-${lane}`,
        },
        body: JSON.stringify({
          signaturePngBase64: signatureData.split(',')[1], // Remove data:image/png;base64, prefix
          agreed: true,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to sign agreement');
      }

      setView('complete');
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
            <p>Your agreement has been signed.</p>
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
            session.allowedRentals.map((rental) => (
              <div
                key={rental}
                className="package-option"
                onClick={() => handleRentalSelection(rental)}
              >
                <div className="package-name">{getRentalDisplayName(rental)}</div>
              </div>
            ))
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
              <p>Upgrade availability and time estimates are not guarantees.</p>
              <p>Upgrade fees are charged only if an upgrade becomes available and you choose to accept it.</p>
              <p>Upgrades do not extend your stay. Your checkout time remains the same as your original 6-hour check-in.</p>
              <p>The full upgrade fee applies even if limited time remains.</p>
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
    </div>
  );
}

export default App;
