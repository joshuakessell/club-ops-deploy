import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useScannerInput } from './useScannerInput';

export type ScanModeResult =
  | { outcome: 'matched' }
  | { outcome: 'no_match'; message: string; canCreate?: boolean }
  | { outcome: 'error'; message: string };

type Props = {
  isOpen: boolean;
  onCancel: () => void;
  onBarcodeCaptured: (rawScanText: string) => Promise<ScanModeResult> | ScanModeResult;
  onCreateFromNoMatch?: () => Promise<ScanModeResult> | ScanModeResult;
};

function useBeep() {
  const ctxRef = useRef<AudioContext | null>(null);

  const prime = useCallback(() => {
    if (ctxRef.current) return;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    try {
      ctxRef.current = new AudioCtx();
    } catch {
      ctxRef.current = null;
    }
  }, []);

  const beep = useCallback(() => {
    if (!ctxRef.current) {
      prime();
    }
    const ctx = ctxRef.current;
    if (!ctx) return;
    try {
      // iOS Safari may start suspended until user gesture; best-effort resume.
      void ctx.resume?.();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.value = 0.06;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    } catch {
      // ignore
    }
  }, [prime]);

  return { prime, beep };
}

export function ScanMode({ isOpen, onCancel, onBarcodeCaptured, onCreateFromNoMatch }: Props) {
  const [status, setStatus] = useState<'scanning' | 'processing' | 'no_match' | 'error'>(
    'scanning'
  );
  const [message, setMessage] = useState<string | null>(null);
  const [canCreate, setCanCreate] = useState(false);
  const { prime, beep } = useBeep();

  const resetUi = useCallback(() => {
    setStatus('scanning');
    setMessage(null);
    setCanCreate(false);
  }, []);

  const handleCancel = useCallback(() => {
    resetUi();
    onCancel();
  }, [onCancel, resetUi]);

  const handleCapture = useCallback(
    async (rawScanText: string) => {
      const raw = rawScanText;
      if (!raw.trim()) return;
      beep();
      setStatus('processing');
      setMessage(null);
      try {
        const result = await onBarcodeCaptured(raw);
        if (result.outcome === 'matched') {
          resetUi();
          onCancel();
          return;
        }
        if (result.outcome === 'no_match') {
          setStatus('no_match');
          setMessage(result.message);
          setCanCreate(Boolean(result.canCreate));
          return;
        }
        setStatus('error');
        setMessage(result.message);
      } catch (err) {
        setStatus('error');
        setMessage(err instanceof Error ? err.message : 'Failed to process scan');
      }
    },
    [beep, onBarcodeCaptured, onCancel, resetUi]
  );

  const { inputRef, handleBlur, reset, focusInput } = useScannerInput({
    enabled: isOpen && status === 'scanning',
    onCapture: ({ raw }) => void handleCapture(raw),
    onCancel: handleCancel,
    idleTimeoutMs: 75,
  });

  // Prime audio context on user gesture (tap inside modal) so beeps work on iOS.
  useEffect(() => {
    if (!isOpen) return;
    prime();
  }, [isOpen, prime]);

  useEffect(() => {
    if (!isOpen) return;
    // Ensure focus even if modal is opened without any prior input focus.
    focusInput();
  }, [focusInput, isOpen]);

  // Derived UI hints (optional).
  const hint = useMemo(() => {
    if (status === 'scanning') return 'Scanning…';
    if (status === 'processing') return 'Processing…';
    if (status === 'no_match') return 'No match';
    return 'Error';
  }, [status]);

  if (!isOpen) return null;

  const showRetry = status === 'no_match' || status === 'error';
  const showOverlayProcessing = status === 'processing';

  return (
    <div className="scan-mode-overlay" role="dialog" aria-modal="true" aria-label="Scan Mode">
      <div className="scan-mode-topbar">
        <button className="scan-mode-cancel cs-liquid-button cs-liquid-button--danger" onClick={handleCancel}>
          Cancel
        </button>
        <div className="scan-mode-title">Scan Mode</div>
        <button
          className="scan-mode-exit cs-liquid-button cs-liquid-button--secondary"
          onClick={handleCancel}
          aria-label="Exit scan mode"
        >
          Exit
        </button>
      </div>

      <div className="scan-mode-body">
        <div className="scan-mode-reticle" aria-hidden="true">
          <div className="scan-mode-reticle-inner" />
        </div>

        <div className="scan-mode-status">
          <div className="scan-mode-status-text">{hint}</div>
          {status === 'no_match' ? (
            <div className="scan-mode-message">
              No match found. Would you like to create a new account?
            </div>
          ) : (
            message && <div className="scan-mode-message">{message}</div>
          )}
          {status === 'scanning' && (
            <div className="scan-mode-subhint">Aim the scanner and scan the barcode.</div>
          )}
        </div>

        {showRetry && (
          <div className="scan-mode-actions">
            {status === 'error' && (
              <button
                className="scan-mode-primary cs-liquid-button"
                onClick={() => {
                  reset();
                  resetUi();
                  focusInput();
                }}
              >
                Try Again
              </button>
            )}

            {status === 'no_match' && (
              <>
                <button className="scan-mode-primary cs-liquid-button cs-liquid-button--danger" onClick={handleCancel}>
                  Cancel
                </button>
                {canCreate && onCreateFromNoMatch && (
                  <button
                    className="scan-mode-primary cs-liquid-button"
                    style={{ marginLeft: '0.75rem' }}
                    onClick={() =>
                      void (async () => {
                        setStatus('processing');
                        setMessage(null);
                        try {
                          const r = await onCreateFromNoMatch();
                          if (r.outcome === 'matched') {
                            resetUi();
                            onCancel();
                            return;
                          }
                          if (r.outcome === 'no_match') {
                            setStatus('no_match');
                            setMessage(r.message);
                            setCanCreate(Boolean(r.canCreate));
                            return;
                          }
                          setStatus('error');
                          setMessage(r.message);
                        } catch (err) {
                          setStatus('error');
                          setMessage(
                            err instanceof Error ? err.message : 'Failed to create customer'
                          );
                        }
                      })()
                    }
                  >
                    Yes / Create
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {showOverlayProcessing && (
        <div className="scan-mode-processing-overlay" aria-hidden="true">
          <div className="scan-mode-processing-card cs-liquid-card">Processing…</div>
        </div>
      )}

      {/* Hidden focus trap for keyboard-wedge scanner input */}
      <textarea
        ref={inputRef}
        className="scan-mode-hidden-input"
        aria-hidden="true"
        tabIndex={-1}
        inputMode="none"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        onBlur={handleBlur}
      />
    </div>
  );
}
