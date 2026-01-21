import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { installTelemetry, TelemetryErrorBoundary } from '@club-ops/ui';
import App from './App';
import '@club-ops/ui/styles/index.css';
import './styles.css';
import { OrientationGuard } from './ui/orientation/OrientationGuard';
import './ui/orientation/orientation.css';
import { FatalEnvScreen } from './components/FatalEnvScreen';
import { getApiUrl } from '@/lib/apiBase';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

const rawEnv = import.meta.env as unknown as Record<string, unknown>;
const kioskToken =
  typeof rawEnv.VITE_KIOSK_TOKEN === 'string' && rawEnv.VITE_KIOSK_TOKEN.trim()
    ? rawEnv.VITE_KIOSK_TOKEN.trim()
    : null;
if (!kioskToken) {
  const err = new Error('Missing required env var VITE_KIOSK_TOKEN (employee-register).');
  createRoot(root).render(<FatalEnvScreen message={err.message} />);
  queueMicrotask(() => {
    throw err;
  });
} else {
  installTelemetry({
    app: 'employee-register',
    endpoint: getApiUrl('/api/v1/telemetry'),
    isDev: import.meta.env.DEV,
    captureConsoleWarnInDev: true,
    getLane: () => sessionStorage.getItem('lane') ?? undefined,
  });

  createRoot(root).render(
    <StrictMode>
      <TelemetryErrorBoundary>
        <OrientationGuard
          required="landscape"
          title="Rotate iPad"
          message="This screen must be used in landscape mode."
        >
          <App />
        </OrientationGuard>
      </TelemetryErrorBoundary>
    </StrictMode>
  );
}
