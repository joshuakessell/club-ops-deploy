import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

export type TenderOutcomeChoice = 'CREDIT_SUCCESS' | 'CREDIT_DECLINE' | 'CASH_SUCCESS';

export function RequiredTenderOutcomeModal({
  isOpen,
  totalLabel,
  details,
  isSubmitting,
  onConfirm,
  extraActionLabel,
  onExtraAction,
}: {
  isOpen: boolean;
  totalLabel: string;
  details?: ReactNode;
  isSubmitting: boolean;
  onConfirm: (choice: TenderOutcomeChoice) => void;
  extraActionLabel?: string;
  onExtraAction?: () => void;
}) {
  const [choice, setChoice] = useState<TenderOutcomeChoice | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setChoice(null);
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
        { value: 'CREDIT_DECLINE' as const, label: 'Credit Failure' },
        { value: 'CASH_SUCCESS' as const, label: 'Cash Success' },
      ] as const,
    []
  );

  if (!isOpen) return null;

  return (
    <div className="er-required-modal__overlay" role="presentation">
      <div
        ref={modalRef}
        className="er-required-modal cs-liquid-card glass-effect"
        role="dialog"
        aria-modal="true"
        aria-label="Select tender outcome"
      >
        <div className="er-required-modal__title">Select Tender Outcome</div>
        <div className="er-required-modal__subtitle">{totalLabel}</div>
        {details ? <div className="er-required-modal__details">{details}</div> : null}

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
    </div>
  );
}
