import { useState, useEffect, useRef, useCallback } from 'react';
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library';

const API_BASE = '/api';

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

export function LockScreen({ onLogin, deviceType, deviceId }: LockScreenProps) {
  const [mode, setMode] = useState<'qr' | 'pin'>('qr');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const codeReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanningIntervalRef = useRef<number | null>(null);
  const handleScanRef = useRef<((qrToken: string) => Promise<void>) | null>(null);

  // Initialize camera for QR scanning
  useEffect(() => {
    if (mode !== 'qr') {
      // Stop camera when not in QR mode
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (scanningIntervalRef.current) {
        clearInterval(scanningIntervalRef.current);
        scanningIntervalRef.current = null;
      }
      return;
    }

    const initCamera = async () => {
      try {
        const constraints: MediaStreamConstraints = {
          video: {
            facingMode: 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        const codeReader = new BrowserMultiFormatReader();
        codeReaderRef.current = codeReader;
        setError(null);

        startScanning();
      } catch (error) {
        console.error('Camera error:', error);
        setError('Camera access denied. Please use PIN entry.');
        setMode('pin');
      }
    };

    initCamera();

    return () => {
      if (codeReaderRef.current) {
        codeReaderRef.current.reset();
      }
      if (scanningIntervalRef.current) {
        clearInterval(scanningIntervalRef.current);
        scanningIntervalRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, [mode]);

  const startScanning = useCallback(() => {
    if (!videoRef.current || !canvasRef.current || !codeReaderRef.current) return;

    const scan = async () => {
      if (!videoRef.current || !canvasRef.current || !codeReaderRef.current) return;

      try {
        const canvas = canvasRef.current;
        const video = videoRef.current;
        const context = canvas.getContext('2d');

        if (!context || video.readyState !== video.HAVE_ENOUGH_DATA) return;

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        const img = new Image();
        img.src = canvas.toDataURL();
        await new Promise((resolve) => {
          img.onload = resolve;
        });

        const result = await codeReaderRef.current.decodeFromImageElement(img);

        if (result && handleScanRef.current) {
          handleScanRef.current(result.getText());
        }
      } catch (error) {
        if (!(error instanceof NotFoundException)) {
          console.error('Scan error:', error);
        }
      }
    };

    scanningIntervalRef.current = window.setInterval(scan, 500);
  }, []);

  const handleQrScan = useCallback(async (qrToken: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId,
          deviceType,
          qrToken,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Login failed');
      }

      const session: StaffSession = await response.json();
      onLogin(session);
    } catch (error) {
      console.error('Login error:', error);
      setError(error instanceof Error ? error.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  }, [deviceId, deviceType, onLogin]);

  useEffect(() => {
    handleScanRef.current = handleQrScan;
  }, [handleQrScan]);

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!pin.trim()) {
      setError('Please enter a PIN');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId,
          deviceType,
          pin: pin.trim(),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Login failed');
      }

      const session: StaffSession = await response.json();
      onLogin(session);
      setPin('');
    } catch (error) {
      console.error('Login error:', error);
      setError(error instanceof Error ? error.message : 'Invalid PIN');
      setPin('');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="lock-screen">
      <div className="lock-screen-content">
        <div className="lock-screen-header">
          <h1>Staff Login</h1>
          <p>Scan QR code or enter PIN</p>
        </div>

        <div className="lock-screen-tabs">
          <button
            className={`tab-button ${mode === 'qr' ? 'active' : ''}`}
            onClick={() => {
              setMode('qr');
              setError(null);
            }}
            disabled={isLoading}
          >
            QR Code
          </button>
          <button
            className={`tab-button ${mode === 'pin' ? 'active' : ''}`}
            onClick={() => {
              setMode('pin');
              setError(null);
            }}
            disabled={isLoading}
          >
            PIN
          </button>
        </div>

        {error && (
          <div className="lock-screen-error">
            {error}
          </div>
        )}

        {mode === 'qr' ? (
          <div className="lock-screen-qr">
            <div className="qr-scanner-container">
              <video
                ref={videoRef}
                className="qr-scanner-video"
                autoPlay
                playsInline
                muted
              />
              <canvas ref={canvasRef} className="qr-scanner-canvas" style={{ display: 'none' }} />
              {isLoading && (
                <div className="qr-scanner-overlay">
                  <div className="spinner">Processing...</div>
                </div>
              )}
            </div>
            <p className="qr-hint">Point camera at staff QR code</p>
          </div>
        ) : (
          <form className="lock-screen-pin" onSubmit={handlePinSubmit}>
            <input
              type="password"
              className="pin-input"
              placeholder="Enter PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              disabled={isLoading}
              autoFocus
              maxLength={10}
            />
            <button
              type="submit"
              className="pin-submit-button"
              disabled={isLoading || !pin.trim()}
            >
              {isLoading ? 'Logging in...' : 'Login'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

