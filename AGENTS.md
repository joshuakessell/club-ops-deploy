# Agent Instructions (Club Dallas POS Upgrade)

## Scope
Actively maintained:
- services/api
- packages/shared
- packages/ui
- apps/customer-kiosk
- apps/employee-register
- apps/office-dashboard

Paused (do not modify unless explicitly requested):
- apps/checkout-kiosk
- apps/cleaning-station-kiosk

## Source of truth (must stay aligned)
- SPEC.md (business invariants + pointers only)
- openapi.yaml (API contract)
- docs/database/DATABASE_SOURCE_OF_TRUTH.md + DATABASE_ENTITY_DETAILS.md (DB meaning)
- db/schema.sql + services/api/migrations (schema history + snapshot)
- docs/FILE_STRUCTURE.md (canonical monorepo layout map; keep updated when structure changes)

If code conflicts with these, either:
1) change code to match, or
2) propose a spec change with explicit diffs and justification.

## Non‑negotiables
- Server is authoritative for pricing/eligibility/inventory/assignment
- No unauthenticated state changes:
  - staff endpoints => requireAuth (+ requireAdmin where needed)
  - kiosk/customer endpoints => optionalAuth + requireKioskTokenOrStaff
  - WebSockets must be authenticated (kiosk token or staff)
- Concurrency must be safe (row locks + transactional guarantees)
- Room status transitions must follow policy; overrides require reason + audit log
- Never run pnpm/node scripts as root; do not use sudo

## Quality gates (run before finishing)
From repo root:
- pnpm lint
- pnpm typecheck
- pnpm test
- pnpm spec:check

## Engineering conventions
- Keep route handlers thin; put business logic in domain modules
- Prefer shared helpers (packages/shared) over duplicated logic across apps/services
- Avoid “god files”: split modules when they grow too large to review safely
- Every change that touches business rules needs tests + SPEC/openapi updates

## Documentation discipline (keep files small)
- SPEC.md and AGENTS.md should remain short and stable
- Put detailed flows in docs/specs/*.md and link from SPEC.md
- Don’t duplicate openapi.yaml or DB docs inside SPEC.md

## Monorepo structure requirement (for all agents)
- `docs/FILE_STRUCTURE.md` is the **canonical** repository layout reference used by ChatGPT/agents.
- Any change that **adds/moves/renames** a top-level area or a major app/package/service **must** update `docs/FILE_STRUCTURE.md` in the same PR.
