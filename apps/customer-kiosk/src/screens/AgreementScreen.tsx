import { ReactNode, RefObject } from 'react';
import { I18nProvider, t, type Language } from '../i18n';
import { ScreenShell } from '../components/ScreenShell';
import blackLogo from '../assets/logo_vector_transparent_hi_black.svg';

export interface Agreement {
  id: string;
  version: string;
  title: string;
  bodyText: string;
}

export interface AgreementScreenProps {
  customerPrimaryLanguage: Language | null | undefined;
  agreement: Agreement | null;
  agreed: boolean;
  signatureData: string | null;
  hasScrolledAgreement: boolean;
  isSubmitting: boolean;
  orientationOverlay: ReactNode;
  welcomeOverlay: ReactNode;
  agreementScrollRef: RefObject<HTMLDivElement>;
  signatureCanvasRef: RefObject<HTMLCanvasElement>;
  onAgreeChange: (agreed: boolean) => void;
  onSignatureStart: (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => void;
  onSignatureMove: (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => void;
  onSignatureEnd: () => void;
  onClearSignature: () => void;
  onSubmit: () => void;
}

export function AgreementScreen({
  customerPrimaryLanguage,
  agreement,
  agreed,
  signatureData,
  hasScrolledAgreement,
  isSubmitting,
  orientationOverlay,
  welcomeOverlay,
  agreementScrollRef,
  signatureCanvasRef,
  onAgreeChange,
  onSignatureStart,
  onSignatureMove,
  onSignatureEnd,
  onClearSignature,
  onSubmit,
}: AgreementScreenProps) {
  return (
    <I18nProvider lang={customerPrimaryLanguage}>
      <ScreenShell backgroundVariant="none" showLogoWatermark={false}>
        {orientationOverlay}
        {welcomeOverlay}
        <div className="agreement-screen-container">
          {/* Logo header - black on white */}
          <div className="agreement-logo-header">
            <img
              src={blackLogo}
              alt={t(customerPrimaryLanguage, 'brand.clubName')}
              className="agreement-logo-img"
            />
          </div>

          {/* White paper panel */}
          <div className="agreement-paper-panel">
            <h1 className="agreement-title">
              {agreement?.title || t(customerPrimaryLanguage, 'agreementTitle')}
            </h1>

            <div ref={agreementScrollRef} className="agreement-scroll-area">
              {agreement?.bodyText ? (
                <div
                  className="agreement-body"
                  dangerouslySetInnerHTML={{ __html: agreement.bodyText }}
                />
              ) : (
                <p className="agreement-placeholder">
                  {t(customerPrimaryLanguage, 'agreementPlaceholder')}
                </p>
              )}
            </div>

            <div className="agreement-actions">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => onAgreeChange(e.target.checked)}
                  disabled={!hasScrolledAgreement}
                />
                <span>{t(customerPrimaryLanguage, 'iAgree')}</span>
              </label>
              {!hasScrolledAgreement && (
                <p className="scroll-warning">
                  {t(customerPrimaryLanguage, 'scrollRequired')}
                </p>
              )}

              <div className="signature-section">
                <p className="signature-label">
                  {t(customerPrimaryLanguage, 'signatureRequired')}
                </p>
                <canvas
                  ref={signatureCanvasRef}
                  className="signature-canvas"
                  width={600}
                  height={200}
                  onMouseDown={onSignatureStart}
                  onMouseMove={onSignatureMove}
                  onMouseUp={onSignatureEnd}
                  onMouseLeave={onSignatureEnd}
                  onTouchStart={onSignatureStart}
                  onTouchMove={onSignatureMove}
                  onTouchEnd={onSignatureEnd}
                />
                <button type="button" className="clear-signature-btn" onClick={onClearSignature}>
                  {t(customerPrimaryLanguage, 'clear')}
                </button>
              </div>

              <div className="agreement-submit-container">
                <button
                  className="btn-liquid-glass submit-agreement-btn"
                  onClick={onSubmit}
                  disabled={!agreed || !signatureData || !hasScrolledAgreement || isSubmitting}
                >
                  {isSubmitting
                    ? t(customerPrimaryLanguage, 'submitting')
                    : t(customerPrimaryLanguage, 'submit')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </ScreenShell>
    </I18nProvider>
  );
}

