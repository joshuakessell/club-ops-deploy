import { useCallback, useEffect, useRef, useState } from 'react';
import { usePassiveScannerInput } from '../../../usePassiveScannerInput';
import type { HomeTab, ScanResult, StaffSession } from '../shared/types';

type Params = {
  session: StaffSession | null;
  homeTab: HomeTab;
  manualEntry: boolean;
  isSubmitting: boolean;
  blockingModalOpen: boolean;
  onBarcodeCaptured: (rawScanText: string) => Promise<ScanResult>;
  setCreateFromScanError: (value: string | null) => void;
  setShowCreateFromScanPrompt: (value: boolean) => void;
};

export function useScanOverlayState({
  session,
  homeTab,
  manualEntry,
  isSubmitting,
  blockingModalOpen,
  onBarcodeCaptured,
  setCreateFromScanError,
  setShowCreateFromScanPrompt,
}: Params) {
  const [passiveScanProcessing, setPassiveScanProcessing] = useState(false);
  const passiveScanProcessingRef = useRef(false);
  const [scanOverlayMounted, setScanOverlayMounted] = useState(false);
  const [scanOverlayActive, setScanOverlayActive] = useState(false);
  const [scanToastMessage, setScanToastMessage] = useState<string | null>(null);
  const scanOverlayHideTimerRef = useRef<number | null>(null);
  const scanOverlayShownAtRef = useRef<number | null>(null);
  const SCAN_OVERLAY_MIN_VISIBLE_MS = 300;

  const passiveScanEnabled =
    homeTab === 'scan' &&
    !!session?.sessionToken &&
    !passiveScanProcessing &&
    !isSubmitting &&
    !manualEntry &&
    !blockingModalOpen;

  const showScanOverlay = useCallback(() => {
    if (scanOverlayHideTimerRef.current) {
      window.clearTimeout(scanOverlayHideTimerRef.current);
      scanOverlayHideTimerRef.current = null;
    }

    if (!scanOverlayMounted) {
      setScanOverlayMounted(true);
    }

    window.requestAnimationFrame(() => {
      setScanOverlayActive(true);
      scanOverlayShownAtRef.current = Date.now();
    });
  }, [scanOverlayHideTimer, scanOverlayMounted]);

  const hideScanOverlay = useCallback(() => {
    if (scanOverlayHideTimerRef.current) return;
    const now = Date.now();
    const shownAt = scanOverlayShownAtRef.current ?? now;
    const elapsed = now - shownAt;
    const remaining = Math.max(0, SCAN_OVERLAY_MIN_VISIBLE_MS - elapsed);
    scanOverlayHideTimerRef.current = window.setTimeout(() => {
      setScanOverlayActive(false);
      window.setTimeout(() => {
        setScanOverlayMounted(false);
        scanOverlayHideTimerRef.current = null;
        scanOverlayShownAtRef.current = null;
      }, 220);
    }, remaining);
  }, []);

  const handlePassiveCapture = useCallback(
    (rawScanText: string) => {
      void (async () => {
        const cleanedScanText = rawScanText.trim();
        if (
          cleanedScanText === 'TZTAN' ||
          (cleanedScanText.length > 0 &&
            cleanedScanText.length <= 8 &&
            /^[A-Za-z]+$/.test(cleanedScanText))
        ) {
          passiveScanProcessingRef.current = false;
          setPassiveScanProcessing(false);
          hideScanOverlay();
          return;
        }
        setScanToastMessage(null);
        const result = await onBarcodeCaptured(rawScanText);
        passiveScanProcessingRef.current = false;
        setPassiveScanProcessing(false);
        hideScanOverlay();
        if (result.outcome === 'no_match') {
          if (result.canCreate) {
            setCreateFromScanError(null);
            setShowCreateFromScanPrompt(true);
          } else {
            setScanToastMessage(result.message);
          }
          return;
        }
        if (result.outcome === 'error') {
          setScanToastMessage(result.message);
        }
      })();
    },
    [hideScanOverlay, onBarcodeCaptured, setCreateFromScanError, setShowCreateFromScanPrompt]
  );

  const computeScanIdleTimeout = useCallback((buffer: string) => {
    const trimmed = buffer.trim();
    if (!trimmed) return 250;
    const looksAamva =
      trimmed.startsWith('@') ||
      trimmed.includes('ANSI ') ||
      trimmed.includes('AAMVA') ||
      trimmed.includes('DL');
    if (!looksAamva) return 250;
    const hasCoreFields =
      trimmed.includes('DCS') &&
      trimmed.includes('DAC') &&
      (trimmed.includes('DBB') || trimmed.includes('DBD')) &&
      trimmed.includes('DAQ');
    return hasCoreFields ? 250 : 1200;
  }, []);

  usePassiveScannerInput({
    enabled: passiveScanEnabled,
    idleTimeoutMs: 250,
    enterGraceMs: 80,
    captureWhenEditable: false,
    enterTerminates: false,
    tabTerminates: false,
    getIdleTimeoutMs: computeScanIdleTimeout,
    onCaptureEnd: () => {
      if (!passiveScanProcessingRef.current) hideScanOverlay();
    },
    onCancel: () => {
      passiveScanProcessingRef.current = false;
      setPassiveScanProcessing(false);
      hideScanOverlay();
    },
    onCapture: (raw) => {
      passiveScanProcessingRef.current = true;
      setPassiveScanProcessing(true);
      showScanOverlay();
      handlePassiveCapture(raw);
    },
  });

  useEffect(() => {
    return () => {
      if (scanOverlayHideTimerRef.current) {
        window.clearTimeout(scanOverlayHideTimerRef.current);
      }
    };
  }, []);

  return {
    scanOverlayMounted,
    scanOverlayActive,
    scanToastMessage,
    setScanToastMessage,
  };
}
