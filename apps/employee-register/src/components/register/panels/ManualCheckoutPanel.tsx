import { useCallback, useEffect, useMemo, useState } from 'react';

type Step = 'select' | 'confirm';

type ManualCandidate = {
  occupancyId: string;
  resourceType: 'ROOM' | 'LOCKER';
  number: string;
  customerName: string;
  checkinAt: string | Date;
  scheduledCheckoutAt: string | Date;
  isOverdue: boolean;
};

type ResolveResponse = {
  occupancyId: string;
  resourceType: 'ROOM' | 'LOCKER';
  number: string;
  customerName: string;
  checkinAt: string | Date;
  scheduledCheckoutAt: string | Date;
  lateMinutes: number;
  fee: number;
  banApplied: boolean;
};

export interface ManualCheckoutPanelProps {
  sessionToken: string;
  onExit: () => void;
  onSuccess: (message: string) => void;
  prefill?: { occupancyId?: string; number?: string };
  entryMode?: 'default' | 'direct-confirm';
  title?: string;
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function formatClockTime(value: string | Date): string {
  const d = toDate(value);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatLateDuration(minutesLate: number): string {
  const total = Math.max(0, Math.floor(minutesLate));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

export function ManualCheckoutPanel({
  sessionToken,
  onExit,
  onSuccess,
  prefill,
  entryMode = 'default',
  title = 'Checkout',
}: ManualCheckoutPanelProps) {
  const [step, setStep] = useState<Step>('select');
  const [candidates, setCandidates] = useState<ManualCandidate[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);
  const [candidatesReloadNonce, setCandidatesReloadNonce] = useState(0);

  const [selectedOccupancyId, setSelectedOccupancyId] = useState<string | null>(null);
  const [typedNumber, setTypedNumber] = useState('');

  const [confirmData, setConfirmData] = useState<ResolveResponse | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showCancelWarning, setShowCancelWarning] = useState(false);
  const [autoContinue, setAutoContinue] = useState(false);

  const canContinue = useMemo(() => {
    if (selectedOccupancyId) return true;
    return typedNumber.trim().length > 0;
  }, [selectedOccupancyId, typedNumber]);

  // Reset per mount (and per prefill change)
  useEffect(() => {
    setStep('select');
    setCandidates([]);
    setCandidatesError(null);
    const initialOccupancyId = prefill?.occupancyId ?? null;
    const initialNumber = prefill?.number ?? '';
    setSelectedOccupancyId(initialOccupancyId);
    setTypedNumber(initialOccupancyId ? '' : initialNumber);
    setConfirmData(null);
    setIsSubmitting(false);
    setShowCancelWarning(false);
    setAutoContinue(entryMode === 'direct-confirm' && Boolean(initialOccupancyId || initialNumber));
  }, [entryMode, prefill?.number, prefill?.occupancyId]);

  // Load candidates (only in default mode)
  useEffect(() => {
    if (entryMode === 'direct-confirm') return;
    let mounted = true;
    void (async () => {
      setLoadingCandidates(true);
      setCandidatesError(null);
      try {
        const res = await fetch('/api/v1/checkout/manual-candidates', {
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (!res.ok) throw new Error('Failed to load candidates');
        const data = (await res.json()) as { candidates?: ManualCandidate[] };
        if (!mounted) return;
        setCandidates(Array.isArray(data.candidates) ? data.candidates : []);
      } catch (e) {
        if (!mounted) return;
        setCandidatesError(e instanceof Error ? e.message : 'Failed to load candidates');
        setCandidates([]);
      } finally {
        if (mounted) setLoadingCandidates(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [entryMode, sessionToken, candidatesReloadNonce]);

  const attemptExit = () => {
    // In direct-confirm entry mode, Back should just return to inventory.
    if (entryMode === 'direct-confirm') {
      onExit();
      return;
    }
    if (step === 'confirm') {
      setShowCancelWarning(true);
      return;
    }
    onExit();
  };

  const handleContinue = useCallback(async () => {
    if (!canContinue) return;
    setIsSubmitting(true);
    try {
      const payload = selectedOccupancyId ? { occupancyId: selectedOccupancyId } : { number: typedNumber.trim() };
      const res = await fetch('/api/v1/checkout/manual-resolve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to resolve checkout');
      const data = (await res.json()) as ResolveResponse;
      setConfirmData(data);
      setStep('confirm');
    } catch (e) {
      setCandidatesError(e instanceof Error ? e.message : 'Failed to resolve checkout');
    } finally {
      setIsSubmitting(false);
    }
  }, [canContinue, selectedOccupancyId, sessionToken, typedNumber]);

  const handleConfirm = useCallback(async () => {
    if (!confirmData) return;
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/v1/checkout/manual-complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ occupancyId: confirmData.occupancyId }),
      });
      if (!res.ok) throw new Error('Failed to complete checkout');
      const data = (await res.json()) as { alreadyCheckedOut?: boolean };
      onSuccess(data.alreadyCheckedOut ? 'Already checked out' : 'Checkout completed');

      // After completing from the home tab, return to the list (select step).
      // For inventory-initiated direct-confirm mode, AppRoot will handle returning to inventory.
      if (entryMode === 'default') {
        setConfirmData(null);
        setSelectedOccupancyId(null);
        setTypedNumber('');
        setShowCancelWarning(false);
        setStep('select');
        setCandidatesReloadNonce((n) => n + 1);
      }
    } catch (e) {
      setCandidatesError(e instanceof Error ? e.message : 'Failed to complete checkout');
    } finally {
      setIsSubmitting(false);
    }
  }, [confirmData, onSuccess, sessionToken]);

  // In direct-confirm entry mode, automatically resolve and land on confirm.
  useEffect(() => {
    if (entryMode !== 'direct-confirm') return;
    if (!autoContinue) return;
    if (step !== 'select') {
      setAutoContinue(false);
      return;
    }
    if (!canContinue) return;
    setAutoContinue(false);
    void handleContinue();
  }, [autoContinue, canContinue, entryMode, handleContinue, step]);

  return (
    <div className="cs-liquid-card" style={{ padding: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
        <div style={{ fontWeight: 900, fontSize: '1.1rem' }}>{title}</div>
        <button
          type="button"
          className="cs-liquid-button cs-liquid-button--secondary"
          onClick={attemptExit}
          disabled={isSubmitting}
        >
          Back
        </button>
      </div>

      {candidatesError && (
        <div
          style={{
            marginTop: '0.75rem',
            padding: '0.75rem',
            background: 'rgba(239, 68, 68, 0.18)',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            borderRadius: 12,
            color: '#fecaca',
            fontWeight: 700,
          }}
        >
          {candidatesError}
        </div>
      )}

      {showCancelWarning && (
        <div className="er-surface" style={{ marginTop: '0.75rem', padding: '0.75rem', borderRadius: 12 }}>
          <div style={{ fontWeight: 900, marginBottom: '0.5rem' }}>Cancel checkout?</div>
          <div className="er-text-sm" style={{ color: '#94a3b8', marginBottom: '0.75rem' }}>
            You are on the confirm step. Canceling will discard the current checkout confirmation.
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="cs-liquid-button cs-liquid-button--secondary"
              onClick={() => setShowCancelWarning(false)}
            >
              Return to confirm checkout
            </button>
            <button
              type="button"
              className="cs-liquid-button cs-liquid-button--danger"
              onClick={() => {
                setShowCancelWarning(false);
                onExit();
              }}
            >
              Cancel checkout
            </button>
          </div>
        </div>
      )}

      <div style={{ marginTop: '0.75rem' }}>
        {step === 'select' ? (
          <>
            {entryMode === 'direct-confirm' ? (
              <div style={{ padding: '0.75rem', color: '#94a3b8' }}>Loading checkout…</div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <div className="cs-liquid-search" style={{ flex: 1, minWidth: 280 }}>
                    <input
                      className="cs-liquid-input cs-liquid-search__input"
                      placeholder="Enter room/locker number…"
                      value={typedNumber}
                      onChange={(e) => {
                        setTypedNumber(e.target.value);
                        setSelectedOccupancyId(null);
                      }}
                      disabled={isSubmitting}
                    />
                    <div className="cs-liquid-search__icon" aria-hidden="true">
                      🔎
                    </div>
                  </div>
                  <button
                    type="button"
                    className="cs-liquid-button"
                    onClick={() => void handleContinue()}
                    disabled={!canContinue || isSubmitting}
                  >
                    Continue
                  </button>
                </div>

                <div style={{ marginTop: '0.75rem' }}>
                  <div className="er-text-sm" style={{ color: '#94a3b8', fontWeight: 900, marginBottom: '0.5rem' }}>
                    Or select from occupied units
                  </div>
                  {loadingCandidates ? (
                    <div style={{ padding: '0.75rem', color: '#94a3b8' }}>Loading…</div>
                  ) : candidates.length === 0 ? (
                    <div style={{ padding: '0.75rem', color: '#94a3b8' }}>No occupied rooms/lockers</div>
                  ) : (
                    <div style={{ display: 'grid', gap: '0.5rem' }}>
                      {candidates.map((c) => {
                        const selected = selectedOccupancyId === c.occupancyId;
                        const label = `${c.resourceType === 'ROOM' ? 'Room' : 'Locker'} ${c.number}`;
                        return (
                          <button
                            key={c.occupancyId}
                            type="button"
                            className={[
                              'cs-liquid-button',
                              selected ? 'cs-liquid-button--selected' : 'cs-liquid-button--secondary',
                            ].join(' ')}
                            aria-pressed={selected}
                            onClick={() => {
                              setSelectedOccupancyId(c.occupancyId);
                              setTypedNumber('');
                            }}
                            style={{ justifyContent: 'space-between', padding: '0.75rem' }}
                          >
                            <span style={{ fontWeight: 900 }}>
                              {label} {c.isOverdue ? '⚠️' : ''}
                            </span>
                            <span className="er-text-sm" style={{ color: '#94a3b8', fontWeight: 800 }}>
                              {c.customerName}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        ) : (
          <>
            {!confirmData ? (
              <div style={{ padding: '0.75rem', color: '#94a3b8' }}>Loading…</div>
            ) : (
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                <div style={{ textAlign: 'center', fontSize: '1.5rem', fontWeight: 900 }}>
                  {confirmData.customerName || '—'}
                </div>

                <div className="er-surface" style={{ padding: '0.75rem', borderRadius: 12 }}>
                  <div className="er-text-sm" style={{ color: '#94a3b8', marginBottom: '0.25rem' }}>
                    Checkout
                  </div>
                  <div style={{ fontWeight: 900 }}>
                    {confirmData.resourceType === 'ROOM' ? 'Room' : 'Locker'} {confirmData.number}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.75rem' }}>
                  <div className="er-surface" style={{ padding: '0.75rem', borderRadius: 12 }}>
                    <div className="er-text-sm" style={{ color: '#94a3b8', marginBottom: '0.25rem' }}>
                      Check-in
                    </div>
                    <div style={{ fontWeight: 900 }}>{formatClockTime(confirmData.checkinAt)}</div>
                  </div>
                  <div className="er-surface" style={{ padding: '0.75rem', borderRadius: 12 }}>
                    <div className="er-text-sm" style={{ color: '#94a3b8', marginBottom: '0.25rem' }}>
                      Scheduled checkout
                    </div>
                    <div style={{ fontWeight: 900 }}>{formatClockTime(confirmData.scheduledCheckoutAt)}</div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.75rem' }}>
                  <div className="er-surface" style={{ padding: '0.75rem', borderRadius: 12 }}>
                    <div className="er-text-sm" style={{ color: '#94a3b8', marginBottom: '0.25rem' }}>
                      Late
                    </div>
                    <div style={{ fontWeight: 900 }}>
                      {confirmData.lateMinutes > 0 ? formatLateDuration(confirmData.lateMinutes) : '—'}
                    </div>
                  </div>
                  <div className="er-surface" style={{ padding: '0.75rem', borderRadius: 12 }}>
                    <div className="er-text-sm" style={{ color: '#94a3b8', marginBottom: '0.25rem' }}>
                      Fee
                    </div>
                    <div style={{ fontWeight: 900 }}>${confirmData.fee.toFixed(2)}</div>
                  </div>
                </div>

                {confirmData.banApplied && (
                  <div className="er-surface" style={{ padding: '0.75rem', borderRadius: 12 }}>
                    <div style={{ fontWeight: 900, color: '#f59e0b' }}>⚠️ Ban applied</div>
                    <div className="er-text-sm" style={{ color: '#94a3b8' }}>
                      The account is now blocked from check-in until cleared.
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="cs-liquid-button cs-liquid-button--secondary"
                    onClick={() => {
                      // In direct-confirm mode, cancel just exits (no warning).
                      if (entryMode === 'direct-confirm') {
                        onExit();
                        return;
                      }
                      setStep('select');
                      setShowCancelWarning(false);
                    }}
                    disabled={isSubmitting}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    className="cs-liquid-button"
                    onClick={() => void handleConfirm()}
                    disabled={isSubmitting}
                  >
                    Complete checkout
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

