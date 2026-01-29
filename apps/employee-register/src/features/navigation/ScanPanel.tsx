import { useEmployeeRegisterState } from '../../app/state/useEmployeeRegisterState';
import { PanelHeader } from '../../views/PanelHeader';
import { PanelShell } from '../../views/PanelShell';

export function ScanPanel() {
  const {
    currentSessionId,
    customerName,
    selectHomeTab,
    scanReady,
    scanBlockedReason,
    scanInputRef,
    scanInputHandlers,
    scanInputEnabled,
  } = useEmployeeRegisterState();

  return (
    <PanelShell align="center">
      <div style={{ fontSize: '4rem', lineHeight: 1, marginBottom: '0.5rem' }} aria-hidden="true">
        📷
      </div>
      <PanelHeader
        align="center"
        spacing="sm"
        title="Scan Now"
        subtitle="Scan a membership ID or driver license."
      />
      <textarea
        ref={scanInputRef}
        className="er-scan-input"
        aria-hidden="true"
        tabIndex={-1}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        inputMode="none"
        disabled={!scanInputEnabled}
        {...scanInputHandlers}
      />
      <div className="er-text-sm" style={{ marginTop: '0.5rem', color: '#94a3b8' }}>
        {scanReady ? 'Scanner ready' : `Scanner paused: ${scanBlockedReason || 'Unavailable'}`}
      </div>
      {currentSessionId && customerName ? (
        <div style={{ marginTop: '1rem', display: 'grid', gap: '0.5rem' }}>
          <div className="er-text-sm" style={{ color: '#94a3b8', fontWeight: 800 }}>
            Active lane session: <span style={{ color: '#e2e8f0' }}>{customerName}</span>
          </div>
          <button
            type="button"
            className="cs-liquid-button"
            onClick={() => selectHomeTab('account')}
            style={{ width: '100%', padding: '0.75rem', fontWeight: 900 }}
          >
            Open Customer Account
          </button>
        </div>
      ) : null}
    </PanelShell>
  );
}
