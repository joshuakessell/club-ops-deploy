import { SuccessToast } from '../../components/register/toasts/SuccessToast';
import { BottomToastStack } from '../../components/register/toasts/BottomToastStack';
import { useEmployeeRegisterState } from '../../app/state/useEmployeeRegisterState';

export function NotificationsRoot() {
  const {
    scanOverlayMounted,
    scanOverlayActive,
    scanToastMessage,
    setScanToastMessage,
    successToastMessage,
    setSuccessToastMessage,
    bottomToasts,
    dismissBottomToast,
  } = useEmployeeRegisterState();

  return (
    <>
      {scanOverlayMounted && (
        <div
          className={[
            'er-scan-processing-overlay',
            scanOverlayActive ? 'er-scan-processing-overlay--active' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-hidden="true"
        >
          <div className="er-scan-processing-card cs-liquid-card">
            <span className="er-spinner" aria-hidden="true" />
            <span className="er-scan-processing-text">Scanning…</span>
          </div>
        </div>
      )}

      <SuccessToast message={successToastMessage} onDismiss={() => setSuccessToastMessage(null)} />
      <BottomToastStack toasts={bottomToasts} onDismiss={dismissBottomToast} />

      {scanToastMessage && (
        <div
          className="er-scan-toast-overlay"
          role="status"
          aria-label="Scan message"
          onClick={() => setScanToastMessage(null)}
        >
          <div
            className="cs-liquid-card er-scan-toast-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="er-scan-toast-header">
              <div className="er-scan-toast-title">Scan</div>
              <button
                onClick={() => setScanToastMessage(null)}
                className="cs-liquid-button cs-liquid-button--secondary er-scan-toast-dismiss"
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
            <div className="er-scan-toast-message">{scanToastMessage}</div>
          </div>
        </div>
      )}
    </>
  );
}
