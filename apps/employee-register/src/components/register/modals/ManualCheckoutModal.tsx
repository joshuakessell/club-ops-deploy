import { useEffect, useMemo, useState } from 'react';
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
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

export function ManualCheckoutModal({ isOpen, sessionToken, onClose, onSuccess }: ManualCheckoutModalProps) {
  const [step, setStep] = useState<Step>('select');
  const [candidates, setCandidates] = useState<ManualCandidate[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);

  const [selectedOccupancyId, setSelectedOccupancyId] = useState<string | null>(null);
  const [typedNumber, setTypedNumber] = useState('');

  const [confirmData, setConfirmData] = useState<ResolveResponse | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showCancelWarning, setShowCancelWarning] = useState(false);

  const canContinue = useMemo(() => {
    if (selectedOccupancyId) return true;
    return typedNumber.trim().length > 0;
  }, [selectedOccupancyId, typedNumber]);

  useEffect(() => {
    if (!isOpen) return;
    // Reset per open
    setStep('select');
    setCandidates([]);
    setCandidatesError(null);
    setSelectedOccupancyId(null);
    setTypedNumber('');
    setConfirmData(null);
    setIsSubmitting(false);
    setShowCancelWarning(false);
  }, [isOpen]);

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
    if (step === 'confirm') {
      setShowCancelWarning(true);
      return;
    }
    onClose();
  };

  const handleContinue = async () => {
    if (!canContinue) return;
    setIsSubmitting(true);
    try {
      const payload = selectedOccupancyId
        ? { occupancyId: selectedOccupancyId }
        : { number: typedNumber.trim() };
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
  };

  const handleConfirm = async () => {
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
      onClose();
      onSuccess(data.alreadyCheckedOut ? 'Already checked out' : 'Checkout completed');
    } catch (e) {
      setCandidatesError(e instanceof Error ? e.message : 'Failed to complete checkout');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <ModalFrame isOpen={isOpen} title="Checkout" onClose={attemptClose} maxWidth="760px">
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
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <div className="cs-liquid-search" style={{ flex: 1, minWidth: 280 }}>
                <input
                  className="cs-liquid-input cs-liquid-search__input"
                  placeholder="Type room/locker number…"
                  value={typedNumber}
                  onFocus={() => setSelectedOccupancyId(null)}
                  onChange={(e) => {
                    setSelectedOccupancyId(null);
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
                    const selected = selectedOccupancyId === c.occupancyId;
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
                        <span style={{ fontWeight: 800 }}>
                          {c.resourceType === 'ROOM' ? 'Room' : 'Locker'} {c.number}
                        </span>
                        <span style={{ color: c.isOverdue ? '#fecaca' : 'rgba(148, 163, 184, 0.95)' }}>
                          {c.customerName}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ fontWeight: 900, fontSize: '1.15rem' }}>Confirm checkout</div>
              {confirmData && (
                <div className="er-surface" style={{ padding: '1rem', borderRadius: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    <div>
                      <div style={{ color: '#94a3b8', fontSize: '0.875rem' }}>Customer</div>
                      <div style={{ fontWeight: 800 }}>{confirmData.customerName}</div>
                    </div>
                    <div>
                      <div style={{ color: '#94a3b8', fontSize: '0.875rem' }}>Resource</div>
                      <div style={{ fontWeight: 800 }}>
                        {confirmData.resourceType === 'ROOM' ? 'Room' : 'Locker'} {confirmData.number}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: '#94a3b8', fontSize: '0.875rem' }}>Check-in</div>
                      <div style={{ fontWeight: 800 }}>{toDate(confirmData.checkinAt).toLocaleString()}</div>
                    </div>
                    <div>
                      <div style={{ color: '#94a3b8', fontSize: '0.875rem' }}>Scheduled checkout</div>
                      <div style={{ fontWeight: 800 }}>
                        {toDate(confirmData.scheduledCheckoutAt).toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: '#94a3b8', fontSize: '0.875rem' }}>Late</div>
                      <div style={{ fontWeight: 800 }}>{confirmData.lateMinutes} min</div>
                    </div>
                    <div>
                      <div style={{ color: '#94a3b8', fontSize: '0.875rem' }}>Outcome</div>
                      <div style={{ fontWeight: 900, color: confirmData.banApplied ? '#f59e0b' : '#10b981' }}>
                        Fee ${confirmData.fee.toFixed(2)}
                        {confirmData.banApplied ? ' • 30-day ban' : ''}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.25rem' }}>
                <button
                  type="button"
                  className="cs-liquid-button cs-liquid-button--secondary"
                  onClick={() => {
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


