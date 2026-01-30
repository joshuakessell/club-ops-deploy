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
    <header className="header er-surface-strong er-register-header">
      <div className="er-register-header__left">
        <h1 className="er-title u-mt-0 u-mb-0">
          Employee Register
        </h1>
        <div className="status-badges er-register-header__badges">
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

      <div className="er-register-header__actions">
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
