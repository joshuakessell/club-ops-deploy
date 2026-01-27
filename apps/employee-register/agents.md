# Employee Register Agent Constraints

These rules are mechanically verifiable and must be enforced for this app.

## AppRoot constraints

- `src/app/AppRoot.tsx` must remain under 100 lines.
- AppRoot contains **no business logic** and **no feature-specific imports**.
- AppRoot contains **no effects, subscriptions, or listeners**.
- AppRoot only wires providers and `AppComposition`.

## AppComposition constraints

- `src/app/AppComposition.tsx` composes feature roots and app-wide providers.
- No business logic inside AppComposition (orchestration only).

## Feature root constraints

- One root per domain under `src/features/<domain>/`.
- File names must be domain-specific (e.g. `SessionRoot.tsx`).
- Forbidden names: `FeatureRoot.tsx`, `Root.tsx` (without a domain prefix), `MainFeature.tsx`, `AppFeature.tsx`.
- **At least three** distinct feature roots must exist when the app supports it.
- Feature roots may not import from other feature folders.
- Any feature root **over 250 lines** must be split.

## Hook constraints

- Any hook **over 150 lines** must be split into smaller hooks/helpers.

## File size + organization

- No file under `src/` may exceed 400 lines without explicit approval.
- `src/app/state/EmployeeRegisterStateProvider.tsx` must remain under 250 lines and only compose smaller providers/hooks.
- Keep register state split across `src/app/state/slices/` (no reconsolidation into a single monolith).
- Organize by domain: group related state, hooks, UI, and utilities together (avoid cross-domain "grab bag" folders).

## Docs + structure

- If structure changes, update `docs/FILE_STRUCTURE.md` and `apps/employee-register/src/app/ARCHITECTURE.md` as needed.
