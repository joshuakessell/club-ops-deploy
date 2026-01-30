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
      <div className="er-scan-icon" aria-hidden="true">
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
      <div className="er-text-sm er-text-muted u-mt-8">
        {scanReady ? 'Scanner ready' : `Scanner paused: ${scanBlockedReason || 'Unavailable'}`}
      </div>
      {currentSessionId && customerName ? (
        <div className="er-scan-session">
          <div className="er-text-sm er-text-muted u-fw-800">
            Active lane session: <span className="er-text-soft">{customerName}</span>
          </div>
          <button
            type="button"
            className="cs-liquid-button"
            onClick={() => selectHomeTab('account')}
            className="cs-liquid-button er-scan-action-btn"
          >
            Open Customer Account
          </button>
        </div>
      ) : null}
    </PanelShell>
  );
}
