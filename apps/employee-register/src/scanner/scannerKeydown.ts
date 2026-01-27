import type { MutableRefObject } from 'react';

type ScannerKeydownRefs = {
  bufferRef: MutableRefObject<string>;
  lastWasEnterRef: MutableRefObject<boolean>;
};

type ScannerKeydownHandlers = {
  finalize: () => void;
  reset: () => void;
  scheduleFinalize: () => void;
  scheduleFinalizeAfterEnter: () => void;
  onCancel?: () => void;
};

export function handleScannerKeydown(
  e: KeyboardEvent,
  refs: ScannerKeydownRefs,
  handlers: ScannerKeydownHandlers
): void {
  const { bufferRef, lastWasEnterRef } = refs;
  const { finalize, onCancel, reset, scheduleFinalize, scheduleFinalizeAfterEnter } = handlers;

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
}
