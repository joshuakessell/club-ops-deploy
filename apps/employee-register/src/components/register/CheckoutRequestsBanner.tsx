import type { CheckoutRequestSummary } from '@club-ops/shared';

export interface CheckoutRequestsBannerProps {
  requests: CheckoutRequestSummary[];
  onClaim: (requestId: string) => void;
  onOpenCustomerAccount?: (customerId: string, customerLabel?: string) => void;
}

export function CheckoutRequestsBanner({
  requests,
  onClaim,
  onOpenCustomerAccount,
}: CheckoutRequestsBannerProps) {
  return (
    <div className="er-checkout-banner">
      {requests.map((request) => {
        const lateMinutes = request.lateMinutes;
        const feeAmount = request.lateFeeAmount;
        const banApplied = request.banApplied;
        const canOpenCustomer = Boolean(request.customerId && onOpenCustomerAccount);

        return (
          <div
            key={request.requestId}
            onClick={() => void onClaim(request.requestId)}
            className="er-checkout-banner-item"
          >
            <div className="er-checkout-banner-row">
              <div>
                <div className="er-checkout-banner-title">
                  {canOpenCustomer ? (
                    <button
                      type="button"
                      className="cs-liquid-button cs-liquid-button--secondary"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenCustomerAccount?.(request.customerId!, request.customerName);
                      }}
                      className="cs-liquid-button cs-liquid-button--secondary er-checkout-banner-btn"
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
                <div className="er-checkout-banner-meta">
                  {request.rentalType} • {request.roomNumber || request.lockerNumber || 'N/A'}
                </div>
                <div className="er-checkout-banner-meta er-checkout-banner-meta--spaced">
                  Scheduled: {new Date(request.scheduledCheckoutAt).toLocaleString()} • Current:{' '}
                  {new Date(request.currentTime).toLocaleString()} •
                  {lateMinutes > 0 ? (
                    <span className="er-checkout-banner-late">{lateMinutes} min late</span>
                  ) : (
                    <span>On time</span>
                  )}
                </div>
                {feeAmount > 0 && (
                  <div className="er-checkout-banner-fee">
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
                className="er-checkout-banner-claim"
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
