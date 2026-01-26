# App Architecture (Office Dashboard)

- AppRoot: wiring only (providers + AppComposition). No feature logic or effects.
- AppProviders: app-wide providers (theme, CssBaseline, error boundary).
- AppComposition: top-level orchestration (session bootstrap, auth gating, routing).
- OfficeShell: authenticated layout chrome (sidebar + topbar).
- views: standardized view shells with co-located CSS (panel layouts, headers, cards).
- View modules (Overview, Monitor, Reports, etc.) are route-level features.
