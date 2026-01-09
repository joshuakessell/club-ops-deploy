import type { CheckoutRequestSummary } from '@club-ops/shared';

export interface CheckoutVerificationModalProps {
  request: CheckoutRequestSummary;
  isSubmitting: boolean;
  checkoutItemsConfirmed: boolean;
  checkoutFeePaid: boolean;
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
  onConfirmItems,
  onMarkFeePaid,
  onComplete,
  onCancel,
}: CheckoutVerificationModalProps) {
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
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        <h2 style={{ marginBottom: '1.5rem', fontSize: '1.5rem', fontWeight: 600 }}>
          Checkout Verification
        </h2>

        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ marginBottom: '0.5rem' }}>
            <strong>Customer:</strong> {request.customerName}
            {request.membershipNumber && ` (${request.membershipNumber})`}
          </div>
          <div style={{ marginBottom: '0.5rem' }}>
            <strong>Rental:</strong> {request.rentalType} •{' '}
            {request.roomNumber || request.lockerNumber || 'N/A'}
          </div>
          <div style={{ marginBottom: '0.5rem' }}>
            <strong>Scheduled Checkout:</strong>{' '}
            {new Date(request.scheduledCheckoutAt).toLocaleString()}
          </div>
          {request.lateMinutes > 0 && (
            <div style={{ marginBottom: '0.5rem', color: '#f59e0b' }}>
              <strong>Late:</strong> {request.lateMinutes} minutes
            </div>
          )}
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
          <div style={{ marginBottom: '0.5rem', fontWeight: 600 }}>
            Customer Checklist:
          </div>
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
              className={[
                'cs-liquid-button',
                checkoutFeePaid ? 'cs-liquid-button--selected' : '',
              ]
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
                !checkoutItemsConfirmed ||
                (request.lateFeeAmount > 0 && !checkoutFeePaid)
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

