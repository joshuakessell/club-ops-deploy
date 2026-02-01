import { useCallback, useEffect, useRef } from 'react';
import type { FormEventHandler, KeyboardEvent } from 'react';

type ScanCaptureOptions = {
  enabled: boolean;
  onCapture: (raw: string) => void;
  onCaptureStart?: () => void;
  onCaptureEnd?: () => void;
  onCancel?: () => void;
  idleTimeoutMs?: number;
  getIdleTimeoutMs?: (value: string) => number;
  keepFocus?: boolean;
};

type ScanCaptureHandlers = {
  onBlur: () => void;
  onInput: FormEventHandler<HTMLTextAreaElement>;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
};

export function useScanCaptureInput({
  enabled,
  onCapture,
  onCaptureStart,
  onCaptureEnd,
  onCancel,
  idleTimeoutMs = 220,
  getIdleTimeoutMs,
  keepFocus = true,
}: ScanCaptureOptions) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const capturingRef = useRef(false);
  const refocusQueuedRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const resetValue = useCallback(() => {
    const el = inputRef.current;
    if (el) el.value = '';
  }, []);

  const stopCapture = useCallback(() => {
    if (capturingRef.current) {
      capturingRef.current = false;
      onCaptureEnd?.();
    }
    clearTimer();
  }, [clearTimer, onCaptureEnd]);

  const focusInput = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    try {
      el.focus({ preventScroll: true });
    } catch {
      el.focus();
    }
  }, []);

  const queueRefocus = useCallback(() => {
    if (refocusQueuedRef.current) return;
    refocusQueuedRef.current = true;
    window.requestAnimationFrame(() => {
      refocusQueuedRef.current = false;
      focusInput();
    });
  }, [focusInput]);

  const finalize = useCallback(() => {
    const raw = inputRef.current?.value ?? '';
    stopCapture();
    resetValue();
    if (!raw.trim()) return;
    onCapture(raw);
  }, [onCapture, resetValue, stopCapture]);

  const scheduleFinalize = useCallback(() => {
    clearTimer();
    const value = inputRef.current?.value ?? '';
    const timeout = getIdleTimeoutMs ? getIdleTimeoutMs(value) : idleTimeoutMs;
    timerRef.current = window.setTimeout(() => {
      finalize();
    }, timeout);
  }, [clearTimer, finalize, getIdleTimeoutMs, idleTimeoutMs]);

  const handleInput = useCallback(() => {
    if (!enabled) return;
    if (!capturingRef.current) {
      capturingRef.current = true;
      onCaptureStart?.();
    }
    scheduleFinalize();
  }, [enabled, onCaptureStart, scheduleFinalize]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!enabled) return;
      event.stopPropagation();
      if (event.key === 'Tab') {
        event.preventDefault();
        finalize();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        stopCapture();
        resetValue();
        onCancel?.();
      }
    },
    [enabled, finalize, onCancel, resetValue, stopCapture]
  );

  const handleBlur = useCallback(() => {
    if (!enabled) return;
    window.setTimeout(() => focusInput(), 0);
  }, [enabled, focusInput]);

  const setInputRef = useCallback(
    (node: HTMLTextAreaElement | null) => {
      inputRef.current = node;
      if (node && enabled) {
        focusInput();
      }
    },
    [enabled, focusInput]
  );

  useEffect(() => {
    if (!enabled) {
      stopCapture();
      resetValue();
      return;
    }
    resetValue();
    focusInput();
    return () => {
      stopCapture();
      resetValue();
    };
  }, [enabled, focusInput, resetValue, stopCapture]);

  useEffect(() => {
    if (!enabled || !keepFocus) return;
    const onFocusIn = (event: FocusEvent) => {
      const el = inputRef.current;
      if (!el) return;
      if (event.target === el || el.contains(event.target as Node)) return;
      queueRefocus();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') queueRefocus();
    };
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, keepFocus, queueRefocus]);

  const handlers: ScanCaptureHandlers = {
    onBlur: handleBlur,
    onInput: handleInput,
    onKeyDown: handleKeyDown,
  };

  return {
    scanInputRef: setInputRef,
    scanInputHandlers: handlers,
    reset: () => {
      stopCapture();
      resetValue();
    },
    focusInput,
  };
}
