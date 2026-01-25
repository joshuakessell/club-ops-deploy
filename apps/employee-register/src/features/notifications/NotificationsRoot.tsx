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
            <span className="er-scan-processing-text">Processing scan…</span>
          </div>
        </div>
      )}

      <SuccessToast message={successToastMessage} onDismiss={() => setSuccessToastMessage(null)} />
      <BottomToastStack toasts={bottomToasts} onDismiss={dismissBottomToast} />

      {scanToastMessage && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
            zIndex: 2000,
          }}
          role="status"
          aria-label="Scan message"
          onClick={() => setScanToastMessage(null)}
        >
          <div
            className="cs-liquid-card"
            style={{
              width: 'min(520px, 92vw)',
              background: '#0f172a',
              color: 'white',
              padding: '1rem',
              borderRadius: '12px',
              border: '1px solid rgba(148, 163, 184, 0.18)',
              boxShadow: '0 10px 30px rgba(0, 0, 0, 0.45)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
              <div style={{ fontWeight: 900 }}>Scan</div>
              <button
                onClick={() => setScanToastMessage(null)}
                className="cs-liquid-button cs-liquid-button--secondary"
                style={{ padding: '0.2rem 0.55rem' }}
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
            <div style={{ marginTop: '0.5rem', color: '#cbd5e1', fontWeight: 700 }}>
              {scanToastMessage}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
