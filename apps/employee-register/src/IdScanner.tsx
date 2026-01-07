import { useEffect, useRef, useState } from 'react';
import {
  BrowserMultiFormatReader,
  NotFoundException,
  type Result,
  type Exception,
} from '@zxing/library';
import type { IdScanPayload } from '@club-ops/shared';

interface IdScannerProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (payload: IdScanPayload) => void;
  onManualEntry: () => void;
}

/**
 * Simple AAMVA PDF417 parser - extracts basic fields from barcode string
 * AAMVA format: @\nANSI 636...\nDLDCA...\nDCSLASTNAME\nDACFIRSTNAME\nDADMIDDLENAME\nDBDYYYYMMDD\n...
 */
function parseAAMVA(raw: string): Partial<IdScanPayload> {
  const lines = raw.split('\n');
  const result: Partial<IdScanPayload> = { raw };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] || '';

    // DCS = Last name
    if (line.startsWith('DCS')) {
      result.lastName = line.substring(3).trim();
    }
    // DAC = First name
    else if (line.startsWith('DAC')) {
      result.firstName = line.substring(3).trim();
    }
    // DAD = Middle name (optional)
    else if (line.startsWith('DAD')) {
      const middle = line.substring(3).trim();
      if (middle && result.firstName) {
        result.firstName = `${result.firstName} ${middle}`;
      }
    }
    // DBD = Date of birth (YYYYMMDD format)
    else if (line.startsWith('DBD')) {
      const dobStr = line.substring(3).trim();
      if (dobStr.length === 8) {
        const year = dobStr.substring(0, 4);
        const month = dobStr.substring(4, 6);
        const day = dobStr.substring(6, 8);
        result.dob = `${year}-${month}-${day}`;
      }
    }
    // DAQ = ID number
    else if (line.startsWith('DAQ')) {
      result.idNumber = line.substring(3).trim();
    }
    // DAG = Address (not needed for our use case)
    // DAU = Height (not needed)
    // DAV = Weight (not needed)
    // DBA = Expiration date (not needed)
    // DBB = Issue date (not needed)
    // DBC = Gender (not needed)
    // DAA = Full name (if available, prefer this)
    else if (line.startsWith('DAA')) {
      result.fullName = line.substring(3).trim();
    }
    // DCF = Document discriminator (not needed)
    // DCG = Country (not needed)
    // DCA = Class (not needed)
    // DCB = Restrictions (not needed)
    // DCD = Endorsements (not needed)
    // DCE = Classification code (not needed)
    // DCI = Jurisdiction (state)
    else if (line.startsWith('DCI')) {
      result.jurisdiction = line.substring(3).trim();
      result.issuer = result.jurisdiction;
    }
  }

  // Build fullName if we have first and last
  if (!result.fullName && result.firstName && result.lastName) {
    result.fullName = `${result.firstName} ${result.lastName}`;
  }

  return result;
}

export function IdScanner({ isOpen, onClose, onScan, onManualEntry }: IdScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scannedData, setScannedData] = useState<IdScanPayload | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!isOpen) {
      // Cleanup on close
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (readerRef.current) {
        readerRef.current.reset();
      }
      setScanning(false);
      setError(null);
      setScannedData(null);
      setShowConfirm(false);
      return;
    }

    // Initialize scanner when modal opens
    const startScanning = async () => {
      try {
        setError(null);
        setScanning(true);

        const reader = new BrowserMultiFormatReader();
        readerRef.current = reader;

        // Get rear camera (environment facing)
        const devices = await reader.listVideoInputDevices();
        const rearCamera =
          devices.find(
            (device: MediaDeviceInfo) =>
              device.label.toLowerCase().includes('back') ||
              device.label.toLowerCase().includes('rear') ||
              device.label.toLowerCase().includes('environment')
          ) || devices[0]; // Fallback to first device

        if (!rearCamera) {
          throw new Error('No camera device found');
        }

        const video = videoRef.current;
        if (!video) {
          throw new Error('Video element not found');
        }

        // Start scanning with PDF417 support
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment', // Rear camera
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });

        streamRef.current = stream;
        video.srcObject = stream;
        await video.play();

        // Continuously decode
        const decodeContinuously = async () => {
          try {
            await reader.decodeFromVideoDevice(
              rearCamera.deviceId,
              video,
              (result: Result | null, err: Exception | undefined) => {
                if (result) {
                  const text = result.getText();

                  // Try to parse as AAMVA format
                  const parsed = parseAAMVA(text);

                  // Stop scanning
                  if (streamRef.current) {
                    streamRef.current.getTracks().forEach((track) => track.stop());
                    streamRef.current = null;
                  }
                  reader.reset();
                  setScanning(false);
                  setScannedData(parsed as IdScanPayload);
                  setShowConfirm(true);
                } else if (err && !(err instanceof NotFoundException)) {
                  // NotFoundException is normal (no barcode found yet)
                  console.warn('Scan error:', err);
                }
              }
            );
          } catch (err) {
            console.error('Decode error:', err);
            setError(err instanceof Error ? err.message : 'Failed to scan barcode');
            setScanning(false);
          }
        };

        void decodeContinuously();
      } catch (err) {
        console.error('Camera error:', err);
        setError(err instanceof Error ? err.message : 'Failed to access camera');
        setScanning(false);
      }
    };

    void startScanning();

    return () => {
      // Cleanup
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (readerRef.current) {
        readerRef.current.reset();
      }
    };
  }, [isOpen]);

  const handleConfirm = () => {
    if (scannedData) {
      onScan(scannedData);
      onClose();
    }
  };

  const handleEdit = () => {
    setShowConfirm(false);
    setScannedData(null);
    setScanning(true);
    // Restart scanning
    if (videoRef.current && streamRef.current) {
      const reader = new BrowserMultiFormatReader();
      readerRef.current = reader;
      // Re-initialize scanning (simplified - in production would restart properly)
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.9)',
        zIndex: 10000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {showConfirm && scannedData ? (
        <div
          style={{
            background: '#1e293b',
            padding: '2rem',
            borderRadius: '12px',
            maxWidth: '500px',
            width: '90%',
            color: 'white',
          }}
        >
          <h2 style={{ marginBottom: '1rem', fontSize: '1.5rem' }}>Confirm ID Details</h2>
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ marginBottom: '0.5rem' }}>
              <strong>Name:</strong>{' '}
              {scannedData.fullName ||
                `${scannedData.firstName || ''} ${scannedData.lastName || ''}`.trim() ||
                'N/A'}
            </div>
            {scannedData.dob && (
              <div style={{ marginBottom: '0.5rem' }}>
                <strong>Date of Birth:</strong> {scannedData.dob}
              </div>
            )}
            {scannedData.idNumber && (
              <div style={{ marginBottom: '0.5rem' }}>
                <strong>ID Number:</strong> {scannedData.idNumber}
              </div>
            )}
            {(scannedData.issuer || scannedData.jurisdiction) && (
              <div style={{ marginBottom: '0.5rem' }}>
                <strong>Issuer:</strong> {scannedData.issuer || scannedData.jurisdiction}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={handleConfirm}
              style={{
                flex: 1,
                padding: '0.75rem',
                background: '#10b981',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '1rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Confirm
            </button>
            <button
              onClick={handleEdit}
              style={{
                flex: 1,
                padding: '0.75rem',
                background: '#475569',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '1rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Edit / Rescan
            </button>
          </div>
        </div>
      ) : (
        <>
          <div
            style={{
              position: 'relative',
              width: '90%',
              maxWidth: '600px',
              aspectRatio: '16/9',
              background: '#000',
              borderRadius: '12px',
              overflow: 'hidden',
              marginBottom: '1rem',
            }}
          >
            <video
              ref={videoRef}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }}
              playsInline
            />
            {/* Overlay guide */}
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '80%',
                height: '40%',
                border: '3px solid #3b82f6',
                borderRadius: '8px',
                pointerEvents: 'none',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: '-30px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  color: 'white',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  textAlign: 'center',
                  background: 'rgba(0, 0, 0, 0.7)',
                  padding: '0.25rem 0.5rem',
                  borderRadius: '4px',
                }}
              >
                Align ID barcode here
              </div>
            </div>
          </div>

          {error && (
            <div
              style={{
                background: '#ef4444',
                color: 'white',
                padding: '1rem',
                borderRadius: '8px',
                marginBottom: '1rem',
                maxWidth: '600px',
                width: '90%',
              }}
            >
              <strong>Error:</strong> {error}
            </div>
          )}

          {scanning && !error && (
            <div
              style={{
                color: 'white',
                textAlign: 'center',
                marginBottom: '1rem',
              }}
            >
              <p style={{ fontSize: '1.125rem', marginBottom: '0.5rem' }}>Scanning ID...</p>
              <p style={{ fontSize: '0.875rem', color: '#94a3b8' }}>
                Point camera at the barcode on the back of the ID
              </p>
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={onClose}
              style={{
                padding: '0.75rem 1.5rem',
                background: '#475569',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '1rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={onManualEntry}
              style={{
                padding: '0.75rem 1.5rem',
                background: '#64748b',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '1rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Enter Manually
            </button>
          </div>
        </>
      )}
    </div>
  );
}
