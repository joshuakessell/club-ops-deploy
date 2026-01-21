import { AppProviders } from './app/AppProviders';
import { AppRoot } from './app/AppRoot';
import { useEffect } from 'react';
import { closeAllLaneSessionClients } from '@club-ops/shared';

// Keep global CSS import here if this app previously imported it in App.tsx.
// If this app's CSS is imported elsewhere (main.tsx), do nothing.
// Example:
// import './styles.css';

export default function App() {
  useEffect(() => {
    return () => {
      closeAllLaneSessionClients();
    };
  }, []);

  return (
    <AppProviders>
      <AppRoot />
    </AppProviders>
  );
}
