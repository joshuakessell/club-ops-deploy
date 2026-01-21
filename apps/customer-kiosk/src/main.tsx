import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { installTelemetry, TelemetryErrorBoundary } from '@club-ops/ui';
import App from './App';
import '@club-ops/ui/styles/index.css';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

function FatalEnvScreen({ message }: { message: string }) {
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 720 }}>
      <h1 style={{ margin: 0, fontSize: 22 }}>Fatal configuration error</h1>
      <p style={{ marginTop: 12, lineHeight: 1.5 }}>{message}</p>
      <pre style={{ marginTop: 12, padding: 12, background: '#111', color: '#fff', borderRadius: 8 }}>
        {'Required: VITE_KIOSK_TOKEN\nFix: set it in your .env / env vars and restart dev server.'}
      </pre>
    </div>
  );
}

const rawEnv = import.meta.env as unknown as Record<string, unknown>;
const kioskToken =
  typeof rawEnv.VITE_KIOSK_TOKEN === 'string' && rawEnv.VITE_KIOSK_TOKEN.trim()
    ? rawEnv.VITE_KIOSK_TOKEN.trim()
    : null;
if (!kioskToken) {
  const err = new Error('Missing required env var VITE_KIOSK_TOKEN (customer-kiosk).');
  createRoot(root).render(<FatalEnvScreen message={err.message} />);
  queueMicrotask(() => {
    throw err;
  });
} else {
  installTelemetry({
    app: 'customer-kiosk',
    endpoint: '/api/v1/telemetry',
    isDev: import.meta.env.DEV,
    captureConsoleWarnInDev: true,
    getLane: () => sessionStorage.getItem('lane') ?? undefined,
  });

  createRoot(root).render(
    <StrictMode>
      <TelemetryErrorBoundary>
        <App />
      </TelemetryErrorBoundary>
    </StrictMode>
  );
}
