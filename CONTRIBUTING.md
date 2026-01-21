# Contributing / Engineering Guide

This repository is a TypeScript monorepo (pnpm workspaces + Turborepo). The goal of this guide is to keep changes safe, consistent, and aligned with the product’s source-of-truth docs.

## Scope & Ownership

Actively maintained:
- `services/api`
- `packages/shared`
- `packages/ui`
- `apps/customer-kiosk`
- `apps/employee-register`
- `apps/office-dashboard`

Paused (avoid changes unless explicitly needed):
- `apps/checkout-kiosk`
- `apps/cleaning-station-kiosk`

## Source of Truth (must stay aligned)

These files are authoritative:
- `SPEC.md` (business invariants + pointers only; keep short)
- `openapi.yaml` (API contract)
- `docs/database/DATABASE_SOURCE_OF_TRUTH.md` + `docs/database/DATABASE_ENTITY_DETAILS.md` (DB meaning)
- `db/schema.sql` + `services/api/migrations` (schema snapshot + history)
- `docs/FILE_STRUCTURE.md` (canonical monorepo layout map; keep updated when structure changes)

If code conflicts with these, either:
1) change code to match, or
2) propose a spec change with explicit diffs and justification.

## Security & Correctness Invariants (non‑negotiables)

- Server is authoritative for pricing/eligibility/inventory/assignment.
- No unauthenticated state changes:
  - staff endpoints => `requireAuth` (+ `requireAdmin` where needed)
  - kiosk/customer endpoints => `optionalAuth` + `requireKioskTokenOrStaff`
  - WebSockets must be authenticated (kiosk token or staff)
- Concurrency must be safe (row locks + transactional guarantees).
- Room status transitions must follow policy; overrides require reason + audit log.
- Never run pnpm/node scripts as root; do not use sudo.

## Quality Gates (run before finishing)

From repo root:
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm spec:check`

## Engineering Conventions

- Keep route handlers thin; put business logic in domain modules.
- Prefer shared helpers (`packages/shared`) over duplicated logic across apps/services.
- Avoid “god files”: split modules when they grow too large to review safely.
- Every change that touches business rules needs tests + SPEC/OpenAPI updates.

## Documentation Discipline

- Keep `SPEC.md` as an index; put detailed flows in `docs/specs/*.md` and link from `SPEC.md`.
- Don’t duplicate `openapi.yaml` or DB docs inside `SPEC.md`.

## Repository Layout Discipline

`docs/FILE_STRUCTURE.md` is the canonical layout reference.
- If you add/remove/rename/move any top-level area or major app/package/service, update `docs/FILE_STRUCTURE.md` in the same change.

