export type PassiveScannerInputOptions = {
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
   * Allow scan capture to start while an editable element is focused.
   * Default false so text inputs can receive scanner output without interference.
   */
  captureWhenEditable?: boolean;
  /**
   * Treat Enter as a terminator when true; when false, Enter is always treated as a newline.
   */
  enterTerminates?: boolean;
  /**
   * Treat Tab as a terminator when true; when false, Tab is preserved as a newline.
   */
  tabTerminates?: boolean;
  /**
   * Compute a dynamic idle timeout based on the current buffer.
   * If provided, overrides idleTimeoutMs for scheduling finalize.
   */
  getIdleTimeoutMs?: (buffer: string) => number;
  /**
   * If an editable element is focused, only begin capture if inter-key timing suggests
   * scanner-speed input (in ms). Only applies when captureWhenEditable is true.
   */
  scannerInterKeyMaxMs?: number;
};
