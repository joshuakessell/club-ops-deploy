import { useEffect, useState, type CSSProperties } from 'react';
import { getInstalledTelemetry } from './global.js';
import { getCurrentRoute } from './interactionTelemetry.js';

type Severity = 'info' | 'warning' | 'error';

type ReportIssueButtonProps = {
  flushBreadcrumbsOnInfo?: boolean;
};

const containerStyle: CSSProperties = {
  position: 'fixed',
  bottom: '10px',
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 9999,
  pointerEvents: 'none',
};

const buttonStyle: CSSProperties = {
  pointerEvents: 'auto',
  padding: '6px 12px',
  fontSize: '12px',
  borderRadius: '999px',
  border: '1px solid rgba(255,255,255,0.25)',
  background: 'rgba(0,0,0,0.6)',
  color: '#fff',
};

const panelStyle: CSSProperties = {
  position: 'fixed',
  bottom: '52px',
  left: '50%',
  transform: 'translateX(-50%)',
  width: 'min(520px, 90vw)',
  background: 'rgba(0,0,0,0.85)',
  border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: '12px',
  padding: '12px',
  color: '#fff',
  pointerEvents: 'auto',
};

const textareaStyle: CSSProperties = {
  width: '100%',
  minHeight: '120px',
  background: 'rgba(0,0,0,0.45)',
  color: '#fff',
  border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: '8px',
  padding: '8px',
  resize: 'vertical',
};

const actionsStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '8px',
  marginTop: '10px',
};

const actionButtonStyle: CSSProperties = {
  padding: '6px 12px',
  borderRadius: '8px',
  border: '1px solid rgba(255,255,255,0.2)',
  background: 'rgba(255,255,255,0.08)',
  color: '#fff',
};

export function ReportIssueButton({ flushBreadcrumbsOnInfo = false }: ReportIssueButtonProps): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [severity, setSeverity] = useState<Severity>('info');
  const [screen, setScreen] = useState('unknown');
  const telemetry = getInstalledTelemetry();

  if (!telemetry) return null;

  useEffect(() => {
    if (!open) return;
    const route = getCurrentRoute();
    setScreen(route || 'unknown');
    setSeverity('info');
  }, [open]);

  const isDescriptionValid = text.trim().length > 0;

  const handleSubmit = () => {
    const message = text.trim().slice(0, 2000);
    if (!message) return;

    const ctx = telemetry.getContext();
    const route = getCurrentRoute();
    const resolvedScreen = (screen || route || 'unknown').trim() || 'unknown';
    const shouldDeep = severity === 'warning' || severity === 'error';
    const incidentId = shouldDeep ? telemetry.startIncident('manual_report', { forceNew: true }) : undefined;
    if (shouldDeep || flushBreadcrumbsOnInfo) {
      telemetry.flushBreadcrumbs();
    }

    telemetry.capture({
      spanType: 'incident.report',
      level: 'info',
      name: 'User Report',
      message,
      incidentId,
      incidentReason: shouldDeep ? 'manual_report' : undefined,
      meta: {
        severity,
        screen: resolvedScreen,
        route: ctx.route,
        app: ctx.app,
        deviceId: ctx.deviceId,
        sessionId: ctx.sessionId,
        traceId: ctx.traceId,
        ui: { source: 'report_button' },
      },
    });
    telemetry.flush();
    setOpen(false);
    setText('');
  };

  return (
    <>
      <div style={containerStyle}>
        <button style={buttonStyle} onClick={() => setOpen(true)}>
          Report Issue
        </button>
      </div>
      {open && (
        <div style={panelStyle}>
          <div style={{ fontSize: '13px', marginBottom: '6px' }}>Describe the issue</div>
          <div style={{ display: 'grid', gap: '8px', marginBottom: '8px' }}>
            <label style={{ fontSize: '12px' }}>
              Severity
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as Severity)}
                style={{
                  display: 'block',
                  width: '100%',
                  marginTop: '4px',
                  padding: '6px 8px',
                  borderRadius: '6px',
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: 'rgba(0,0,0,0.45)',
                  color: '#fff',
                }}
              >
                <option value="info">info</option>
                <option value="warning">warning</option>
                <option value="error">error</option>
              </select>
            </label>
            <label style={{ fontSize: '12px' }}>
              What screen were you on?
              <input
                value={screen}
                onChange={(e) => setScreen(e.target.value)}
                style={{
                  display: 'block',
                  width: '100%',
                  marginTop: '4px',
                  padding: '6px 8px',
                  borderRadius: '6px',
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: 'rgba(0,0,0,0.45)',
                  color: '#fff',
                }}
                placeholder="unknown"
              />
            </label>
          </div>
          <textarea
            style={textareaStyle}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What happened?"
          />
          <div style={actionsStyle}>
            <button style={actionButtonStyle} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button style={actionButtonStyle} onClick={handleSubmit} disabled={!isDescriptionValid}>
              Submit
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/*
Manual test steps:
1) Open Report Issue -> severity defaults to info, screen prefilled with route.
2) Submit disabled until description has content; message truncates at 2000 chars.
3) severity warning/error triggers incident capture + breadcrumb flush.
4) severity info only flushes breadcrumbs when VITE_TELEMETRY_REPORT_FLUSH_BREADCRUMBS_ON_INFO=true.
*/
