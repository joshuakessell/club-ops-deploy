# Monorepo File Structure (Canonical Reference)

This file is the **canonical, human-maintained** map of the repository layout.

## Rules (for all contributors)

- If you **add, remove, rename, or move** any top-level area (apps/packages/services/docs/db/scripts/tools/infra), you **must** update this file in the same change.
- If you add a **new app/package/service** (or a new major sub-area under an existing one), you **must** add it here with a 1–2 line description.
- Keep this doc **stable and skim-friendly**:
  - Do **not** list `node_modules/`, `dist/`, build artifacts, or generated files.
  - Prefer describing “what lives here” over enumerating every file.

## Top-level layout

```
agents.md                  # Agent CI/deploy rules + code-writing docs index
CONTRIBUTING.md            # Engineering guide (scope, non-negotiables, quality gates)
SPEC.md                    # Business invariants + pointers (keep short)
openapi.yaml               # API contract (source of truth)
db/                        # Schema snapshot + database assets
docs/                      # Human docs (specs, database meaning, QA, demos)
apps/                      # Frontend kiosk/dashboard apps (Vite/React)
packages/                  # Shared libraries used across apps/services
services/                  # Backend services (API, jobs, etc.)
scripts/                   # Repo automation/dev scripts
tools/                     # One-off tooling (e.g., RAG utilities)
infra/                     # Deployment/infra config
artifacts/                 # Non-source artifacts (e.g., telemetry outputs)
```

## apps/

Customer- and staff-facing UIs (generally Vite + React).

```
apps/
  customer-kiosk/          # Customer-facing kiosk UI
  employee-register/       # Staff register UI (sign-in, register workflows)
  office-dashboard/        # Admin/office dashboard UI
```

## packages/

Shared TypeScript packages consumed by multiple apps/services.

```
packages/
  shared/                  # Shared types, realtime schemas, domain helpers used across repo
  ui/                      # Shared UI primitives/styles used by apps
  app-kit/                 # App scaffolding/utilities (build/runtime helpers)
```

## services/

Backend runtime(s).

```
services/
  api/                     # Main API service (HTTP + realtime/websocket)
```

## docs/

Long-form docs and specs. Keep `SPEC.md` as an index and put details here.

```
docs/
  database/                # DB meaning + entity details (source of truth for semantics)
  specs/                   # Feature specs (long-form); link from SPEC.md as needed
  demo/                    # Demo/smoke-test notes and reports
```
