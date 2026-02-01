import { useCallback, useEffect, useRef, useState } from 'react';
import { useScanCaptureInput } from '../../../scanner/useScanCaptureInput';
import { useScanResolutionState } from './useScanResolutionState';
import type { HomeTab, ScanResult, StaffSession } from '../shared/types';

type Params = {
  session: StaffSession | null;
  lane: string;
  homeTab: HomeTab;
  manualEntry: boolean;
  isSubmitting: boolean;
  externalBlocking: boolean;
  startLaneSessionByCustomerId: (
    customerId: string,
    opts?: { suppressAlerts?: boolean; customerLabel?: string | null }
  ) => Promise<ScanResult>;
};

export function useScanState({
  session,
  lane,
  homeTab,
  manualEntry,
  isSubmitting,
  externalBlocking,
  startLaneSessionByCustomerId,
}: Params) {
  const resolution = useScanResolutionState({ session, lane, startLaneSessionByCustomerId });

  const blockingModalOpen =
    externalBlocking ||
    !!resolution.pendingScanResolution ||
    resolution.showCreateFromScanPrompt ||
    !!resolution.idScanIssue;

  const [scanOverlayMounted, setScanOverlayMounted] = useState(false);
  const [scanOverlayActive, setScanOverlayActive] = useState(false);
  const [scanToastMessage, setScanToastMessage] = useState<string | null>(null);
  const [scanProcessing, setScanProcessing] = useState(false);
  const scanOverlayHideTimerRef = useRef<number | null>(null);
  const scanOverlayShownAtRef = useRef<number | null>(null);
  const SCAN_OVERLAY_MIN_VISIBLE_MS = 250;

  const scanEnabled =
    homeTab === 'scan' &&
    !!session?.sessionToken &&
    !isSubmitting &&
    !manualEntry &&
    !blockingModalOpen &&
    !scanProcessing;

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
            : scanProcessing
              ? 'Processing scan'
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
  }, [scanOverlayMounted]);

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

  const normalizeScanText = useCallback((raw: string) => {
    if (!raw) return '';
    const cleaned = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    return cleaned
      .split('\n')
      .filter((line) => line.trim().toUpperCase() !== 'ZTZTAN')
      .join('\n')
      .trim();
  }, []);

  const computeIdleTimeout = useCallback((value: string) => {
    const cleaned = value.replace(/\r/g, '\n');
    const trimmed = cleaned.trim();
    if (!trimmed) return 400;

    const looksAamva =
      trimmed.startsWith('@') ||
      trimmed.includes('ANSI ') ||
      trimmed.includes('AAMVA') ||
      /\nDCS/.test(cleaned) ||
      /\nDAQ/.test(cleaned);
    const hasInternalWhitespace = /\s/.test(trimmed);
    const looksLong = trimmed.length >= 24;

    if (looksAamva || hasInternalWhitespace || looksLong) {
      return 2400;
    }

    return 400;
  }, []);

  const handleCapture = useCallback(
    async (raw: string) => {
      const normalized = normalizeScanText(raw);
      if (!normalized) {
        return;
      }
      setScanToastMessage(null);
      setScanProcessing(true);
      try {
        const result = await resolution.onBarcodeCaptured(normalized);
        if (result.outcome === 'no_match') {
          if (result.canCreate) {
            resolution.setCreateFromScanError(null);
            resolution.setShowCreateFromScanPrompt(true);
          } else {
            setScanToastMessage(result.message);
          }
          return;
        }
        if (result.outcome === 'error') {
          if (result.message) setScanToastMessage(result.message);
        }
      } finally {
        setScanProcessing(false);
      }
    },
    [normalizeScanText, resolution]
  );

  const scanInput = useScanCaptureInput({
    enabled: scanEnabled,
    keepFocus: true,
    idleTimeoutMs: 260,
    getIdleTimeoutMs: computeIdleTimeout,
    onCaptureStart: () => {
      showScanOverlay();
    },
    onCaptureEnd: () => {
      hideScanOverlay();
    },
    onCancel: () => {
      hideScanOverlay();
    },
    onCapture: (raw) => {
      void handleCapture(raw);
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
    scanReady: scanEnabled,
    scanBlockedReason,
    scanInputRef: scanInput.scanInputRef,
    scanInputHandlers: scanInput.scanInputHandlers,
    scanInputEnabled: scanEnabled,
    pendingScanResolution: resolution.pendingScanResolution,
    scanResolutionError: resolution.scanResolutionError,
    scanResolutionSubmitting: resolution.scanResolutionSubmitting,
    setPendingScanResolution: resolution.setPendingScanResolution,
    setScanResolutionError: resolution.setScanResolutionError,
    setScanResolutionSubmitting: resolution.setScanResolutionSubmitting,
    resolvePendingScanSelection: resolution.resolvePendingScanSelection,
    showCreateFromScanPrompt: resolution.showCreateFromScanPrompt,
    pendingCreateFromScan: resolution.pendingCreateFromScan,
    createFromScanError: resolution.createFromScanError,
    createFromScanSubmitting: resolution.createFromScanSubmitting,
    idScanIssue: resolution.idScanIssue,
    setIdScanIssue: resolution.setIdScanIssue,
    setShowCreateFromScanPrompt: resolution.setShowCreateFromScanPrompt,
    setPendingCreateFromScan: resolution.setPendingCreateFromScan,
    setCreateFromScanError: resolution.setCreateFromScanError,
    setCreateFromScanSubmitting: resolution.setCreateFromScanSubmitting,
    handleCreateFromNoMatch: resolution.handleCreateFromNoMatch,
    blockingModalOpen,
  };
}
