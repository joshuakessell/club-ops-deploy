import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  installTelemetry,
  setCurrentRouteProvider,
  TelemetryErrorBoundary,
} from '@club-ops/ui';
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
  const readBool = (value: unknown, fallback: boolean) => {
    if (typeof value !== 'string') return fallback;
    const v = value.trim().toLowerCase();
    if (!v) return fallback;
    return v === 'true' || v === '1' || v === 'yes';
  };
  const readNumber = (value: unknown, fallback: number) => {
    if (typeof value !== 'string') return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };

  setCurrentRouteProvider(() => {
    if (typeof window === 'undefined') return 'unknown';
    return `${window.location.pathname || '/'}${window.location.search || ''}`;
  });

  installTelemetry({
    app: 'customer-kiosk',
    endpoint: getApiUrl('/api/v1/telemetry'),
    isDev: import.meta.env.DEV,
    getLane: () => sessionStorage.getItem('lane') ?? undefined,
    breadcrumbsEnabled: readBool(rawEnv.VITE_TELEMETRY_BREADCRUMBS, true),
    deepOnWarn: readBool(rawEnv.VITE_TELEMETRY_DEEP_ON_WARN, true),
    deepOnError: readBool(rawEnv.VITE_TELEMETRY_DEEP_ON_ERROR, true),
    deepWindowMs: readNumber(rawEnv.VITE_TELEMETRY_DEEP_WINDOW_MS, 60000),
    breadcrumbLimit: readNumber(rawEnv.VITE_TELEMETRY_BREADCRUMB_LIMIT, 200),
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
