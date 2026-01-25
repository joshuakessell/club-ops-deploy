import type { MutableRefObject } from 'react';

type PassiveScannerStateRefs = {
  capturingRef: MutableRefObject<boolean>;
  bufferRef: MutableRefObject<string>;
  lastWasEnterRef: MutableRefObject<boolean>;
  lastKeyAtRef: MutableRefObject<number | null>;
  cooldownUntilRef: MutableRefObject<number>;
};

type PassiveScannerKeydownOptions = {
  captureWhenEditable: boolean;
  enterTerminates: boolean;
  tabTerminates: boolean;
  scannerInterKeyMaxMs: number;
};

type PassiveScannerKeydownHandlers = {
  onCaptureStart?: () => void;
  onCancel?: () => void;
  reset: () => void;
  scheduleFinalize: () => void;
  scheduleFinalizeAfterEnter: () => void;
};

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName?.toLowerCase?.() || '';
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (el.isContentEditable) return true;
  return false;
}

export function handlePassiveScannerKeydown(
  e: KeyboardEvent,
  refs: PassiveScannerStateRefs,
  options: PassiveScannerKeydownOptions,
  handlers: PassiveScannerKeydownHandlers
): void {
  const {
    capturingRef,
    bufferRef,
    lastWasEnterRef,
    lastKeyAtRef,
    cooldownUntilRef,
  } = refs;
  const { captureWhenEditable, enterTerminates, tabTerminates, scannerInterKeyMaxMs } = options;
  const { onCaptureStart, onCancel, reset, scheduleFinalize, scheduleFinalizeAfterEnter } = handlers;

  const key = e.key;
  const editable = isEditableTarget(e.target);
  const now = Date.now();
  const lastKeyAt = lastKeyAtRef.current;
  const delta = lastKeyAt === null ? null : now - lastKeyAt;
  lastKeyAtRef.current = now;

  if (!capturingRef.current && editable && !captureWhenEditable) {
    return;
  }

  // If the user is typing in an editable element, do not intercept unless we already started
  // capturing a scan sequence OR the inter-key timing looks like scanner-speed.
  const looksLikeScannerSpeed = delta !== null && delta >= 0 && delta <= scannerInterKeyMaxMs;
  if (!capturingRef.current && editable && captureWhenEditable && !looksLikeScannerSpeed) {
    return;
  }

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
    if (tabTerminates) {
      bufferRef.current += '\n';
      lastWasEnterRef.current = true;
      scheduleFinalizeAfterEnter();
    } else {
      bufferRef.current += '\n';
      lastWasEnterRef.current = false;
      scheduleFinalize();
    }
    return;
  }

  if (key === 'Enter') {
    // Enter can be internal newline (PDF417) or a terminator suffix.
    if (!capturingRef.current) return;
    e.preventDefault();
    bufferRef.current += '\n';
    lastWasEnterRef.current = true;
    if (enterTerminates) {
      scheduleFinalizeAfterEnter();
    } else {
      scheduleFinalize();
    }
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
}
