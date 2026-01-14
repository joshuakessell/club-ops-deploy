import { useCallback, useEffect, useRef } from 'react';

type Options = {
  enabled: boolean;
  /**
   * Called exactly once per capture, with the accumulated scan string.
   * The hook automatically resets its internal buffer after calling.
   */
  onCapture: (raw: string) => void;
  /** Called when a scan capture sequence starts (first printable character captured). */
  onCaptureStart?: () => void;
  /** Called when a scan capture sequence ends (after emit or discard/cancel). */
  onCaptureEnd?: () => void;
  /** Called when Escape is pressed during an active capture sequence (optional). */
  onCancel?: () => void;
  /** Idle timeout used to terminate scans that don't send a suffix key. */
  idleTimeoutMs?: number;
  /** Ignore new scans for this duration after emitting (prevents double-capture). */
  cooldownMs?: number;
  /**
   * Grace period after an Enter key to decide whether it was a terminator (end-of-scan)
   * or a line break within a multi-line scan (PDF417). If another character arrives within
   * this window, we treat Enter as a newline. Otherwise we finalize the scan.
   */
  enterGraceMs?: number;
  /** Minimum trimmed length before emitting a capture. */
  minLength?: number;
  /**
   * If an editable element is focused, only begin capture if inter-key timing suggests
   * scanner-speed input (in ms).
   */
  scannerInterKeyMaxMs?: number;
};

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName?.toLowerCase?.() || '';
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (el.isContentEditable) return true;
  return false;
}

/**
 * Passive keyboard-wedge scanner capture for "scan anywhere" screens.
 *
 * Differences vs `useScannerInput`:
 * - No hidden focus trap (avoids intrusive keyboard behavior on tablets).
 * - Does NOT block normal typing in editable inputs unless an active scan capture has started.
 * - Uses a global keydown listener in capture phase.
 */
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
  scannerInterKeyMaxMs = 35,
}: Options) {
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
  }, [clearTimer]);

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

  const scheduleFinalize = useCallback(() => {
    clearTimer();
    timerRef.current = window.setTimeout(() => finalize(), idleTimeoutMs);
  }, [clearTimer, finalize, idleTimeoutMs]);

  const scheduleFinalizeAfterEnter = useCallback(() => {
    clearTimer();
    timerRef.current = window.setTimeout(
      () => {
        if (lastWasEnterRef.current) finalize();
      },
      Math.max(0, Math.min(idleTimeoutMs, enterGraceMs))
    );
  }, [clearTimer, enterGraceMs, finalize, idleTimeoutMs]);

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

    const onKeyDownCapture = (e: KeyboardEvent) => {
      const key = e.key;
      const editable = isEditableTarget(e.target);
      const now = Date.now();
      const lastKeyAt = lastKeyAtRef.current;
      const delta = lastKeyAt === null ? null : now - lastKeyAt;
      lastKeyAtRef.current = now;

      // If the user is typing in an editable element, do not intercept unless we already started
      // capturing a scan sequence OR the inter-key timing looks like scanner-speed.
      const looksLikeScannerSpeed =
        delta !== null && delta >= 0 && delta <= scannerInterKeyMaxMs;
      if (!capturingRef.current && editable && !looksLikeScannerSpeed) return;

      // If we're not currently capturing, ignore modifier shortcuts and non-printable keys.
      if (!capturingRef.current && (e.metaKey || e.ctrlKey || e.altKey)) {
        return;
      }

      // Cooldown: ignore new captures for a short window after a scan emits.
      if (!capturingRef.current && now < cooldownUntilRef.current) return;

      if (capturingRef.current) {
        // While capturing, prevent scan keystrokes from leaking into UI.
        e.stopPropagation();
      }

      if (key === 'Escape') {
        if (!capturingRef.current) return;
        e.preventDefault();
        reset();
        onCancel?.();
        return;
      }

      if (key === 'Tab') {
        if (!capturingRef.current) return;
        e.preventDefault();
        finalize();
        return;
      }

      if (key === 'Enter') {
        // Enter can be internal newline (PDF417) or a terminator suffix.
        if (!capturingRef.current) return;
        e.preventDefault();
        bufferRef.current += '\n';
        lastWasEnterRef.current = true;
        scheduleFinalizeAfterEnter();
        return;
      }

      if (key.length === 1) {
        // Start capture on first printable character (when not typing in an editable element).
        if (!capturingRef.current) {
          capturingRef.current = true;
          onCaptureStart?.();
        }
        e.preventDefault();
        lastWasEnterRef.current = false;
        bufferRef.current += key;
        scheduleFinalize();
        return;
      }

      // Ignore other keys (arrows, function keys, etc.)
      if (capturingRef.current) {
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', onKeyDownCapture, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDownCapture, { capture: true });
  }, [
    enabled,
    finalize,
    onCancel,
    onCaptureEnd,
    onCaptureStart,
    reset,
    scheduleFinalize,
    scheduleFinalizeAfterEnter,
  ]);

  return { reset };
}

