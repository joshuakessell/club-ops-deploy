// AppRoot guardrails:
// - No business logic or feature-specific logic.
// - No effects, subscriptions, or listeners.
// - No feature imports; only app wiring.
// - Keep this file small (≈100 lines max).
import { AppProviders } from './AppProviders';
import { AppComposition } from './AppComposition';

export function AppRoot() {
  return (
    <AppProviders>
      <AppComposition />
    </AppProviders>
  );
}
