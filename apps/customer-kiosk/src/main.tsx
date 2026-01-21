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
const apiBaseUrl =
  typeof rawEnv.VITE_API_BASE_URL === 'string' && rawEnv.VITE_API_BASE_URL.trim()
    ? rawEnv.VITE_API_BASE_URL.trim()
    : null;
if (!kioskToken) {
  const err = new Error('Missing required env var VITE_KIOSK_TOKEN (customer-kiosk).');
  createRoot(root).render(<FatalEnvScreen message={err.message} />);
  queueMicrotask(() => {
    throw err;
  });
} else if (import.meta.env.PROD && !apiBaseUrl) {
  const err = new Error(
    'Missing required env var VITE_API_BASE_URL. This must point to the API host (Render) so WebSockets connect to the backend instead of the Vercel site origin.'
  );
  createRoot(root).render(<FatalEnvScreen message={err.message} />);
  queueMicrotask(() => {
    throw err;
  });
} else {
  installTelemetry({
    app: 'customer-kiosk',
    endpoint: getApiUrl('/api/v1/telemetry'),
    isDev: import.meta.env.DEV,
    captureConsoleWarnInDev: true,
    getLane: () => sessionStorage.getItem('lane') ?? undefined,
  });

  createRoot(root).render(
    <StrictMode>
      <TelemetryErrorBoundary>
        <OrientationGuard
          required="portrait"
          title="Rotate iPad"
          message="This screen must be used in portrait mode."
        >
          <App />
        </OrientationGuard>
      </TelemetryErrorBoundary>
    </StrictMode>
  );
}
