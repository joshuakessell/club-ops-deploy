import { useEffect, useRef } from 'react';

export function TransactionCompleteModal({
  isOpen,
  agreementPending,
  agreementBypassPending,
  agreementSignedMethod,
  selectionSummary,
  assignedLabel,
  assignedNumber,
  checkoutAt,
  verifyDisabled,
  showComplete,
  completeLabel,
  completeDisabled,
  showBypassAction,
  showPhysicalConfirmAction,
  onVerifyAgreementArtifacts,
  onStartAgreementBypass,
  onConfirmPhysicalAgreement,
  onCompleteTransaction,
}: {
  isOpen: boolean;
  agreementPending: boolean;
  agreementBypassPending: boolean;
  agreementSignedMethod: 'DIGITAL' | 'MANUAL' | null;
  selectionSummary?: {
    membershipChoice?: string | null;
    rentalType?: string | null;
    waitlistDesiredType?: string | null;
    waitlistBackupType?: string | null;
  };
  assignedLabel: string;
  assignedNumber: string;
  checkoutAt: string | null;
  verifyDisabled: boolean;
  showComplete: boolean;
  completeLabel: string;
  completeDisabled: boolean;
  showBypassAction: boolean;
  showPhysicalConfirmAction: boolean;
  onVerifyAgreementArtifacts: () => void;
  onStartAgreementBypass: () => void;
  onConfirmPhysicalAgreement: () => void;
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
              {agreementBypassPending
                ? 'Digital agreement bypass requested; awaiting physical signature.'
                : 'Waiting for customer to sign the agreement on their device.'}
            </div>
          </div>
        )}

        {selectionSummary && (
          <div className="er-txn-complete-modal__assignment er-surface">
            <div style={{ fontWeight: 900, fontSize: '1.05rem' }}>Selection Summary</div>
            {selectionSummary.membershipChoice && (
              <div style={{ fontSize: '0.95rem', color: '#94a3b8', fontWeight: 700 }}>
                Membership: {selectionSummary.membershipChoice}
              </div>
            )}
            {selectionSummary.rentalType && (
              <div style={{ fontSize: '0.95rem', color: '#94a3b8', fontWeight: 700 }}>
                Rental: {selectionSummary.rentalType}
              </div>
            )}
            {selectionSummary.waitlistDesiredType && (
              <div style={{ fontSize: '0.95rem', color: '#94a3b8', fontWeight: 700 }}>
                Waitlist desired: {selectionSummary.waitlistDesiredType}
              </div>
            )}
            {selectionSummary.waitlistBackupType && (
              <div style={{ fontSize: '0.95rem', color: '#94a3b8', fontWeight: 700 }}>
                Waitlist backup: {selectionSummary.waitlistBackupType}
              </div>
            )}
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

        {agreementSignedMethod !== 'MANUAL' && (
          <button
            type="button"
            className="cs-liquid-button cs-liquid-button--secondary er-txn-complete-modal__verify"
            onClick={onVerifyAgreementArtifacts}
            disabled={verifyDisabled}
          >
            Verify agreement PDF + signature saved
          </button>
        )}

        {showBypassAction && (
          <button
            type="button"
            className="cs-liquid-button cs-liquid-button--warning er-txn-complete-modal__verify"
            onClick={onStartAgreementBypass}
            disabled={completeDisabled}
          >
            Bypass digital agreement
          </button>
        )}

        {showPhysicalConfirmAction && (
          <button
            type="button"
            className="cs-liquid-button cs-liquid-button--success er-txn-complete-modal__verify"
            onClick={onConfirmPhysicalAgreement}
            disabled={completeDisabled}
          >
            Physical agreement signed
          </button>
        )}

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
