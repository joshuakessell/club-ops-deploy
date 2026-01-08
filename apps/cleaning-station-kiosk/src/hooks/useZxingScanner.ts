import { useEffect, useRef, useState, useCallback } from 'react';
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library';

export interface UseZxingScannerOptions {
  enabled: boolean;
  facingMode?: 'user' | 'environment';
  onScan?: (tagCode: string) => void;
}

export interface UseZxingScannerReturn {
  videoRef: React.RefObject<HTMLVideoElement>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  isCameraReady: boolean;
  cameraError: string | null;
  cameraFacingMode: 'user' | 'environment';
  setFacingMode: (mode: 'user' | 'environment') => void;
  startCamera: (options: { facingMode: 'user' | 'environment' }) => Promise<void>;
  stopCamera: () => void;
}

export function useZxingScanner({
  enabled,
  facingMode: initialFacingMode = 'user',
  onScan,
}: UseZxingScannerOptions): UseZxingScannerReturn {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const codeReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanningIntervalRef = useRef<number | null>(null);
  const onScanRef = useRef<((tagCode: string) => void) | null>(null);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraFacingMode, setCameraFacingMode] = useState<'user' | 'environment'>(
    initialFacingMode
  );

  // Keep onScan ref in sync
  useEffect(() => {
    onScanRef.current = onScan || null;
  }, [onScan]);

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

        // Convert canvas to image for ZXing
        const img = new Image();
        img.src = canvas.toDataURL();
        await new Promise((resolve) => {
          img.onload = resolve;
        });

        const result = await codeReaderRef.current.decodeFromImageElement(img);

        if (result && onScanRef.current) {
          onScanRef.current(result.getText());
        }
      } catch (error) {
        // NotFoundException is expected when no QR code is visible
        if (!(error instanceof NotFoundException)) {
          console.error('Scan error:', error);
        }
      }
    };

    // Scan every 500ms
    scanningIntervalRef.current = window.setInterval(() => {
      void scan();
    }, 500);
  }, []);

  const stopScanning = useCallback(() => {
    if (codeReaderRef.current) {
      codeReaderRef.current.reset();
    }
    if (scanningIntervalRef.current) {
      clearInterval(scanningIntervalRef.current);
      scanningIntervalRef.current = null;
    }
  }, []);

  const startCamera = useCallback(
    async (options: { facingMode: 'user' | 'environment' }) => {
      try {
        const constraints: MediaStreamConstraints = {
          video: {
            facingMode: options.facingMode,
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

        // Initialize ZXing reader
        const codeReader = new BrowserMultiFormatReader();
        codeReaderRef.current = codeReader;
        setCameraError(null);
        setIsCameraReady(true);

        // Start continuous scanning
        startScanning();
      } catch (error) {
        console.error('Camera error:', error);
        setCameraError(error instanceof Error ? error.message : 'Failed to access camera');
        setIsCameraReady(false);
      }
    },
    [startScanning]
  );

  const stopCamera = useCallback(() => {
    stopScanning();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setIsCameraReady(false);
  }, [stopScanning]);

  // Initialize camera when enabled
  useEffect(() => {
    if (!enabled) {
      stopCamera();
      return;
    }

    let cancelled = false;
    const initCamera = async () => {
      try {
        await startCamera({ facingMode: cameraFacingMode });
        if (cancelled) {
          stopCamera();
        }
      } catch (error) {
        // Error already handled in startCamera
      }
    };

    void initCamera();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [enabled, cameraFacingMode, startCamera, stopCamera]);

  return {
    videoRef,
    canvasRef,
    isCameraReady,
    cameraError,
    cameraFacingMode,
    setFacingMode: setCameraFacingMode,
    startCamera,
    stopCamera,
  };
}

