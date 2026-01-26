# App Architecture (Customer Kiosk)

- AppRoot: wiring only (providers + AppComposition). No feature logic or effects.
- AppProviders: app-wide providers (error boundary).
- AppComposition: top-level orchestration for the kiosk flow + bootstrap effects.
- screens: stateful flow screens (idle, language, selection, payment, agreement, completion).
- components: shared UI building blocks and modals.
- views: standardized view shells with co-located CSS (cards, modals, banners, buttons).
- utils/lib: pure helpers (formatting, membership state, data transforms).
- i18n: localization strings and helpers.
