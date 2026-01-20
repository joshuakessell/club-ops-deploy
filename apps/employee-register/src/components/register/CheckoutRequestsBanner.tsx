import type { CheckoutRequestSummary } from '@club-ops/shared';

export interface CheckoutRequestsBannerProps {
  requests: CheckoutRequestSummary[];
  onClaim: (requestId: string) => void;
  onOpenCustomerAccount?: (customerId: string, customerLabel?: string) => void;
}

export function CheckoutRequestsBanner({ requests, onClaim, onOpenCustomerAccount }: CheckoutRequestsBannerProps) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        background: '#1e293b',
        borderBottom: '2px solid #3b82f6',
        zIndex: 1000,
        padding: '1rem',
        maxHeight: '200px',
        overflowY: 'auto',
      }}
    >
      {requests.map((request) => {
        const lateMinutes = request.lateMinutes;
        const feeAmount = request.lateFeeAmount;
        const banApplied = request.banApplied;
        const canOpenCustomer = Boolean(request.customerId && onOpenCustomerAccount);

        return (
          <div
            key={request.requestId}
            onClick={() => void onClaim(request.requestId)}
            style={{
              padding: '1rem',
              marginBottom: '0.5rem',
              background: '#0f172a',
              border: '2px solid #3b82f6',
              borderRadius: '8px',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#1e293b';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#0f172a';
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div
                  style={{ fontWeight: 600, fontSize: '1.125rem', marginBottom: '0.25rem' }}
                >
                  {canOpenCustomer ? (
                    <button
                      type="button"
                      className="cs-liquid-button cs-liquid-button--secondary"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenCustomerAccount?.(request.customerId!, request.customerName);
                      }}
                      style={{
                        padding: '0.2rem 0.55rem',
                        minHeight: 'unset',
                        fontWeight: 900,
                      }}
                      title="Open Customer Account"
                    >
                      {request.customerName}
                      {request.membershipNumber ? ` (${request.membershipNumber})` : ''}
                    </button>
                  ) : (
                    <>
                      {request.customerName}
                      {request.membershipNumber && ` (${request.membershipNumber})`}
                    </>
                  )}
                </div>
                <div style={{ fontSize: '0.875rem', color: '#94a3b8' }}>
                  {request.rentalType} •{' '}
                  {request.roomNumber || request.lockerNumber || 'N/A'}
                </div>
                <div
                  style={{ fontSize: '0.875rem', color: '#94a3b8', marginTop: '0.25rem' }}
                >
                  Scheduled: {new Date(request.scheduledCheckoutAt).toLocaleString()} •
                  Current: {new Date(request.currentTime).toLocaleString()} •
                  {lateMinutes > 0 ? (
                    <span style={{ color: '#f59e0b' }}>{lateMinutes} min late</span>
                  ) : (
                    <span>On time</span>
                  )}
                </div>
                {feeAmount > 0 && (
                  <div
                    style={{
                      fontSize: '0.875rem',
                      color: '#f59e0b',
                      marginTop: '0.25rem',
                      fontWeight: 600,
                    }}
                  >
                    Late fee: ${feeAmount.toFixed(2)}
                    {banApplied && ' • 30-day ban applied'}
                  </div>
                )}
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void onClaim(request.requestId);
                }}
                style={{
                  padding: '0.5rem 1rem',
                  background: '#3b82f6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Claim
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

