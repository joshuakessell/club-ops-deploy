import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

export type TenderOutcomeChoice = 'CREDIT_SUCCESS' | 'CREDIT_DECLINE' | 'CASH_SUCCESS';
type SplitStep = 'main' | 'split-card' | 'split-cash';

function parseCurrency(value: string): number | null {
  const normalized = value.replace(/[^0-9.]/g, '');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function RequiredTenderOutcomeModal({
  isOpen,
  totalAmount,
  details,
  isSubmitting,
  onConfirm,
  onClose,
  extraActionLabel,
  onExtraAction,
}: {
  isOpen: boolean;
  totalAmount: number;
  details?: ReactNode;
  isSubmitting: boolean;
  onConfirm: (choice: TenderOutcomeChoice) => void;
  onClose?: () => void;
  extraActionLabel?: string;
  onExtraAction?: () => void;
}) {
  const [choice, setChoice] = useState<TenderOutcomeChoice | null>(null);
  const [step, setStep] = useState<SplitStep>('main');
  const [cardAmountInput, setCardAmountInput] = useState('');
  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setChoice(null);
    setStep('main');
    setCardAmountInput('');
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const root = modalRef.current;
    if (!root) return;

    // Focus the first option for tablet usability.
    const first = root.querySelector<HTMLElement>('button[data-choice]');
    first?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
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
      const active = document.activeElement as HTMLElement | null;
      const idx = active ? focusables.indexOf(active) : -1;
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
  }, [isOpen]);

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
  const cardAmount = parseCurrency(cardAmountInput);
  const remaining = cardAmount === null ? total : Math.max(total - cardAmount, 0);
  const cardAmountValid = cardAmount !== null && cardAmount > 0 && cardAmount < total;
  const stepIndex = step === 'main' ? 0 : step === 'split-card' ? 1 : 2;

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
          <div className="er-required-modal__amount-value">${total.toFixed(2)}</div>
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
          className="er-required-modal__carousel"
          style={{ transform: `translateX(-${stepIndex * 100}%)` }}
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
                  setStep('split-card');
                }}
                disabled={isSubmitting || total <= 0}
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
              <div className="er-required-modal__split-title">Split: Card Amount</div>
              <div className="er-required-modal__split-input">
                <span>$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder={total.toFixed(2)}
                  value={cardAmountInput}
                  onChange={(e) => setCardAmountInput(e.target.value)}
                  disabled={isSubmitting}
                  aria-label="Card amount"
                />
              </div>
              <div className="er-required-modal__split-hint">
                {cardAmountValid
                  ? `Remaining cash: $${remaining.toFixed(2)}`
                  : 'Enter a card amount less than the total.'}
              </div>
              <div className="er-required-modal__split-actions">
                <button
                  type="button"
                  className="cs-liquid-button cs-liquid-button--secondary"
                  onClick={() => setStep('main')}
                  disabled={isSubmitting}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="cs-liquid-button cs-liquid-button--danger"
                  onClick={() => {
                    if (isSubmitting) return;
                    onConfirm('CREDIT_DECLINE');
                  }}
                  disabled={isSubmitting}
                >
                  Credit Fail
                </button>
                <button
                  type="button"
                  className="cs-liquid-button"
                  onClick={() => {
                    if (isSubmitting || !cardAmountValid) return;
                    setStep('split-cash');
                  }}
                  disabled={isSubmitting || !cardAmountValid}
                >
                  Credit Success
                </button>
              </div>
            </div>
          </div>

          <div className="er-required-modal__panel">
            <div className="er-required-modal__split-panel">
              <div className="er-required-modal__split-title">Split: Cash Due</div>
              <div className="er-required-modal__split-total">${remaining.toFixed(2)}</div>
              <div className="er-required-modal__split-hint">
                Collect the remaining cash, then confirm below.
              </div>
              <div className="er-required-modal__split-actions">
                <button
                  type="button"
                  className="cs-liquid-button cs-liquid-button--secondary"
                  onClick={() => setStep('split-card')}
                  disabled={isSubmitting}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="cs-liquid-button"
                  onClick={() => {
                    if (isSubmitting) return;
                    onConfirm('CASH_SUCCESS');
                  }}
                  disabled={isSubmitting}
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
