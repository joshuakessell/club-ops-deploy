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
          style={{
            padding: '0.375rem 0.75rem',
            background: 'rgba(239, 68, 68, 0.2)',
            border: '1px solid var(--error)',
            borderRadius: '9999px',
            color: 'var(--error)',
            fontSize: '0.75rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Sign Out
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <button
          className={showUpgradePulse && hasEligibleEntries ? 'gold-pulse' : undefined}
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
            background: waitlistInteractive ? '#fef3c7' : '#1f2937',
            border: `1px solid ${waitlistInteractive ? '#f59e0b' : '#334155'}`,
            borderRadius: '9999px',
            color: waitlistInteractive ? '#92400e' : '#94a3b8',
            fontWeight: 700,
            cursor: waitlistInteractive ? 'pointer' : 'not-allowed',
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

