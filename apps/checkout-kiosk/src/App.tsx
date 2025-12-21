import { useEffect, useState, useRef } from 'react';
import type { WebSocketEvent, ResolvedCheckoutKey, CheckoutChecklist, CheckoutCompletedPayload } from '@club-ops/shared';
import { Html5Qrcode } from 'html5-qrcode';
import logoImage from './assets/the-clubs-logo.png';

const API_BASE = '/api';

type AppView = 'idle' | 'scanning' | 'checklist' | 'waiting' | 'complete';

interface ResolvedKeyData extends ResolvedCheckoutKey {
  // Already includes all needed fields
}

function App() {
  const [view, setView] = useState<AppView>('idle');
  const [resolvedKey, setResolvedKey] = useState<ResolvedKeyData | null>(null);
  const [checklist, setChecklist] = useState<CheckoutChecklist>({});
  const [requestId, setRequestId] = useState<string | null>(null);
  const [lateFeeAmount, setLateFeeAmount] = useState<number>(0);
  const [wsConnected, setWsConnected] = useState(false);
  const qrCodeScannerRef = useRef<Html5Qrcode | null>(null);
  const scannerContainerRef = useRef<HTMLDivElement>(null);
  const kioskDeviceId = useState(() => {
    let id = localStorage.getItem('checkout_kiosk_device_id');
    if (!id) {
      id = `checkout-kiosk-${crypto.randomUUID()}`;
      localStorage.setItem('checkout_kiosk_device_id', id);
    }
    return id;
  })[0];

  // WebSocket connection for checkout completion events
  useEffect(() => {
    const ws = new WebSocket(`ws://${window.location.hostname}:3001/ws`);

    ws.onopen = () => {
      console.log('WebSocket connected');
      setWsConnected(true);
      
      // Subscribe to checkout events
      ws.send(JSON.stringify({
        type: 'subscribe',
        events: ['CHECKOUT_COMPLETED'],
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

        if (message.type === 'CHECKOUT_COMPLETED') {
          const payload = message.payload as CheckoutCompletedPayload;
          if (payload.kioskDeviceId === kioskDeviceId && payload.requestId === requestId) {
            // Checkout completed
            setView('complete');
            
            // Reset after 10 seconds
            setTimeout(() => {
              setView('idle');
              setResolvedKey(null);
              setChecklist({});
              setRequestId(null);
              setLateFeeAmount(0);
            }, 10000);
          }
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    return () => ws.close();
  }, [kioskDeviceId, requestId]);

  // Start QR scanning
  const handleStartCheckout = async () => {
    setView('scanning');
    
    // Initialize QR scanner
    try {
      const qrCode = new Html5Qrcode('qr-reader');
      qrCodeScannerRef.current = qrCode;

      await qrCode.start(
        { facingMode: 'user' }, // Front-facing camera
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
        },
        (decodedText) => {
          // QR code decoded
          handleQRScanned(decodedText);
        },
        (errorMessage) => {
          // Ignore errors (scanner will keep trying)
        }
      );
    } catch (error) {
      console.error('Failed to start QR scanner:', error);
      alert('Failed to start camera. Please check permissions.');
      setView('idle');
    }
  };

  // Handle QR code scan
  const handleQRScanned = async (token: string) => {
    // Stop scanner
    if (qrCodeScannerRef.current) {
      try {
        await qrCodeScannerRef.current.stop();
        qrCodeScannerRef.current.clear();
      } catch (error) {
        console.error('Error stopping scanner:', error);
      }
      qrCodeScannerRef.current = null;
    }

    try {
      // Resolve the key
      const response = await fetch(`${API_BASE}/v1/checkout/resolve-key`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token,
          kioskDeviceId,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to resolve key');
      }

      const data: ResolvedKeyData = await response.json();
      setResolvedKey(data);
      setLateFeeAmount(data.lateFeeAmount);

      // Initialize checklist based on rental type
      const newChecklist: CheckoutChecklist = {};
      if (data.rentalType === 'LOCKER' || data.rentalType === 'GYM_LOCKER') {
        newChecklist.lockerKey = false;
        newChecklist.towel = false;
      } else {
        // Room
        newChecklist.roomKey = false;
        newChecklist.bedSheets = false;
        if (data.hasTvRemote) {
          newChecklist.tvRemote = false;
        }
      }
      setChecklist(newChecklist);
      setView('checklist');
    } catch (error) {
      console.error('Failed to resolve key:', error);
      alert(error instanceof Error ? error.message : 'Failed to resolve key. Please try again.');
      setView('idle');
    }
  };

  // Handle checklist item toggle
  const handleChecklistToggle = (item: keyof CheckoutChecklist) => {
    setChecklist((prev) => ({
      ...prev,
      [item]: !prev[item],
    }));
  };

  // Submit checkout request
  const handleSubmitCheckout = async () => {
    if (!resolvedKey) return;

    try {
      const response = await fetch(`${API_BASE}/v1/checkout/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          occupancyId: resolvedKey.occupancyId,
          kioskDeviceId,
          checklist,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create checkout request');
      }

      const data = await response.json();
      setRequestId(data.requestId);
      setView('waiting');
    } catch (error) {
      console.error('Failed to submit checkout:', error);
      alert(error instanceof Error ? error.message : 'Failed to submit checkout. Please try again.');
    }
  };

  // Check if all required checklist items are checked
  const isChecklistComplete = () => {
    if (!resolvedKey) return false;
    
    if (resolvedKey.rentalType === 'LOCKER' || resolvedKey.rentalType === 'GYM_LOCKER') {
      return checklist.lockerKey === true && checklist.towel === true;
    } else {
      // Room
      const baseComplete = checklist.roomKey === true && checklist.bedSheets === true;
      if (resolvedKey.hasTvRemote) {
        return baseComplete && checklist.tvRemote === true;
      }
      return baseComplete;
    }
  };

  // Idle view
  if (view === 'idle') {
    return (
      <div className="idle-container">
        <img src={logoImage} alt="Club Dallas" className="logo-idle" />
        <button className="start-checkout-btn" onClick={handleStartCheckout}>
          Start Checkout
        </button>
      </div>
    );
  }

  // Scanning view
  if (view === 'scanning') {
    return (
      <div className="active-container">
        <img src={logoImage} alt="Club Dallas" className="logo-header" />
        <main className="main-content">
          <div className="scan-container">
            <p className="scan-instructions">
              Scan the QR code on your locker key or room key
            </p>
            <div id="qr-reader" ref={scannerContainerRef}></div>
          </div>
        </main>
      </div>
    );
  }

  // Checklist view
  if (view === 'checklist' && resolvedKey) {
    const isLocker = resolvedKey.rentalType === 'LOCKER' || resolvedKey.rentalType === 'GYM_LOCKER';
    
    return (
      <div className="active-container">
        <img src={logoImage} alt="Club Dallas" className="logo-header" />
        <main className="main-content">
          <div className="checklist-container">
            <h1 className="checklist-title">Please verify items returned</h1>
            
            <div className="checklist-items">
              {isLocker ? (
                <>
                  <div className="checklist-item" onClick={() => handleChecklistToggle('lockerKey')}>
                    <input
                      type="checkbox"
                      id="lockerKey"
                      checked={checklist.lockerKey || false}
                      onChange={() => handleChecklistToggle('lockerKey')}
                    />
                    <label htmlFor="lockerKey">Locker key</label>
                  </div>
                  <div className="checklist-item" onClick={() => handleChecklistToggle('towel')}>
                    <input
                      type="checkbox"
                      id="towel"
                      checked={checklist.towel || false}
                      onChange={() => handleChecklistToggle('towel')}
                    />
                    <label htmlFor="towel">Towel</label>
                  </div>
                </>
              ) : (
                <>
                  <div className="checklist-item" onClick={() => handleChecklistToggle('roomKey')}>
                    <input
                      type="checkbox"
                      id="roomKey"
                      checked={checklist.roomKey || false}
                      onChange={() => handleChecklistToggle('roomKey')}
                    />
                    <label htmlFor="roomKey">Room key</label>
                  </div>
                  <div className="checklist-item" onClick={() => handleChecklistToggle('bedSheets')}>
                    <input
                      type="checkbox"
                      id="bedSheets"
                      checked={checklist.bedSheets || false}
                      onChange={() => handleChecklistToggle('bedSheets')}
                    />
                    <label htmlFor="bedSheets">Bed sheets</label>
                  </div>
                  {resolvedKey.hasTvRemote && (
                    <div className="checklist-item" onClick={() => handleChecklistToggle('tvRemote')}>
                      <input
                        type="checkbox"
                        id="tvRemote"
                        checked={checklist.tvRemote || false}
                        onChange={() => handleChecklistToggle('tvRemote')}
                      />
                      <label htmlFor="tvRemote">TV remote</label>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="checklist-notice">
              <strong>Important:</strong>
              <ul>
                <li>A staff member must verify all items have been returned.</li>
                <li>Sheets and towels may be placed in the laundry bin at the counter.</li>
                <li>Keys and TV remotes must be handed directly to an employee.</li>
              </ul>
            </div>

            <button
              className="continue-btn"
              onClick={handleSubmitCheckout}
              disabled={!isChecklistComplete()}
            >
              Continue
            </button>
          </div>
        </main>
      </div>
    );
  }

  // Waiting for staff view
  if (view === 'waiting' && resolvedKey) {
    return (
      <div className="active-container">
        <img src={logoImage} alt="Club Dallas" className="logo-header" />
        <main className="main-content">
          <div className="waiting-container">
            <h1 className="waiting-title">Please hand your items to staff for verification.</h1>
            {lateFeeAmount > 0 && (
              <div className="late-fee-notice">
                Late fee due: ${lateFeeAmount.toFixed(2)}. Staff will collect payment.
              </div>
            )}
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
          <div className="complete-container">
            <h1 className="complete-title">
              {lateFeeAmount > 0 ? 'Late fee paid. We look forward to seeing you again.' : 'Checkout complete. Thank you.'}
            </h1>
          </div>
        </main>
      </div>
    );
  }

  return null;
}

export default App;




