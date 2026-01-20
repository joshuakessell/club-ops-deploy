import type { ReactNode } from 'react';
import React from 'react';
import { getInstalledTelemetry } from './global.js';

export class TelemetryErrorBoundary extends React.Component<{ children: ReactNode }> {
  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    try {
      const telemetry = getInstalledTelemetry();
      telemetry?.capture({
        level: 'error',
        kind: 'react.error',
        message: error.message,
        stack: error.stack,
        meta: { componentStack: info.componentStack },
      });
    } catch {
      // ignore
    }
  }

  override render(): ReactNode {
    return this.props.children;
  }
}

