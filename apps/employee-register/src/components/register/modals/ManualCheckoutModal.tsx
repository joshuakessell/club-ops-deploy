import { useCallback, useEffect, useMemo, useState } from 'react';
import { ModalFrame } from './ModalFrame';

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

export interface ManualCheckoutModalProps {
  isOpen: boolean;
  sessionToken: string;
  onClose: () => void;
  onSuccess: (message: string) => void;
  prefill?: { occupancyId?: string; number?: string };
  entryMode?: 'default' | 'direct-confirm';
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

function formatDeltaMinutesLabel(scheduledCheckoutAt: string | Date): { label: string; color: string } {
  const scheduled = toDate(scheduledCheckoutAt);
  const diffMs = scheduled.getTime() - Date.now();
  const mins = Math.max(0, Math.ceil(Math.abs(diffMs) / 60000));
  const hmm = formatLateDuration(mins);
  if (diffMs < 0) return { label: `Past ${hmm}`, color: '#ef4444' };
  return { label: `In ${hmm}`, color: '#fbbf24' };
}

export function ManualCheckoutModal({
  isOpen,
  sessionToken,
  onClose,
  onSuccess,
  prefill,
  entryMode = 'default',
}: ManualCheckoutModalProps) {
  const [step, setStep] = useState<Step>('select');
  const [candidates, setCandidates] = useState<ManualCandidate[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);

  const [selectedOccupancyIds, setSelectedOccupancyIds] = useState<string[]>([]);
  const [typedNumber, setTypedNumber] = useState('');

  const [confirmQueue, setConfirmQueue] = useState<ResolveResponse[]>([]);
  const [confirmIndex, setConfirmIndex] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showCancelWarning, setShowCancelWarning] = useState(false);
  const [autoContinue, setAutoContinue] = useState(false);

  const canContinue = useMemo(() => {
    if (selectedOccupancyIds.length > 0) return true;
    return typedNumber.trim().length > 0;
  }, [selectedOccupancyIds.length, typedNumber]);

  const confirmCurrent = confirmQueue[confirmIndex] ?? null;

  useEffect(() => {
    if (!isOpen) return;
    // Reset per open
    setStep('select');
    setCandidates([]);
    setCandidatesError(null);
    const initialOccupancyId = prefill?.occupancyId ?? null;
    const initialNumber = prefill?.number ?? '';
    setSelectedOccupancyIds(initialOccupancyId ? [initialOccupancyId] : []);
    setTypedNumber(initialOccupancyId ? '' : initialNumber);
    setConfirmQueue([]);
    setConfirmIndex(0);
    setIsSubmitting(false);
    setShowCancelWarning(false);
    setAutoContinue(entryMode === 'direct-confirm' && Boolean(initialOccupancyId || initialNumber));
  }, [entryMode, isOpen, prefill?.number, prefill?.occupancyId]);

  useEffect(() => {
    if (!isOpen) return;
    void (async () => {
      setLoadingCandidates(true);
      setCandidatesError(null);
      try {
        const res = await fetch('/api/v1/checkout/manual-candidates', {
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (!res.ok) throw new Error('Failed to load candidates');
        const data = (await res.json()) as { candidates?: ManualCandidate[] };
        setCandidates(Array.isArray(data.candidates) ? data.candidates : []);
      } catch (e) {
        setCandidatesError(e instanceof Error ? e.message : 'Failed to load candidates');
        setCandidates([]);
      } finally {
        setLoadingCandidates(false);
      }
    })();
  }, [isOpen, sessionToken]);

  const attemptClose = () => {
    // In direct-confirm entry mode, Back/X should just return to inventory (no warning).
    if (entryMode === 'direct-confirm') {
      onClose();
      return;
    }
    if (step === 'confirm') {
      setShowCancelWarning(true);
      return;
    }
    onClose();
  };

  const handleContinue = useCallback(async () => {
    if (!canContinue) return;
    setIsSubmitting(true);
    try {
      const resolveOne = async (payload: { occupancyId?: string; number?: string }) => {
        const res = await fetch('/api/v1/checkout/manual-resolve', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Failed to resolve checkout');
        return (await res.json()) as ResolveResponse;
      };

      const queue: ResolveResponse[] = [];
      if (selectedOccupancyIds.length > 0) {
        for (const occupancyId of selectedOccupancyIds) {
          queue.push(await resolveOne({ occupancyId }));
        }
      } else {
        queue.push(await resolveOne({ number: typedNumber.trim() }));
      }

      setConfirmQueue(queue);
      setConfirmIndex(0);
      setStep('confirm');
    } catch (e) {
      setCandidatesError(e instanceof Error ? e.message : 'Failed to resolve checkout');
    } finally {
      setIsSubmitting(false);
    }
  }, [canContinue, selectedOccupancyIds, sessionToken, typedNumber]);

  const handleConfirm = useCallback(async () => {
    const current = confirmQueue[confirmIndex];
    if (!current) return;
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/v1/checkout/manual-complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ occupancyId: current.occupancyId }),
      });
      if (!res.ok) throw new Error('Failed to complete checkout');
      const data = (await res.json()) as { alreadyCheckedOut?: boolean };
      const total = confirmQueue.length || 1;
      const nextIndex = confirmIndex + 1;
      if (nextIndex < total) {
        setConfirmIndex(nextIndex);
        return;
      }
      onClose();
      onSuccess(data.alreadyCheckedOut ? 'Already checked out' : total > 1 ? `Checkout completed (${total})` : 'Checkout completed');
    } catch (e) {
      setCandidatesError(e instanceof Error ? e.message : 'Failed to complete checkout');
    } finally {
      setIsSubmitting(false);
    }
  }, [confirmIndex, confirmQueue, onClose, onSuccess, sessionToken]);

  // If this modal is opened as a "direct confirm" action (e.g. from Inventory occupancy details),
  // automatically resolve and land on the confirm step.
  useEffect(() => {
    if (!isOpen) return;
    if (entryMode !== 'direct-confirm') return;
    if (!autoContinue) return;
    if (step !== 'select') {
      setAutoContinue(false);
      return;
    }
    if (!canContinue) return;
    setAutoContinue(false);
    void handleContinue();
  }, [autoContinue, canContinue, entryMode, handleContinue, isOpen, step]);

  return (
    <>
      <ModalFrame isOpen={isOpen} title="Checkout" onClose={attemptClose} maxWidth="760px" maxHeight="80vh">
        {candidatesError && (
          <div
            style={{
              marginBottom: '0.75rem',
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
                      placeholder="Type room/locker number…"
                      value={typedNumber}
                      onFocus={() => setSelectedOccupancyIds([])}
                      onChange={(e) => {
                        setSelectedOccupancyIds([]);
                        setTypedNumber(e.target.value);
                      }}
                      aria-label="Checkout number"
                    />
                    <div className="cs-liquid-search__icon">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path
                          d="M7.33333 12.6667C10.2789 12.6667 12.6667 10.2789 12.6667 7.33333C12.6667 4.38781 10.2789 2 7.33333 2C4.38781 2 2 4.38781 2 7.33333C2 10.2789 4.38781 12.6667 7.33333 12.6667Z"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M14 14L11.1 11.1"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="cs-liquid-button"
                    onClick={() => void handleContinue()}
                    disabled={!canContinue || isSubmitting}
                  >
                    {isSubmitting ? 'Loading…' : 'Continue'}
                  </button>
                </div>

                <div style={{ marginTop: '1rem' }}>
                  <div style={{ fontWeight: 800, marginBottom: '0.5rem' }}>Suggested</div>
                  {loadingCandidates ? (
                    <div style={{ padding: '0.75rem', color: '#94a3b8' }}>Loading candidates…</div>
                  ) : candidates.length === 0 ? (
                    <div style={{ padding: '0.75rem', color: '#94a3b8' }}>No candidates</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {candidates.map((c) => {
                        const selected = selectedOccupancyIds.includes(c.occupancyId);
                        const scheduled = toDate(c.scheduledCheckoutAt);
                        const delta = formatDeltaMinutesLabel(scheduled);
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
                              setTypedNumber('');
                              setSelectedOccupancyIds((prev) => {
                                if (prev.includes(c.occupancyId)) return prev.filter((id) => id !== c.occupancyId);
                                return [...prev, c.occupancyId];
                              });
                            }}
                            style={{
                              justifyContent: 'space-between',
                              padding: '0.75rem',
                              borderColor: c.isOverdue ? 'rgba(239, 68, 68, 0.65)' : undefined,
                              background: selected
                                ? undefined
                                : c.isOverdue
                                  ? 'rgba(239, 68, 68, 0.08)'
                                  : undefined,
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                width: '100%',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: '1rem',
                              }}
                            >
                              <div style={{ fontWeight: 900, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {c.resourceType === 'ROOM' ? 'Room' : 'Locker'} {c.number} - {c.customerName} - {formatClockTime(scheduled)}
                              </div>
                              <div style={{ fontWeight: 900, whiteSpace: 'nowrap', color: delta.color }}>
                                {delta.label}
                              </div>
                            </div>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'baseline' }}>
                <div style={{ fontWeight: 900, fontSize: '1.15rem' }}>Confirm checkout</div>
                <div className="er-text-sm" style={{ color: '#94a3b8', fontWeight: 900 }}>
                  {confirmIndex + 1} of {confirmQueue.length || 1}
                </div>
              </div>
              {confirmCurrent && (
                <div className="er-surface" style={{ padding: '1rem', borderRadius: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    <div>
                      <div style={{ color: '#94a3b8', fontSize: '0.875rem' }}>Customer</div>
                      <div style={{ fontWeight: 800 }}>{confirmCurrent.customerName}</div>
                    </div>
                    <div>
                      <div style={{ color: '#94a3b8', fontSize: '0.875rem' }}>Resource</div>
                      <div style={{ fontWeight: 800 }}>
                        {confirmCurrent.resourceType === 'ROOM' ? 'Room' : 'Locker'} {confirmCurrent.number}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: '#94a3b8', fontSize: '0.875rem' }}>Check-in</div>
                      <div style={{ fontWeight: 800 }}>{toDate(confirmCurrent.checkinAt).toLocaleString()}</div>
                    </div>
                    <div>
                      <div style={{ color: '#94a3b8', fontSize: '0.875rem' }}>Scheduled checkout</div>
                      <div style={{ fontWeight: 800 }}>
                        {toDate(confirmCurrent.scheduledCheckoutAt).toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: '#94a3b8', fontSize: '0.875rem' }}>Late</div>
                      <div style={{ fontWeight: 800 }}>{confirmCurrent.lateMinutes} min</div>
                    </div>
                    <div>
                      <div style={{ color: '#94a3b8', fontSize: '0.875rem' }}>Outcome</div>
                      <div style={{ fontWeight: 900, color: confirmCurrent.banApplied ? '#f59e0b' : '#10b981' }}>
                        Fee ${confirmCurrent.fee.toFixed(2)}
                        {confirmCurrent.banApplied ? ' • 30-day ban' : ''}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.25rem' }}>
                <div />
                <button
                  type="button"
                  className="cs-liquid-button"
                  onClick={() => void handleConfirm()}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Confirming…' : 'Confirm'}
                </button>
              </div>
            </div>
          </>
        )}
      </ModalFrame>

      <ModalFrame
        isOpen={isOpen && showCancelWarning}
        title="Cancel checkout"
        onClose={() => setShowCancelWarning(false)}
        maxWidth="520px"
        closeOnOverlayClick={false}
      >
        <div style={{ marginBottom: '1rem', color: '#94a3b8' }}>
          You’re on the confirmation step. Do you want to cancel checkout?
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
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
              onClose();
            }}
          >
            Cancel checkout
          </button>
        </div>
      </ModalFrame>
    </>
  );
}


