## CI and Deployment Rules

- All production deployments are triggered automatically by GitHub.
- Vercel auto-deploys frontend apps on commit to main.
- Render auto-deploys the API service on commit to main.

Agents MUST NOT:

- Add deploy scripts or platform-specific deployment code
- Modify Vercel or Render behavior in code
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
