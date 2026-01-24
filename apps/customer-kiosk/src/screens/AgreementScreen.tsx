import { ReactNode, RefObject, useEffect, useMemo, useState } from 'react';
import { I18nProvider, t, type Language } from '../i18n';
import { ScreenShell } from '../components/ScreenShell';

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
  onSignatureStart: (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => void;
  onSignatureMove: (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => void;
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

  const pulseSignButton = useMemo(() => {
    if (isSubmitting) return false;
    if (!hasScrolledAgreement) return false;
    return agreed && !signatureData;
  }, [agreed, hasScrolledAgreement, isSubmitting, signatureData]);

  const pulseSubmitButton = useMemo(() => {
    if (isSubmitting) return false;
    if (!hasScrolledAgreement) return false;
    return agreed && Boolean(signatureData);
  }, [agreed, hasScrolledAgreement, isSubmitting, signatureData]);

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
          {/* Liquid-glass panel */}
          <div className="agreement-paper-panel cs-liquid-card">
            <h1 className="agreement-title">
              {agreement?.title || t(customerPrimaryLanguage, 'agreementTitle')}
            </h1>

            {/* Scroll region (must flex) */}
            <div className="ck-agreement-scroll-region">
              {!hasScrolledAgreement && (
                <div className="ck-glow-text ck-agreement-helper-text">
                  {t(customerPrimaryLanguage, 'agreement.readAndScrollToContinue')}
                </div>
              )}

              <div className="ck-agreement-scroll-shell">
                <div className="ck-arrow-slot" aria-hidden="true">
                  {!hasScrolledAgreement && (
                    <div className="ck-arrow ck-arrow--down ck-arrow--bounce-y">↓</div>
                  )}
                </div>

                <div className="agreement-scroll-wrap">
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

                <div className="ck-arrow-slot" aria-hidden="true">
                  {!hasScrolledAgreement && (
                    <div className="ck-arrow ck-arrow--down ck-arrow--bounce-y">↓</div>
                  )}
                </div>
              </div>

              {!hasScrolledAgreement && (
                <div className="ck-glow-text ck-agreement-helper-text ck-agreement-helper-text--bottom">
                  {t(customerPrimaryLanguage, 'agreement.readAndScrollToContinue')}
                </div>
              )}
            </div>

            <div className="agreement-actions">
              {/* Checkbox step */}
              <div className="ck-action-row">
                <div className="ck-action-indicator" aria-hidden="true">
                  {hasScrolledAgreement && !agreed && (
                    <div className="ck-arrow ck-arrow--checkbox ck-arrow--bounce-x">▶</div>
                  )}
                </div>
                <div className="ck-action-content ck-action-content--checkbox">
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
              </div>

              {!hasScrolledAgreement && (
                <p className="scroll-warning">{t(customerPrimaryLanguage, 'scrollRequired')}</p>
              )}

              {hasScrolledAgreement && !agreed && (
                <div className="ck-glow-text ck-checkbox-helper-text">
                  {t(customerPrimaryLanguage, 'agreement.pleaseCheckToContinue')}
                </div>
              )}

              {/* Signature step (arrow moves here after checkbox is checked) */}
              <div className="ck-action-row">
                <div className="ck-action-indicator" aria-hidden="true">
                  {hasScrolledAgreement && agreed && !signatureData && !isSubmitting && (
                    <div className="ck-arrow ck-arrow--checkbox ck-arrow--bounce-x">▶</div>
                  )}
                </div>
                <div className="ck-action-content ck-action-content--center">
                  <button
                    type="button"
                    className={[
                      'cs-liquid-button',
                      'agreement-signature-button',
                      pulseSignButton ? 'pulse-bright' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => setSignatureModalOpen(true)}
                    disabled={!hasScrolledAgreement || !!signatureData}
                  >
                    {signatureData ? (
                      <span className="agreement-signature-button__content">
                        <span className="agreement-signature-check" aria-hidden="true">
                          ✓
                        </span>
                        <span>{t(customerPrimaryLanguage, 'agreement.signed')}</span>
                      </span>
                    ) : (
                      t(customerPrimaryLanguage, 'agreement.tapToSign')
                    )}
                  </button>
                </div>
              </div>

              <div className="agreement-submit-container">
                <button
                  className={[
                    'cs-liquid-button',
                    'submit-agreement-btn',
                    pulseSubmitButton ? 'pulse-bright' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
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
            aria-label={t(customerPrimaryLanguage, 'a11y.signatureDialog')}
            onClick={() => setSignatureModalOpen(false)}
          >
            <div className="signature-modal cs-liquid-card" onClick={(e) => e.stopPropagation()}>
              <div className="signature-modal-header">
                <div className="signature-modal-title">
                  {t(customerPrimaryLanguage, 'signatureRequired')}
                </div>
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
                  {t(customerPrimaryLanguage, 'common.cancel')}
                </button>
                <button
                  type="button"
                  className="cs-liquid-button"
                  disabled={!signatureData}
                  onClick={() => setSignatureModalOpen(false)}
                >
                  {t(customerPrimaryLanguage, 'agreement.sign')}
                </button>
              </div>
            </div>
          </div>
        )}
      </ScreenShell>
    </I18nProvider>
  );
}
