import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { installTelemetry, TelemetryErrorBoundary } from '@club-ops/ui';
import App from './App';
import '@club-ops/ui/src/styles/tokens.css';
import './blink.css';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

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
