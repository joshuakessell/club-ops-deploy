import { useCallback, useEffect, useRef } from 'react';
import { handleScannerKeydown } from './scanner/scannerKeydown';
import type { ScannerCapture, ScannerInputOptions } from './scanner/scannerInputTypes';

export type { ScannerCapture } from './scanner/scannerInputTypes';

/**
 * Robust keyboard-wedge scanner capture.
 */
export function useScannerInput({
  enabled,
  onCapture,
  onCancel,
  idleTimeoutMs = 75,
  enterGraceMs = 35,
}: ScannerInputOptions) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const bufferRef = useRef('');
  const timerRef = useRef<number | null>(null);
  const lastWasEnterRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    bufferRef.current = '';
    clearTimer();
    lastWasEnterRef.current = false;
    const el = inputRef.current;
    if (el) el.value = '';
  }, [clearTimer]);

  const finalize = useCallback(() => {
    clearTimer();
    let raw = bufferRef.current;
    bufferRef.current = '';
    lastWasEnterRef.current = false;
    const el = inputRef.current;
    if (el) el.value = '';
    if (!raw) return;
    // If the scan ended with a terminator Enter, drop the trailing newline but preserve internal ones.
    if (raw.endsWith('\n')) {
      raw = raw.replace(/\n+$/g, '\n').replace(/\n$/, '');
    }
    onCapture({ raw });
  }, [clearTimer, onCapture]);

  const scheduleFinalize = useCallback(() => {
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      finalize();
    }, idleTimeoutMs);
  }, [clearTimer, finalize, idleTimeoutMs]);

  const scheduleFinalizeAfterEnter = useCallback(() => {
    clearTimer();
    timerRef.current = window.setTimeout(
      () => {
        // If no additional content arrived after Enter, treat it as terminator.
        if (lastWasEnterRef.current) {
          finalize();
        }
      },
      Math.max(0, Math.min(idleTimeoutMs, enterGraceMs))
    );
  }, [clearTimer, enterGraceMs, finalize, idleTimeoutMs]);

  const focusInput = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    try {
      el.focus({ preventScroll: true });
    } catch {
      el.focus();
    }
  }, []);

  const handleBlur = useCallback(() => {
    if (!enabled) return;
    // Refocus on next tick to recover from accidental blur.
    window.setTimeout(() => focusInput(), 0);
  }, [enabled, focusInput]);

  useEffect(() => {
    if (!enabled) return;
    reset();
    focusInput();
    return () => {
      reset();
    };
  }, [enabled, focusInput, reset]);

  useEffect(() => {
    if (!enabled) return;

    const onKeyDownCapture = (e: KeyboardEvent) => {
      handleScannerKeydown(
        e,
        { bufferRef, lastWasEnterRef },
        {
          finalize,
          onCancel,
          reset,
          scheduleFinalize,
          scheduleFinalizeAfterEnter,
        }
      );
    };

    window.addEventListener('keydown', onKeyDownCapture, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKeyDownCapture, { capture: true });
    };
  }, [enabled, finalize, onCancel, reset, scheduleFinalize, scheduleFinalizeAfterEnter]);

  return {
    inputRef,
    handleBlur,
    focusInput,
    reset,
  };
}
