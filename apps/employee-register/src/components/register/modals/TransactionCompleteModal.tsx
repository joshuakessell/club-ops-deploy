import { useEffect, useRef } from 'react';

export function TransactionCompleteModal({
  isOpen,
  agreementPending,
  assignedLabel,
  assignedNumber,
  checkoutAt,
  verifyDisabled,
  showComplete,
  completeLabel,
  completeDisabled,
  onVerifyAgreementArtifacts,
  onCompleteTransaction,
}: {
  isOpen: boolean;
  agreementPending: boolean;
  assignedLabel: string;
  assignedNumber: string;
  checkoutAt: string | null;
  verifyDisabled: boolean;
  showComplete: boolean;
  completeLabel: string;
  completeDisabled: boolean;
  onVerifyAgreementArtifacts: () => void;
  onCompleteTransaction: () => void;
}) {
  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const root = modalRef.current;
    if (!root) return;
    const first = root.querySelector<HTMLElement>('button');
    first?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Transaction completion gate: prevent ESC from bubbling to other app handlers.
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

  if (!isOpen) return null;

  return (
    <div className="er-txn-complete-modal__overlay" role="presentation">
      <div
        ref={modalRef}
        className="er-txn-complete-modal cs-liquid-card glass-effect"
        role="dialog"
        aria-modal="true"
        aria-label="Transaction ready"
      >
        <div className="er-txn-complete-modal__title">Transaction Ready</div>

        {agreementPending && (
          <div className="er-txn-complete-modal__notice er-surface">
            <div style={{ fontWeight: 900, fontSize: '1.05rem' }}>Agreement Pending</div>
            <div style={{ fontSize: '0.95rem', color: '#94a3b8', fontWeight: 700 }}>
              Waiting for customer to sign the agreement on their device.
            </div>
          </div>
        )}

        <div className="er-txn-complete-modal__assignment er-surface">
          <div style={{ fontWeight: 900, fontSize: '1.2rem' }}>
            Assigned: {assignedLabel} {assignedNumber}
          </div>
          {checkoutAt && (
            <div style={{ fontSize: '1rem', color: '#94a3b8', fontWeight: 700 }}>
              Checkout: {new Date(checkoutAt).toLocaleString()}
            </div>
          )}
        </div>

        <button
          type="button"
          className="cs-liquid-button cs-liquid-button--secondary er-txn-complete-modal__verify"
          onClick={onVerifyAgreementArtifacts}
          disabled={verifyDisabled}
        >
          Verify agreement PDF + signature saved
        </button>

        {showComplete && (
          <button
            type="button"
            className="cs-liquid-button er-txn-complete-modal__complete"
            onClick={onCompleteTransaction}
            disabled={completeDisabled}
          >
            {completeLabel}
          </button>
        )}
      </div>
    </div>
  );
}

