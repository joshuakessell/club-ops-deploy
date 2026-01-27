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
  const passiveCaptureHandledRef = useRef(false);
  const SCAN_OVERLAY_MIN_VISIBLE_MS = 300;
  const prevScanEnabledRef = useRef<boolean | null>(null);

  const passiveScanEnabled =
    homeTab === 'scan' &&
    !!session?.sessionToken &&
    !isSubmitting &&
    !manualEntry &&
    !blockingModalOpen;

  const scanBlockedReason = !session?.sessionToken
    ? 'Not authenticated'
    : homeTab !== 'scan'
      ? 'Scan tab inactive'
      : isSubmitting
        ? 'Submitting'
        : manualEntry
          ? 'Manual entry active'
            : blockingModalOpen
              ? 'Modal open'
              : null;

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
  }, [scanOverlayHideTimerRef, scanOverlayMounted]);

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
        if (!cleanedScanText) {
          passiveScanProcessingRef.current = false;
          setPassiveScanProcessing(false);
          hideScanOverlay();
          return;
        }
        const normalizedScanText = rawScanText
          .split(/\r?\n/)
          .filter((line) => line.trim().toUpperCase() !== 'ZTZTAN')
          .join('\n')
          .trim();
        setScanToastMessage(null);
        const result = await onBarcodeCaptured(normalizedScanText || rawScanText);
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
    if (!trimmed) return 800;
    const looksAamva =
      trimmed.startsWith('@') ||
      trimmed.includes('ANSI ') ||
      trimmed.includes('AAMVA') ||
      trimmed.includes('DL');
    if (!looksAamva) return 800;

    const upper = trimmed.toUpperCase();
    const hasTerminator = upper.includes('ZTZTAN');
    if (hasTerminator) return 200;

    return 3000;
  }, []);

  usePassiveScannerInput({
    enabled: passiveScanEnabled,
    idleTimeoutMs: 1200,
    enterGraceMs: 350,
    captureWhenEditable: true,
    minLength: 1,
    enterTerminates: false,
    tabTerminates: false,
    scannerInterKeyMaxMs: 2000,
    getIdleTimeoutMs: computeScanIdleTimeout,
    onCaptureStart: () => {
      passiveScanProcessingRef.current = true;
      setPassiveScanProcessing(true);
      passiveCaptureHandledRef.current = false;
      showScanOverlay();
    },
    onCaptureEnd: () => {
      if (!passiveCaptureHandledRef.current) {
        passiveScanProcessingRef.current = false;
        setPassiveScanProcessing(false);
        hideScanOverlay();
      }
    },
    onCancel: () => {
      passiveScanProcessingRef.current = false;
      setPassiveScanProcessing(false);
      passiveCaptureHandledRef.current = false;
      hideScanOverlay();
    },
    onCapture: (raw) => {
      passiveCaptureHandledRef.current = true;
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
    scanReady: passiveScanEnabled,
    scanBlockedReason,
  };
}
