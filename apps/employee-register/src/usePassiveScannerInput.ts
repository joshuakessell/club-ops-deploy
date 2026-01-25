import { useCallback, useEffect, useRef } from 'react';
import { handlePassiveScannerKeydown } from './scanner/passiveScannerKeydown';
import type { PassiveScannerInputOptions } from './scanner/passiveScannerTypes';
/** Passive keyboard-wedge scanner capture for "scan anywhere" screens. */
export function usePassiveScannerInput({
  enabled,
  onCapture,
  onCaptureStart,
  onCaptureEnd,
  onCancel,
  idleTimeoutMs = 180,
  cooldownMs = 400,
  enterGraceMs = 35,
  minLength = 4,
  captureWhenEditable = false,
  enterTerminates = true,
  tabTerminates = true,
  getIdleTimeoutMs,
  scannerInterKeyMaxMs = 35,
}: PassiveScannerInputOptions) {
  const capturingRef = useRef(false);
  const bufferRef = useRef('');
  const timerRef = useRef<number | null>(null);
  const lastWasEnterRef = useRef(false);
  const lastKeyAtRef = useRef<number | null>(null);
  const cooldownUntilRef = useRef<number>(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    const wasCapturing = capturingRef.current;
    capturingRef.current = false;
    bufferRef.current = '';
    lastWasEnterRef.current = false;
    lastKeyAtRef.current = null;
    clearTimer();
    if (wasCapturing) onCaptureEnd?.();
  }, [clearTimer, onCaptureEnd]);

  const finalize = useCallback(() => {
    clearTimer();
    capturingRef.current = false;
    lastWasEnterRef.current = false;

    let raw = bufferRef.current;
    bufferRef.current = '';
    if (!raw) {
      onCaptureEnd?.();
      return;
    }

    // If the scan ended with a terminator Enter, drop the trailing newline but preserve internal ones.
    if (raw.endsWith('\n')) {
      raw = raw.replace(/\n+$/g, '\n').replace(/\n$/, '');
    }

    if (raw.trim().length < minLength) {
      onCaptureEnd?.();
      return;
    }
    cooldownUntilRef.current = Date.now() + cooldownMs;
    onCapture(raw);
    onCaptureEnd?.();
  }, [clearTimer, cooldownMs, minLength, onCapture, onCaptureEnd]);

  const resolveIdleTimeout = useCallback(() => {
    if (getIdleTimeoutMs) {
      return getIdleTimeoutMs(bufferRef.current);
    }
    return idleTimeoutMs;
  }, [getIdleTimeoutMs, idleTimeoutMs]);

  const scheduleFinalize = useCallback(() => {
    clearTimer();
    const timeout = resolveIdleTimeout();
    timerRef.current = window.setTimeout(() => finalize(), timeout);
  }, [clearTimer, finalize, resolveIdleTimeout]);

  const scheduleFinalizeAfterEnter = useCallback(() => {
    clearTimer();
    timerRef.current = window.setTimeout(
      () => {
        if (lastWasEnterRef.current) finalize();
      },
      Math.max(0, Math.min(resolveIdleTimeout(), enterGraceMs))
    );
  }, [clearTimer, enterGraceMs, finalize, resolveIdleTimeout]);

  const handleKeyDownCapture = useCallback(
    (e: KeyboardEvent) => {
      handlePassiveScannerKeydown(
        e,
        {
          capturingRef,
          bufferRef,
          lastWasEnterRef,
          lastKeyAtRef,
          cooldownUntilRef,
        },
        {
          captureWhenEditable,
          enterTerminates,
          tabTerminates,
          scannerInterKeyMaxMs,
        },
        {
          onCaptureStart,
          onCancel,
          reset,
          scheduleFinalize,
          scheduleFinalizeAfterEnter,
        }
      );
    },
    [
      captureWhenEditable,
      enterTerminates,
      onCancel,
      onCaptureStart,
      reset,
      scheduleFinalize,
      scheduleFinalizeAfterEnter,
      scannerInterKeyMaxMs,
      tabTerminates,
    ]
  );

  useEffect(() => {
    if (!enabled) {
      reset();
      return;
    }
    reset();
    return () => reset();
  }, [enabled, reset]);

  useEffect(() => {
    if (!enabled) return;

    window.addEventListener('keydown', handleKeyDownCapture, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDownCapture, { capture: true });
  }, [enabled, handleKeyDownCapture]);

  return { reset };
}
