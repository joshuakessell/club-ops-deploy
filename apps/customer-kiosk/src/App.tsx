import { AppProviders } from './app/AppProviders';
import { AppRoot } from './app/AppRoot';

// Keep global CSS import here if this app previously imported it in App.tsx.
// If this app's CSS is imported elsewhere (main.tsx), do nothing.
// Example:
// import './styles.css';

export default function App() {
  return (
    <AppProviders>
      <AppRoot />
    </AppProviders>
  );
}
