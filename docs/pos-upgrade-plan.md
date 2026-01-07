# Club Dallas POS Upgrade — Initial Plan (Minimal Disruption)

## Goals & Guardrails
- Preserve revenue-critical flows (selection → quote → payment intent → mark paid → assignment → checkout) with no behavioral drift.
- Keep downtime near-zero via feature flags and backwards-compatible rollout.
- Align with canonical sources: `SPEC.md`, `openapi.yaml`, `docs/database/**`, `db/schema.sql`.
- Avoid schema churn unless required; every change must include a rollback path.

## Current Snapshot (based on quick scan)
- Backend: Fastify API (`services/api/src/index.ts`) with WebSocket broadcaster; lane check-in + payment intent handling in `routes/checkin.ts`; checkout verification and late-fee gating in `routes/checkout.ts`.
- Clients: Vite apps for customer kiosk, employee register, cleaning station, checkout kiosk, and office dashboard under `apps/`.
- Shared contracts: enums/schemas in `packages/shared`; pricing engine in `services/api/src/pricing/engine.ts`.
- State transitions: checkout completion forces items_confirmed + fee_paid and flips rooms to DIRTY / lockers to CLEAN before broadcasting inventory updates.

## Ordered Plan (why this order)
1) **Baselines & Contract Audit** — Verify current endpoints vs `openapi.yaml`, DB invariants vs `db/schema.sql`/`docs/database/**`, and lane/checkout flows vs `SPEC.md` to ensure upgrades start from a known-good baseline.
2) **Stabilize Revenue Flows** — Map and gate the payment intent + mark-paid + checkout completion paths behind feature flags/toggles to allow safe canarying without behavior changes.
3) **Observability First** — Add structured logs/metrics around payment intent state changes, late-fee application, and WebSocket broadcasts to detect regressions quickly.
4) **Resilience & Concurrency Hardening** — Double-check serializable transactions/row locks in check-in, assignment, and checkout flows; add retries/timeout handling where missing to prevent double-booking or stuck states.
5) **Front-End Parity & UX Hygiene** — Ensure kiosks/register reflect the server source-of-truth (no optimistic assumptions); keep UI changes behind flags and smoke-test with existing vitest suites.
6) **Progressive Rollout & Backout** — Ship in slices (api → shared → apps), add migration guards, and document one-click rollback (DB down migrations or toggling flags) for each slice.

## Open Questions / Verification Needed
- Where are discounts/comps/tips/refunds tracked today? (Not obvious in current API routes.) Need to locate or add explicit endpoints/contracts before altering POS behavior.
- Confirm Square integration surfaces (currently manual “mark paid”) and whether additional payment methods exist that require compatibility shims.

## Test Strategy (per change set)
- Unit: pricing/fee calculations and payment-intent state transitions.
- API/Integration: check-in to assignment, checkout request → claim → mark-fee-paid → complete (including ban/late-fee paths).
- UI/Vitest: kiosks/register flows for selection locking, agreement gating, payment status display, and checkout verification states.

## Rollback Philosophy
- Each migration or feature flag ships with an explicit reversal (down migration or flag off).
- Client releases stay compatible with previous API versions during rollout windows.

