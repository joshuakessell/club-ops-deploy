import { ReactNode, RefObject, useEffect, useState } from 'react';
import { I18nProvider, t, type Language } from '../i18n';
import { ScreenShell } from '../components/ScreenShell';
import whiteLogo from '../assets/logo_vector_transparent_hi.svg';

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
  const [signatureModalOpen, setSignatureModalOpen] = useState(false);

  useEffect(() => {
    if (!signatureModalOpen) return;
    // Ensure a clean canvas each time the signature modal opens.
    // (Canvas mounts only when modal is open.)
    onClearSignature();
    // Intentionally *not* dependent on onClearSignature: the parent recreates handlers on each render,
    // and including it here would clear the canvas immediately after signatureData updates while
    // the modal is still open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signatureModalOpen]);

  return (
    <I18nProvider lang={customerPrimaryLanguage}>
      <ScreenShell backgroundVariant="none" showLogoWatermark={false}>
        {orientationOverlay}
        {welcomeOverlay}
        <div className="agreement-screen-container">
          {/* Logo header */}
          <div className="agreement-logo-header cs-liquid-card">
            <img
              src={whiteLogo}
              alt={t(customerPrimaryLanguage, 'brand.clubName')}
              className="agreement-logo-img"
            />
          </div>

          {/* Liquid-glass panel */}
          <div className="agreement-paper-panel cs-liquid-card">
            <h1 className="agreement-title">
              {agreement?.title || t(customerPrimaryLanguage, 'agreementTitle')}
            </h1>

            <div className="agreement-scroll-wrap">
              {!hasScrolledAgreement && (
                <>
                  <div className="agreement-scroll-hint agreement-scroll-hint--left" aria-hidden="true">
                    ⌄
                  </div>
                  <div className="agreement-scroll-hint agreement-scroll-hint--right" aria-hidden="true">
                    ⌄
                  </div>
                </>
              )}

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
            </div>

            <div className="agreement-actions">
              <div className="agreement-checkbox-row">
                {hasScrolledAgreement && !agreed && (
                  <div className="agreement-checkbox-hint" aria-hidden="true">
                    ⇩
                  </div>
                )}
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => onAgreeChange(e.target.checked)}
                    disabled={!hasScrolledAgreement}
                  />
                  <span>{t(customerPrimaryLanguage, 'iAgree')}</span>
                </label>
              </div>

              {!hasScrolledAgreement && (
                <p className="scroll-warning">{t(customerPrimaryLanguage, 'scrollRequired')}</p>
              )}

              <div className="agreement-signature-row">
                <button
                  type="button"
                  className="cs-liquid-button agreement-signature-button"
                  onClick={() => setSignatureModalOpen(true)}
                  disabled={!hasScrolledAgreement || !!signatureData}
                >
                  {signatureData ? (
                    <span className="agreement-signature-button__content">
                      <span className="agreement-signature-check" aria-hidden="true">
                        ✓
                      </span>
                      <span>Signed</span>
                    </span>
                  ) : (
                    'Tap to Sign'
                  )}
                </button>
              </div>

              <div className="agreement-submit-container">
                <button
                  className="cs-liquid-button submit-agreement-btn"
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

        {signatureModalOpen && (
          <div
            className="signature-modal-overlay"
            role="dialog"
            aria-label="Signature"
            onClick={() => setSignatureModalOpen(false)}
          >
            <div className="signature-modal cs-liquid-card" onClick={(e) => e.stopPropagation()}>
              <div className="signature-modal-header">
                <div className="signature-modal-title">{t(customerPrimaryLanguage, 'signatureRequired')}</div>
              </div>

              <canvas
                ref={signatureCanvasRef}
                className="signature-modal-canvas"
                width={900}
                height={320}
                onMouseDown={onSignatureStart}
                onMouseMove={onSignatureMove}
                onMouseUp={onSignatureEnd}
                onMouseLeave={onSignatureEnd}
                onTouchStart={onSignatureStart}
                onTouchMove={onSignatureMove}
                onTouchEnd={onSignatureEnd}
              />

              <div className="signature-modal-actions">
                <button
                  type="button"
                  className="cs-liquid-button cs-liquid-button--secondary"
                  onClick={() => {
                    onClearSignature();
                    setSignatureModalOpen(false);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="cs-liquid-button"
                  disabled={!signatureData}
                  onClick={() => setSignatureModalOpen(false)}
                >
                  Sign
                </button>
              </div>
            </div>
          </div>
        )}
      </ScreenShell>
    </I18nProvider>
  );
}

