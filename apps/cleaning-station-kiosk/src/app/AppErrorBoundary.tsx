import React from 'react';

type Props = {
  children: React.ReactNode;
  fallback?: React.ReactNode;
};

type State = {
  hasError: boolean;
  error?: unknown;
};

export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: unknown) {
    // Keep console logging; if you have telemetry, wire it here later.
    console.error('App crashed:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
            <h2 style={{ marginTop: 0 }}>Something went wrong</h2>
            <p>Please reload the page. If the issue persists, contact support.</p>
            <button onClick={() => window.location.reload()}>Reload</button>
          </div>
        )
      );
    }

    return this.props.children;
  }
}
