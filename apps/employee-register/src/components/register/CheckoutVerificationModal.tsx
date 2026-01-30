import type { CheckoutRequestSummary } from '@club-ops/shared';
import { computeCheckoutDelta, formatCheckoutDelta } from '@club-ops/shared';
import { useEffect, useMemo, useRef, useState } from 'react';

export interface CheckoutVerificationModalProps {
  request: CheckoutRequestSummary;
  isSubmitting: boolean;
  checkoutItemsConfirmed: boolean;
  checkoutFeePaid: boolean;
  onOpenCustomerAccount?: (customerId: string, customerLabel?: string) => void;
  onConfirmItems: () => void;
  onMarkFeePaid: () => void;
  onComplete: () => void;
  onCancel: () => void;
}

export function CheckoutVerificationModal({
  request,
  isSubmitting,
  checkoutItemsConfirmed,
  checkoutFeePaid,
  onOpenCustomerAccount,
  onConfirmItems,
  onMarkFeePaid,
  onComplete,
  onCancel,
}: CheckoutVerificationModalProps) {
  const [now, setNow] = useState(() => new Date());
  const modalRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const root = modalRef.current;
    if (!root) return;
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => el.offsetParent !== null);
    (focusables[0] ?? root).focus();

    const onKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      if (active && !root.contains(active)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.key !== 'Tab') return;
      const nextFocusables = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null);
      if (nextFocusables.length === 0) return;
      const idx = active ? nextFocusables.indexOf(active) : -1;
      const nextIdx = e.shiftKey
        ? idx <= 0
          ? nextFocusables.length - 1
          : idx - 1
        : idx === -1 || idx === nextFocusables.length - 1
          ? 0
          : idx + 1;
      e.preventDefault();
      nextFocusables[nextIdx]?.focus();
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, []);

  const scheduled = useMemo(
    () => new Date(request.scheduledCheckoutAt),
    [request.scheduledCheckoutAt]
  );
  const delta = useMemo(() => computeCheckoutDelta(now, scheduled), [now, scheduled]);
  const deltaLabel = useMemo(() => formatCheckoutDelta(delta), [delta]);

  const number = request.roomNumber || request.lockerNumber || 'N/A';
  const numberLabel = request.roomNumber ? 'Room' : request.lockerNumber ? 'Locker' : 'Rental';
  const canOpenCustomer = Boolean(request.customerId && onOpenCustomerAccount);

  return (
    <div className="er-checkout-verify-overlay">
      <div
        className="cs-liquid-card er-checkout-verify-card"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
      >
        <h2 className="er-checkout-verify-title">Checkout Verification</h2>

        <div className="er-checkout-verify-section">
          {/* Display order (required):
              1) Room/Locker Number
              2) Customer name
              3) Expected Check Out time
              4) Delta (remaining/late) with 15-min floor rounding
          */}
          <div className="cs-liquid-card glass-effect er-checkout-verify-info">
            <div className="er-checkout-verify-number">
              {numberLabel} {number}
            </div>
            <div className="er-checkout-verify-customer">
              {canOpenCustomer ? (
                <button
                  type="button"
                  className="cs-liquid-button cs-liquid-button--secondary"
                  onClick={() => onOpenCustomerAccount?.(request.customerId!, request.customerName)}
                  className="cs-liquid-button cs-liquid-button--secondary er-compact-pill"
                  title="Open Customer Account"
                >
                  {request.customerName}
                  {request.membershipNumber ? ` (${request.membershipNumber})` : ''}
                </button>
              ) : (
                <>
                  {request.customerName}
                  {request.membershipNumber && (
                    <span className="er-checkout-verify-customer-muted">
                      {' '}
                      ({request.membershipNumber})
                    </span>
                  )}
                </>
              )}
            </div>
            <div className="er-checkout-verify-expected">
              Expected Check Out:{' '}
              <span className="er-checkout-verify-expected-time">{scheduled.toLocaleString()}</span>
            </div>
            <div
              className={[
                'er-checkout-verify-delta',
                delta.status === 'late'
                  ? 'er-checkout-verify-delta--late'
                  : 'er-checkout-verify-delta--ontime',
              ].join(' ')}
            >
              {deltaLabel}
            </div>
          </div>

          {request.lateFeeAmount > 0 && (
            <div className="er-checkout-verify-fee">
              <strong>Late Fee:</strong> ${request.lateFeeAmount.toFixed(2)}
              {request.banApplied && ' • 30-day ban applied'}
            </div>
          )}
        </div>

        <div
          className="cs-liquid-card er-checkout-verify-checklist"
        >
          <div className="er-checkout-verify-checklist-title">Customer Checklist:</div>
          <div className="er-checkout-verify-checklist-subtitle">
            (Items customer marked as returned)
          </div>
        </div>

        <div className="u-flex u-flex-col u-gap-16 u-mb-24">
          <button
            onClick={onConfirmItems}
            disabled={checkoutItemsConfirmed}
            className={[
              'cs-liquid-button',
              checkoutItemsConfirmed ? 'cs-liquid-button--selected' : '',
              'er-modal-button',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {checkoutItemsConfirmed ? '✓ Items Confirmed' : 'Confirm Items Returned'}
          </button>

          {request.lateFeeAmount > 0 && (
            <button
              onClick={onMarkFeePaid}
              disabled={checkoutFeePaid}
              className={[
                'cs-liquid-button',
                checkoutFeePaid ? 'cs-liquid-button--selected' : '',
                'er-modal-button',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {checkoutFeePaid ? '✓ Fee Marked Paid' : 'Mark Late Fee Paid'}
            </button>
          )}

          <button
            onClick={onComplete}
            disabled={
              !checkoutItemsConfirmed ||
              (request.lateFeeAmount > 0 && !checkoutFeePaid) ||
              isSubmitting
            }
            className="cs-liquid-button er-modal-button"
          >
            {isSubmitting ? 'Processing...' : 'Complete Checkout'}
          </button>
        </div>

        <button
          onClick={onCancel}
          className="cs-liquid-button cs-liquid-button--danger er-modal-action-btn"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
