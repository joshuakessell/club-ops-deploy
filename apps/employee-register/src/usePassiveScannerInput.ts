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
  const enabledRef = useRef(enabled);
  const pendingDisableRef = useRef(false);
  const resetRef = useRef<() => void>(() => {});

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
    pendingDisableRef.current = false;
  }, [clearTimer, onCaptureEnd]);

  useEffect(() => {
    resetRef.current = reset;
  }, [reset]);

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
    if (pendingDisableRef.current && !enabledRef.current) {
      pendingDisableRef.current = false;
      reset();
    }
  }, [clearTimer, cooldownMs, minLength, onCapture, onCaptureEnd, reset]);

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
      if (!enabledRef.current && !capturingRef.current) {
        return;
      }
      const before = bufferRef.current.length;
      const wasCapturing = capturingRef.current;
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
      const after = bufferRef.current.length;
      if (!wasCapturing && capturingRef.current && before === 0 && after > 0) {
        // First printable key started capture; keep focus from UI side-effects.
      }
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
    enabledRef.current = enabled;
    if (!enabled) {
      if (capturingRef.current) {
        pendingDisableRef.current = true;
        return;
      }
      resetRef.current();
      return;
    }
    resetRef.current();
    return () => {
      if (capturingRef.current) {
        pendingDisableRef.current = true;
        return;
      }
      resetRef.current();
    };
  }, [enabled, reset]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDownCapture, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDownCapture, { capture: true });
  }, [enabled, handleKeyDownCapture]);

  return { reset };
}
