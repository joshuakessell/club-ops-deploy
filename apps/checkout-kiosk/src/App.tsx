import { useEffect, useState, useRef } from 'react';
import type {
  WebSocketEvent,
  ResolvedCheckoutKey,
  CheckoutChecklist,
  CheckoutCompletedPayload,
} from '@club-ops/shared';
import { Html5Qrcode } from 'html5-qrcode';
import logoImage from './assets/the-clubs-logo.png';

// Explicitly type the image import to avoid type inference issues
const logoImageSrc = String(logoImage);

const API_BASE = '/api';

// Type guards for API responses
type ApiErrorShape = { error?: string; requestId?: string };
function isApiErrorShape(v: unknown): v is ApiErrorShape {
  return typeof v === 'object' && v !== null && ('error' in v || 'requestId' in v);
}

function isResolvedCheckoutKey(v: unknown): v is ResolvedCheckoutKey {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj.occupancyId === 'string' &&
    typeof obj.rentalType === 'string' &&
    typeof obj.lateFeeAmount === 'number' &&
    typeof obj.hasTvRemote === 'boolean' &&
    typeof obj.customerName === 'string'
  );
}

function assertResolvedCheckoutKey(v: unknown): ResolvedCheckoutKey {
  if (!isResolvedCheckoutKey(v)) {
    throw new Error('Invalid ResolvedCheckoutKey format');
  }
  return v;
}

type CheckoutRequestResponse = { requestId: string };
function isCheckoutRequestResponse(v: unknown): v is CheckoutRequestResponse {
  return (
    typeof v === 'object' &&
    v !== null &&
    'requestId' in v &&
    typeof (v as { requestId: unknown }).requestId === 'string'
  );
}

function isWebSocketEvent(v: unknown): v is WebSocketEvent {
  return (
    typeof v === 'object' &&
    v !== null &&
    'type' in v &&
    typeof (v as { type: unknown }).type === 'string' &&
    'payload' in v
  );
}

type AppView = 'idle' | 'scanning' | 'checklist' | 'waiting' | 'complete';

type ResolvedKeyData = ResolvedCheckoutKey;

function App() {
  const [view, setView] = useState<AppView>('idle');
  const [resolvedKey, setResolvedKey] = useState<ResolvedKeyData | null>(null);
  const [checklist, setChecklist] = useState<CheckoutChecklist>({});
  const [requestId, setRequestId] = useState<string | null>(null);
  const [lateFeeAmount, setLateFeeAmount] = useState<number>(0);
  const qrCodeScannerRef = useRef<Html5Qrcode | null>(null);
  const scannerContainerRef = useRef<HTMLDivElement>(null);
  const kioskDeviceId = useState(() => {
    const storage = window.localStorage;
    let id = storage.getItem('checkout_kiosk_device_id');
    if (!id) {
      id = `checkout-kiosk-${crypto.randomUUID()}`;
      storage.setItem('checkout_kiosk_device_id', id);
    }
    return id;
  })[0];

  // WebSocket connection for checkout completion events
  useEffect(() => {
    const ws = new WebSocket(`ws://${window.location.hostname}:3001/ws`);

    ws.onopen = () => {
      console.log('WebSocket connected');

      // Subscribe to checkout events
      ws.send(
        JSON.stringify({
          type: 'subscribe',
          events: ['CHECKOUT_COMPLETED'],
        })
      );
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const dataString = typeof event.data === 'string' ? event.data : String(event.data);
        const parsed = JSON.parse(dataString) as unknown;
        if (!isWebSocketEvent(parsed)) {
          console.error('Invalid WebSocket message format:', parsed);
          return;
        }
        const message = parsed;
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
      } catch (err: unknown) {
        console.error('Failed to parse WebSocket message:', err);
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
          void handleQRScanned(decodedText).catch((err: unknown) => {
            console.error('Error handling QR scan:', err);
          });
        },
        (_errorMessage) => {
          // Ignore errors (scanner will keep trying)
        }
      );
    } catch (err: unknown) {
      console.error('Failed to start QR scanner:', err);
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
      } catch (err: unknown) {
        console.error('Error stopping scanner:', err);
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
        const errorData = (await response.json()) as unknown;
        const errorMessage = isApiErrorShape(errorData) ? errorData.error : 'Failed to resolve key';
        throw new Error(errorMessage);
      }

      const responseData: unknown = await response.json();
      // Type assertion is safe because assertResolvedCheckoutKey validates and narrows the type
      const data: ResolvedKeyData = assertResolvedCheckoutKey(responseData);
      setResolvedKey(data);
      const feeAmount: number =
        typeof data.lateFeeAmount === 'number' && Number.isFinite(data.lateFeeAmount)
          ? data.lateFeeAmount
          : 0;
      setLateFeeAmount(feeAmount);

      // Initialize checklist based on rental type
      const newChecklist: CheckoutChecklist = {};
      // Key is always required; label differs by rental type in UI.
      newChecklist.key = false;
      if (data.rentalType === 'LOCKER' || data.rentalType === 'GYM_LOCKER') {
        newChecklist.towel = false;
      } else {
        // Room
        newChecklist.sheets = false;
        if (data.hasTvRemote) {
          newChecklist.remote = false;
        }
      }
      setChecklist(newChecklist);
      setView('checklist');
    } catch (err: unknown) {
      console.error('Failed to resolve key:', err);
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to resolve key. Please try again.';
      alert(errorMessage);
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
          occupancyId: String(resolvedKey.occupancyId),
          kioskDeviceId: String(kioskDeviceId),
          checklist,
        }),
      });

      if (!response.ok) {
        const errorData = (await response.json()) as unknown;
        const errorMessage = isApiErrorShape(errorData)
          ? errorData.error
          : 'Failed to create checkout request';
        throw new Error(errorMessage);
      }

      const responseData = (await response.json()) as unknown;
      if (!isCheckoutRequestResponse(responseData)) {
        throw new Error('Invalid response format');
      }
      setRequestId(responseData.requestId);
      setView('waiting');
    } catch (err: unknown) {
      console.error('Failed to submit checkout:', err);
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to submit checkout. Please try again.';
      alert(errorMessage);
    }
  };

  // Check if all required checklist items are checked
  const isChecklistComplete = () => {
    if (!resolvedKey) return false;

    const baseKeyOk = checklist.key === true;
    if (resolvedKey.rentalType === 'LOCKER' || resolvedKey.rentalType === 'GYM_LOCKER') {
      return baseKeyOk && checklist.towel === true;
    }
    // Room
    const baseComplete = baseKeyOk && checklist.sheets === true;
    if (resolvedKey.hasTvRemote) return baseComplete && checklist.remote === true;
    return baseComplete;
  };

  // Idle view
  if (view === 'idle') {
    return (
      <div className="idle-container">
        <img src={logoImageSrc} alt="Club Dallas" className="logo-idle" />
        <button className="start-checkout-btn" onClick={() => void handleStartCheckout()}>
          Start Checkout
        </button>
      </div>
    );
  }

  // Scanning view
  if (view === 'scanning') {
    return (
      <div className="active-container">
        <img src={logoImageSrc} alt="Club Dallas" className="logo-header" />
        <main className="main-content">
          <div className="scan-container">
            <p className="scan-instructions">Scan the QR code on your locker key or room key</p>
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
        <img src={logoImageSrc} alt="Club Dallas" className="logo-header" />
        <main className="main-content">
          <div className="checklist-container">
            <h1 className="checklist-title">Please verify items returned</h1>

            <div className="checklist-items">
              {isLocker ? (
                <>
                  <div className="checklist-item" onClick={() => handleChecklistToggle('key')}>
                    <input
                      type="checkbox"
                      id="key"
                      checked={checklist.key === true}
                      onChange={() => handleChecklistToggle('key')}
                    />
                    <label htmlFor="key">Locker key</label>
                  </div>
                  <div className="checklist-item" onClick={() => handleChecklistToggle('towel')}>
                    <input
                      type="checkbox"
                      id="towel"
                      checked={checklist.towel === true}
                      onChange={() => handleChecklistToggle('towel')}
                    />
                    <label htmlFor="towel">Towel</label>
                  </div>
                </>
              ) : (
                <>
                  <div className="checklist-item" onClick={() => handleChecklistToggle('key')}>
                    <input
                      type="checkbox"
                      id="key"
                      checked={checklist.key === true}
                      onChange={() => handleChecklistToggle('key')}
                    />
                    <label htmlFor="key">Room key</label>
                  </div>
                  <div className="checklist-item" onClick={() => handleChecklistToggle('sheets')}>
                    <input
                      type="checkbox"
                      id="sheets"
                      checked={checklist.sheets === true}
                      onChange={() => handleChecklistToggle('sheets')}
                    />
                    <label htmlFor="sheets">Sheets</label>
                  </div>
                  {resolvedKey.hasTvRemote && (
                    <div className="checklist-item" onClick={() => handleChecklistToggle('remote')}>
                      <input
                        type="checkbox"
                        id="remote"
                        checked={checklist.remote === true}
                        onChange={() => handleChecklistToggle('remote')}
                      />
                      <label htmlFor="remote">TV remote</label>
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
              onClick={() => void handleSubmitCheckout()}
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
        <img src={logoImageSrc} alt="Club Dallas" className="logo-header" />
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
        <img src={logoImageSrc} alt="Club Dallas" className="logo-header" />
        <main className="main-content">
          <div className="complete-container">
            <h1 className="complete-title">
              {lateFeeAmount > 0
                ? 'Late fee paid. We look forward to seeing you again.'
                : 'Checkout complete. Thank you.'}
            </h1>
          </div>
        </main>
      </div>
    );
  }

  return null;
}

export default App;
