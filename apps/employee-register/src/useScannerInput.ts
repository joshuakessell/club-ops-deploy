import { useCallback, useEffect, useRef } from 'react';

export type ScannerCapture = {
  /** Raw captured scan string (may include newlines). */
  raw: string;
};

type Options = {
  enabled: boolean;
  /**
   * Called exactly once per capture, with the accumulated scan string.
   * The hook automatically resets its internal buffer after calling.
   */
  onCapture: (capture: ScannerCapture) => void;
  /** Called when Escape is pressed (optional). */
  onCancel?: () => void;
  /** Idle timeout used to terminate scans that don't send a suffix key. */
  idleTimeoutMs?: number;
  /**
   * Grace period after an Enter key to decide whether it was a terminator (end-of-scan)
   * or a line break within a multi-line scan (PDF417). If another character arrives within
   * this window, we treat Enter as a newline. Otherwise we finalize the scan.
   */
  enterGraceMs?: number;
};

/**
 * Robust keyboard-wedge scanner capture.
 *
 * Key points:
 * - Uses a hidden textarea that auto-focuses, and re-focuses on blur.
 * - Accumulates printable characters quickly.
 * - Treats Enter as a newline (preserves PDF417 multi-line output) and relies on idle timeout to finalize.
 * - Treats Tab as an immediate terminator (common suffix).
 * - Uses a global keydown listener in capture phase to prevent scan keystrokes from leaking into other UI.
 */
export function useScannerInput({
  enabled,
  onCapture,
  onCancel,
  idleTimeoutMs = 75,
  enterGraceMs = 35,
}: Options) {
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
    timerRef.current = window.setTimeout(() => {
      // If no additional content arrived after Enter, treat it as terminator.
      if (lastWasEnterRef.current) {
        finalize();
      }
    }, Math.max(0, Math.min(idleTimeoutMs, enterGraceMs)));
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
      // While scan mode is active, prevent keystrokes from affecting any other UI.
      // We still intentionally handle a minimal set of keys for capture/cancel.
      const key = e.key;

      // Always stop propagation while enabled.
      e.stopPropagation();

      // Ignore meta-modified shortcuts (but still prevent them).
      if (e.metaKey || e.ctrlKey || e.altKey) {
        e.preventDefault();
        return;
      }

      if (key === 'Escape') {
        e.preventDefault();
        reset();
        onCancel?.();
        return;
      }

      if (key === 'Tab') {
        e.preventDefault();
        // Common scanner suffix; finalize immediately without including a tab char.
        finalize();
        return;
      }

      if (key === 'Enter') {
        e.preventDefault();
        // Enter can be an internal newline (PDF417) or an end-of-scan terminator (common suffix).
        // We append newline and give a short grace window; if more chars arrive, it's multi-line.
        bufferRef.current += '\n';
        lastWasEnterRef.current = true;
        scheduleFinalizeAfterEnter();
        return;
      }

      // Printable characters (scanner output) - accept as-is.
      if (key.length === 1) {
        e.preventDefault();
        // If we previously saw Enter, this means it was an internal newline; keep scanning.
        lastWasEnterRef.current = false;
        bufferRef.current += key;
        scheduleFinalize();
        return;
      }

      // Ignore other keys (arrows, function keys, etc.) but prevent them from bubbling.
      e.preventDefault();
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


