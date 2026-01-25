export type ScannerCapture = {
  /** Raw captured scan string (may include newlines). */
  raw: string;
};

export type ScannerInputOptions = {
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
