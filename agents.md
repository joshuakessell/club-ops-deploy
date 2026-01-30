## CI and Deployment Rules

- Production deployments are currently paused; local testing is the source of truth.
- Vercel and Render are no longer used (services cancelled).
- AWS deployment approach is in progress and should be documented here once finalized.

Agents MUST NOT:

- Add deploy scripts or platform-specific deployment code
- Modify deployment platform behavior or infrastructure code without an explicit request
- Add GitHub Actions that perform deployments

Agents MUST:

- Use Turbo for builds (pnpm turbo run ...)
- Ensure pnpm build and typecheck pass before committing
- Keep API build output deterministic at dist/index.js

## Code-Writing Docs (Index)

- `CONTRIBUTING.md` — engineering guide, quality gates, and repo conventions
- `SPEC.md` — business invariants; code must align with this index
- `docs/FILE_STRUCTURE.md` — canonical repo layout; update when structure changes
- `docs/database/DATABASE_SOURCE_OF_TRUTH.md` — database meaning and invariants (canonical)
- `docs/database/DATABASE_ENTITY_DETAILS.md` — entity contracts and field semantics (canonical)
- `apps/employee-register/src/app/ARCHITECTURE.md` — employee-register app layering and ownership rules
- `apps/customer-kiosk/src/app/ARCHITECTURE.md` — customer-kiosk app layering and ownership rules
- `apps/office-dashboard/src/app/ARCHITECTURE.md` — office-dashboard app layering and ownership rules

## File Size + Organization Rules

- Avoid bloated source files: no file under `apps/**/src` may exceed 400 lines without explicit approval.
- Prefer feature/domain folders; co-locate related state, hooks, UI, and utilities for the same responsibility.
- Split by single responsibility; avoid "god files" that centralize unrelated concerns.
