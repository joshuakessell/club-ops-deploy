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
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.8)',
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
      }}
    >
      <div
        className="cs-liquid-card"
        style={{
          padding: '2rem',
          maxWidth: '600px',
          width: '100%',
          maxHeight: '80vh',
          overflowY: 'auto',
        }}
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
      >
        <h2 style={{ marginBottom: '1.5rem', fontSize: '1.5rem', fontWeight: 600 }}>
          Checkout Verification
        </h2>

        <div style={{ marginBottom: '1.5rem' }}>
          {/* Display order (required):
              1) Room/Locker Number
              2) Customer name
              3) Expected Check Out time
              4) Delta (remaining/late) with 15-min floor rounding
          */}
          <div
            className="cs-liquid-card glass-effect"
            style={{ padding: '1rem', marginBottom: '1rem' }}
          >
            <div style={{ fontWeight: 900, fontSize: '2rem', letterSpacing: '0.01em' }}>
              {numberLabel} {number}
            </div>
            <div style={{ marginTop: '0.35rem', fontSize: '1.25rem', fontWeight: 800 }}>
              {canOpenCustomer ? (
                <button
                  type="button"
                  className="cs-liquid-button cs-liquid-button--secondary"
                  onClick={() => onOpenCustomerAccount?.(request.customerId!, request.customerName)}
                  style={{ padding: '0.25rem 0.65rem', minHeight: 'unset', fontWeight: 900 }}
                  title="Open Customer Account"
                >
                  {request.customerName}
                  {request.membershipNumber ? ` (${request.membershipNumber})` : ''}
                </button>
              ) : (
                <>
                  {request.customerName}
                  {request.membershipNumber && (
                    <span style={{ fontWeight: 700, color: '#94a3b8' }}>
                      {' '}
                      ({request.membershipNumber})
                    </span>
                  )}
                </>
              )}
            </div>
            <div style={{ marginTop: '0.5rem', color: '#cbd5e1', fontWeight: 700 }}>
              Expected Check Out:{' '}
              <span style={{ fontWeight: 800 }}>{scheduled.toLocaleString()}</span>
            </div>
            <div
              style={{
                marginTop: '0.35rem',
                fontWeight: 900,
                color: delta.status === 'late' ? '#f59e0b' : '#10b981',
              }}
            >
              {deltaLabel}
            </div>
          </div>

          {request.lateFeeAmount > 0 && (
            <div style={{ marginBottom: '0.5rem', color: '#f59e0b', fontWeight: 600 }}>
              <strong>Late Fee:</strong> ${request.lateFeeAmount.toFixed(2)}
              {request.banApplied && ' • 30-day ban applied'}
            </div>
          )}
        </div>

        <div
          className="cs-liquid-card"
          style={{
            marginBottom: '1.5rem',
            padding: '1rem',
            borderRadius: '8px',
          }}
        >
          <div style={{ marginBottom: '0.5rem', fontWeight: 600 }}>Customer Checklist:</div>
          <div style={{ fontSize: '0.875rem', color: '#94a3b8' }}>
            (Items customer marked as returned)
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            marginBottom: '1.5rem',
          }}
        >
          <button
            onClick={onConfirmItems}
            disabled={checkoutItemsConfirmed}
            className={[
              'cs-liquid-button',
              checkoutItemsConfirmed ? 'cs-liquid-button--selected' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{
              padding: '0.75rem',
              cursor: checkoutItemsConfirmed ? 'default' : 'pointer',
              fontWeight: 600,
            }}
          >
            {checkoutItemsConfirmed ? '✓ Items Confirmed' : 'Confirm Items Returned'}
          </button>

          {request.lateFeeAmount > 0 && (
            <button
              onClick={onMarkFeePaid}
              disabled={checkoutFeePaid}
              className={['cs-liquid-button', checkoutFeePaid ? 'cs-liquid-button--selected' : '']
                .filter(Boolean)
                .join(' ')}
              style={{
                padding: '0.75rem',
                cursor: checkoutFeePaid ? 'default' : 'pointer',
                fontWeight: 600,
              }}
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
            className="cs-liquid-button"
            style={{
              padding: '0.75rem',
              cursor:
                !checkoutItemsConfirmed || (request.lateFeeAmount > 0 && !checkoutFeePaid)
                  ? 'not-allowed'
                  : 'pointer',
              fontWeight: 600,
            }}
          >
            {isSubmitting ? 'Processing...' : 'Complete Checkout'}
          </button>
        </div>

        <button
          onClick={onCancel}
          className="cs-liquid-button cs-liquid-button--danger"
          style={{
            width: '100%',
            padding: '0.75rem',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
