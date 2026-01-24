import { ReactNode } from 'react';
import { I18nProvider, t, type Language } from '../i18n';
import { ScreenShell } from '../components/ScreenShell';
import { getPaymentLineItemDisplayDescription } from '../utils/display';

export interface PaymentScreenProps {
  customerPrimaryLanguage: Language | null | undefined;
  paymentLineItems?: Array<{ description: string; amount: number }>;
  paymentTotal?: number;
  paymentFailureReason?: string;
  orientationOverlay: ReactNode;
  welcomeOverlay: ReactNode;
}

export function PaymentScreen({
  customerPrimaryLanguage,
  paymentLineItems,
  paymentTotal,
  paymentFailureReason,
  orientationOverlay,
  welcomeOverlay,
}: PaymentScreenProps) {
  return (
    <I18nProvider lang={customerPrimaryLanguage}>
      <ScreenShell backgroundVariant="steamroom1" showLogoWatermark={true} watermarkLayer="under">
        {orientationOverlay}
        {welcomeOverlay}
        <div className="active-content">
          <main className="main-content">
            <div className="payment-pending-screen">
              {paymentLineItems && paymentLineItems.length > 0 && (
                <div className="payment-breakdown cs-liquid-card">
                  <p className="breakdown-title">
                    {t(customerPrimaryLanguage, 'payment.charges')}
                  </p>
                  <div className="breakdown-items">
                    {paymentLineItems.map((li, idx) => (
                      <div key={`${li.description}-${idx}`} className="breakdown-row">
                        <span className="breakdown-desc">
                          {getPaymentLineItemDisplayDescription(li.description, customerPrimaryLanguage)}
                        </span>
                        <span className="breakdown-amt">${li.amount.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {paymentTotal !== undefined && (
                <div className="payment-total cs-liquid-card">
                  <p className="total-label">{t(customerPrimaryLanguage, 'totalDue')}</p>
                  <p className="total-amount">${paymentTotal.toFixed(2)}</p>
                </div>
              )}
              {/* Never show decline reason to the customer; generic guidance only */}
              {paymentFailureReason && (
                <div className="payment-decline-generic">
                  {t(customerPrimaryLanguage, 'paymentIssueSeeAttendant')}
                </div>
              )}
            </div>
          </main>
        </div>
      </ScreenShell>
    </I18nProvider>
  );
}
