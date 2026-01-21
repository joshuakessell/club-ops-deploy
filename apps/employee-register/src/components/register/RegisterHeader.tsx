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
  onCloseOut: () => void;
}

export function RegisterHeader({
  health,
  wsConnected,
  lane,
  staffName,
  staffRole,
  onSignOut,
  onCloseOut,
}: RegisterHeaderProps) {
  return (
    <header
      className="header er-surface-strong"
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '1rem',
        flexWrap: 'nowrap',
        padding: '0.75rem 1.5rem',
        marginBottom: '1.5rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <h1 className="er-title" style={{ margin: 0 }}>
          Employee Register
        </h1>
        <div
          className="status-badges"
          style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}
        >
          <span
            className={`cs-badge ${health?.status === 'ok' ? 'cs-badge--success' : 'cs-badge--error'}`}
          >
            API: {health?.status ?? '...'}
          </span>
          <span className={`cs-badge ${wsConnected ? 'cs-badge--success' : 'cs-badge--error'}`}>
            WS: {wsConnected ? 'Live' : 'Offline'}
          </span>
          <span className="cs-badge cs-badge--info">Lane: {lane}</span>
          <span className="cs-badge cs-badge--info">
            {staffName} ({staffRole})
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginLeft: 'auto' }}>
        <button
          onClick={() => void onSignOut()}
          className="cs-liquid-button cs-liquid-button--secondary er-header-action-btn"
        >
          Sign Out
        </button>
        <button
          onClick={() => void onCloseOut()}
          className="cs-liquid-button cs-liquid-button--danger er-header-action-btn"
        >
          Close Out
        </button>
      </div>
    </header>
  );
}

