import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

export type TenderOutcomeChoice = 'CREDIT_SUCCESS' | 'CREDIT_DECLINE' | 'CASH_SUCCESS';
type SplitStep = 'main' | 'split';
type SplitField = 'card' | 'cash' | null;

function parseCurrency(value: string): number | null {
  const normalized = value.replace(/[^0-9.]/g, '');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

export function RequiredTenderOutcomeModal({
  isOpen,
  totalAmount,
  details,
  isSubmitting,
  onConfirm,
  onSplitCardSuccess,
  onClose,
  focusLockEnabled = true,
  extraActionLabel,
  onExtraAction,
}: {
  isOpen: boolean;
  totalAmount: number;
  details?: ReactNode;
  isSubmitting: boolean;
  onConfirm: (choice: TenderOutcomeChoice) => void;
  onSplitCardSuccess?: (cardAmount: number) => Promise<boolean> | boolean | void;
  onClose?: () => void;
  focusLockEnabled?: boolean;
  extraActionLabel?: string;
  onExtraAction?: () => void;
}) {
  const [choice, setChoice] = useState<TenderOutcomeChoice | null>(null);
  const [step, setStep] = useState<SplitStep>('main');
  const [cardAmountInput, setCardAmountInput] = useState('');
  const [cashAmountInput, setCashAmountInput] = useState('');
  const [splitTotal, setSplitTotal] = useState<number | null>(null);
  const [splitCommitted, setSplitCommitted] = useState(false);
  const [lastEdited, setLastEdited] = useState<SplitField>(null);
  const [splitError, setSplitError] = useState<string | null>(null);
  const [isProcessingCard, setIsProcessingCard] = useState(false);
  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setChoice(null);
    setStep('main');
    setCardAmountInput('');
    setCashAmountInput('');
    setSplitTotal(null);
    setSplitCommitted(false);
    setLastEdited(null);
    setSplitError(null);
    setIsProcessingCard(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (step !== 'split') return;
    if (!Number.isFinite(totalAmount)) return;

    if (splitCommitted) {
      if (splitTotal !== null && totalAmount !== splitTotal) {
        setSplitTotal(null);
        setCashAmountInput(totalAmount.toFixed(2));
        setLastEdited(null);
      }
      return;
    }

    if (splitTotal !== null && totalAmount !== splitTotal) {
      setSplitTotal(totalAmount);
      setCardAmountInput('');
      setCashAmountInput('');
      setLastEdited(null);
      setSplitError(null);
    }
  }, [isOpen, step, splitCommitted, splitTotal, totalAmount]);

  useEffect(() => {
    if (!isOpen || !focusLockEnabled) return;

    const root = modalRef.current;
    if (!root) return;

    // Focus the first option for tablet usability.
    const first = root.querySelector<HTMLElement>('button[data-choice]');
    first?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement as HTMLElement | null;
      if (activeEl && !root.contains(activeEl)) return;
      if (e.key === 'Escape') {
        // Required modal: prevent ESC close semantics from bubbling.
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.key !== 'Tab') return;
      // Minimal focus trap
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) return;
      const idx = activeEl ? focusables.indexOf(activeEl) : -1;
      const nextIdx = e.shiftKey
        ? idx <= 0
          ? focusables.length - 1
          : idx - 1
        : idx === -1 || idx === focusables.length - 1
          ? 0
          : idx + 1;
      e.preventDefault();
      focusables[nextIdx]?.focus();
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [focusLockEnabled, isOpen]);

  const options = useMemo(
    () =>
      [
        { value: 'CREDIT_SUCCESS' as const, label: 'Credit Success' },
        { value: 'CREDIT_DECLINE' as const, label: 'Credit Decline' },
        { value: 'CASH_SUCCESS' as const, label: 'Cash Success' },
      ] as const,
    []
  );

  if (!isOpen) return null;

  const total = Number.isFinite(totalAmount) ? totalAmount : 0;
  const splitBaseTotal = splitTotal ?? total;
  const effectiveTotal = splitCommitted ? total : splitBaseTotal;
  const parsedCardAmount = parseCurrency(cardAmountInput);
  const parsedCashAmount = parseCurrency(cashAmountInput);
  const resolvedCardAmount =
    !splitCommitted && lastEdited === 'cash'
      ? parsedCashAmount === null
        ? null
        : roundToCents(splitBaseTotal - parsedCashAmount)
      : parsedCardAmount;
  const resolvedCashAmount =
    !splitCommitted && lastEdited === 'card'
      ? parsedCardAmount === null
        ? null
        : roundToCents(splitBaseTotal - parsedCardAmount)
      : parsedCashAmount;
  const cardAmountValid =
    resolvedCardAmount !== null &&
    resolvedCardAmount > 0 &&
    resolvedCardAmount < splitBaseTotal;
  const cashAmountValid =
    resolvedCashAmount !== null &&
    resolvedCashAmount > 0 &&
    resolvedCashAmount < effectiveTotal;
  const splitTotalsMatch = splitCommitted
    ? resolvedCashAmount !== null &&
      roundToCents(resolvedCashAmount) === roundToCents(effectiveTotal)
    : resolvedCardAmount !== null &&
      resolvedCashAmount !== null &&
      roundToCents(resolvedCardAmount + resolvedCashAmount) === roundToCents(splitBaseTotal);
  const displayTotal = effectiveTotal;

  const handleProcessCard = async () => {
    if (
      isSubmitting ||
      isProcessingCard ||
      splitCommitted ||
      !cardAmountValid ||
      !splitTotalsMatch ||
      resolvedCardAmount === null
    ) {
      return;
    }
    if (!onSplitCardSuccess) {
      setSplitError('Split card processing is unavailable.');
      return;
    }
    setIsProcessingCard(true);
    setSplitError(null);
    try {
      const result = await onSplitCardSuccess(resolvedCardAmount);
      if (result === false) {
        setSplitError('Card payment failed. Please try again.');
        return;
      }
      setSplitCommitted(true);
    } catch {
      setSplitError('Card payment failed. Please try again.');
    } finally {
      setIsProcessingCard(false);
    }
  };

  return (
    <div className="er-required-modal__overlay" role="presentation">
      <div
        ref={modalRef}
        className="er-required-modal cs-liquid-card glass-effect"
        role="dialog"
        aria-modal="true"
        aria-label="Process payment"
      >
        <div className="er-required-modal__header">
          <div>
            <div className="er-required-modal__title">Process Payment</div>
            <div className="er-required-modal__subtitle">
              Ask the guest to complete payment, then confirm below.
            </div>
          </div>
          {onClose && (
            <button
              type="button"
              className="er-required-modal__close"
              onClick={onClose}
              disabled={isSubmitting}
              aria-label="Close payment modal"
            >
              X
            </button>
          )}
        </div>
        <div className="er-required-modal__amount">
          <div className="er-required-modal__amount-label">Total due</div>
          <div className="er-required-modal__amount-value">${displayTotal.toFixed(2)}</div>
        </div>
        <div className="er-required-modal__pending">
          Pending
          <span className="er-required-modal__ellipsis" aria-hidden="true">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </div>
        {details ? <div className="er-required-modal__details">{details}</div> : null}

        <div
          className={[
            'er-required-modal__carousel',
            step === 'split' ? 'er-required-modal__carousel--split' : 'er-required-modal__carousel--main',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <div className="er-required-modal__panel">
            <div className="er-required-modal__options" role="radiogroup" aria-label="Tender outcome">
              {options.map((o) => {
                const selected = choice === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    data-choice={o.value}
                    className={[
                      'cs-liquid-button',
                      selected ? 'cs-liquid-button--selected' : 'cs-liquid-button--secondary',
                    ].join(' ')}
                    onClick={() => {
                      if (isSubmitting) return;
                      setChoice(o.value);
                      onConfirm(o.value);
                    }}
                    disabled={isSubmitting}
                    aria-pressed={selected}
                  >
                    {o.label}
                  </button>
                );
              })}
              <button
                type="button"
                className="cs-liquid-button cs-liquid-button--secondary er-required-modal__split-button"
                onClick={() => {
                  if (isSubmitting) return;
                  if (!onSplitCardSuccess) return;
                  setSplitTotal(total);
                  setCardAmountInput('');
                  setCashAmountInput('');
                  setLastEdited(null);
                  setSplitCommitted(false);
                  setSplitError(null);
                  setIsProcessingCard(false);
                  setStep('split');
                }}
                disabled={isSubmitting || total <= 0 || !onSplitCardSuccess}
              >
                Split Payment
              </button>
              {extraActionLabel && onExtraAction && (
                <button
                  type="button"
                  className={[
                    'cs-liquid-button',
                    'cs-liquid-button--secondary',
                    'er-required-modal__addon',
                  ].join(' ')}
                  onClick={() => {
                    if (isSubmitting) return;
                    onExtraAction();
                  }}
                  disabled={isSubmitting}
                >
                  {extraActionLabel}
                </button>
              )}
            </div>
          </div>

          <div className="er-required-modal__panel">
            <div className="er-required-modal__split-panel">
              <div className="er-required-modal__split-title">Split Payment</div>
              <div className="er-required-modal__split-grid">
                <label className="er-required-modal__split-field">
                  <span className="er-required-modal__split-label">Card amount</span>
                  <div className="er-required-modal__split-input">
                    <span>$</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder={splitBaseTotal.toFixed(2)}
                      value={cardAmountInput}
                      onChange={(e) => {
                        if (splitCommitted) return;
                        setLastEdited('card');
                        setCardAmountInput(e.target.value);
                        setSplitError(null);
                        const parsed = parseCurrency(e.target.value);
                        if (parsed === null) {
                          setCashAmountInput('');
                          return;
                        }
                        const remaining = roundToCents(splitBaseTotal - parsed);
                        setCashAmountInput(remaining > 0 ? remaining.toFixed(2) : '');
                      }}
                      disabled={isSubmitting || splitCommitted}
                      aria-label="Card amount"
                    />
                  </div>
                </label>
                <label className="er-required-modal__split-field">
                  <span className="er-required-modal__split-label">Cash amount</span>
                  <div className="er-required-modal__split-input">
                    <span>$</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder={splitBaseTotal.toFixed(2)}
                      value={cashAmountInput}
                      onChange={(e) => {
                        if (splitCommitted) return;
                        setLastEdited('cash');
                        setCashAmountInput(e.target.value);
                        setSplitError(null);
                        const parsed = parseCurrency(e.target.value);
                        if (parsed === null) {
                          setCardAmountInput('');
                          return;
                        }
                        const remaining = roundToCents(splitBaseTotal - parsed);
                        setCardAmountInput(remaining > 0 ? remaining.toFixed(2) : '');
                      }}
                      disabled={isSubmitting || splitCommitted}
                      aria-label="Cash amount"
                    />
                  </div>
                </label>
              </div>
              <div
                className={[
                  'er-required-modal__split-hint',
                  splitError ? 'er-required-modal__split-hint--error' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {splitError
                  ? splitError
                  : splitTotalsMatch && resolvedCashAmount !== null
                    ? splitCommitted
                      ? `Card approved. Collect $${resolvedCashAmount.toFixed(2)} cash.`
                      : `Cash due: $${resolvedCashAmount.toFixed(2)}`
                    : 'Enter a card or cash amount less than the total.'}
              </div>
              <div className="er-required-modal__split-actions">
                <button
                  type="button"
                  className="cs-liquid-button cs-liquid-button--secondary"
                  onClick={() => {
                    if (splitCommitted) return;
                    setSplitTotal(null);
                    setCardAmountInput('');
                    setCashAmountInput('');
                    setLastEdited(null);
                    setStep('main');
                  }}
                  disabled={isSubmitting || splitCommitted}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="cs-liquid-button cs-liquid-button--danger"
                  onClick={() => {
                    if (isSubmitting || splitCommitted) return;
                    onConfirm('CREDIT_DECLINE');
                  }}
                  disabled={isSubmitting || splitCommitted}
                >
                  Credit Fail
                </button>
                <button
                  type="button"
                  className="cs-liquid-button"
                  onClick={() => void handleProcessCard()}
                  disabled={
                    isSubmitting ||
                    isProcessingCard ||
                    splitCommitted ||
                    !cardAmountValid ||
                    !splitTotalsMatch
                  }
                >
                  {isProcessingCard ? 'Processing Card...' : splitCommitted ? 'Card Approved' : 'Process Card'}
                </button>
                <button
                  type="button"
                  className="cs-liquid-button"
                  onClick={() => {
                    if (isSubmitting || !splitCommitted || !cashAmountValid) return;
                    onConfirm('CASH_SUCCESS');
                  }}
                  disabled={isSubmitting || !splitCommitted || !cashAmountValid}
                >
                  Cash Success
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
