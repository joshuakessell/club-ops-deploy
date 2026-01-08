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
        style={{
          background: '#1e293b',
          border: '2px solid #3b82f6',
          borderRadius: '12px',
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
          style={{
            marginBottom: '1.5rem',
            padding: '1rem',
            background: '#0f172a',
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
            style={{
              padding: '0.75rem',
              background: checkoutItemsConfirmed ? '#10b981' : '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
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
              style={{
                padding: '0.75rem',
                background: checkoutFeePaid ? '#10b981' : '#f59e0b',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
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
            style={{
              padding: '0.75rem',
              background:
                !checkoutItemsConfirmed ||
                (request.lateFeeAmount > 0 && !checkoutFeePaid)
                  ? '#475569'
                  : '#10b981',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
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
          style={{
            width: '100%',
            padding: '0.75rem',
            background: 'transparent',
            color: '#94a3b8',
            border: '1px solid #475569',
            borderRadius: '6px',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

