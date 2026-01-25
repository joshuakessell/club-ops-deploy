# App Architecture (Employee Register)

- AppRoot: wiring only (providers + AppComposition). No feature logic or effects.
- AppComposition: top-level orchestration and app bootstrap hooks; composes feature roots.
- Feature roots: domain-specific UI roots (session, navigation, payment, modals, notifications).
- app/state: register state provider + context hook.
- app/hooks: app-wide bootstrap hooks.
- shared/derive: pure derived-state helpers used by state providers and feature roots.
