interface HealthStatus {
  status: string;
  timestamp: string;
  uptime: number;
}

export interface RegisterHeaderProps {
  health: HealthStatus | null;
  wsConnected: boolean;
  lane: string;
  staffName: string;
  staffRole: 'STAFF' | 'ADMIN';
  onSignOut: () => void;

  waitlistInteractive: boolean;
  waitlistWidgetOpen: boolean;
  waitlistDisplayNumber: string;
  showUpgradePulse: boolean;
  hasEligibleEntries: boolean;
  onToggleWaitlistWidget: () => void;
  dismissUpgradePulse: () => void;
}

export function RegisterHeader({
  health,
  wsConnected,
  lane,
  staffName,
  staffRole,
  onSignOut,
  waitlistInteractive,
  waitlistWidgetOpen,
  waitlistDisplayNumber,
  showUpgradePulse,
  hasEligibleEntries,
  onToggleWaitlistWidget,
  dismissUpgradePulse,
}: RegisterHeaderProps) {
  return (
    <header
      className="header"
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '1rem',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>Employee Register</h1>
        <div
          className="status-badges"
          style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}
        >
          <span
            className={`badge ${health?.status === 'ok' ? 'badge-success' : 'badge-error'}`}
          >
            API: {health?.status ?? '...'}
          </span>
          <span className={`badge ${wsConnected ? 'badge-success' : 'badge-error'}`}>
            WS: {wsConnected ? 'Live' : 'Offline'}
          </span>
          <span className="badge badge-info">Lane: {lane}</span>
          <span className="badge badge-info">
            {staffName} ({staffRole})
          </span>
        </div>
        <button
          onClick={() => void onSignOut()}
          className="cs-liquid-button cs-liquid-button--danger"
          style={{ padding: '0.375rem 0.75rem' }}
        >
          Sign Out
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <button
          className={[
            'cs-liquid-button',
            'cs-liquid-button--secondary',
            waitlistWidgetOpen ? 'cs-liquid-button--selected' : '',
            showUpgradePulse && hasEligibleEntries ? 'gold-pulse' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={() => {
            if (!waitlistWidgetOpen) dismissUpgradePulse();
            onToggleWaitlistWidget();
          }}
          disabled={!waitlistInteractive}
          aria-label="Waitlist widget"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            padding: '0.45rem 0.75rem',
            fontWeight: 700,
            minWidth: '110px',
            justifyContent: 'center',
          }}
        >
          <span role="img" aria-label="waitlist clock">
            ⏰
          </span>
          <span>{waitlistDisplayNumber}</span>
        </button>
      </div>
    </header>
  );
}

