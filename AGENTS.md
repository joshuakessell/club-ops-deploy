# Codex Agent Instructions

This repository contains a multi-application system for managing club check-ins, renewals, upgrades, room/locker inventory, cleaning workflows, checkout verification, and operational reporting.

**IMPORTANT**
All agent work MUST adhere to:

- `SPEC.md` (source of truth for business rules + product behavior)
- `openapi.yaml` (API contract target)
- `docs/database/DATABASE_SOURCE_OF_TRUTH.md` and `docs/database/DATABASE_ENTITY_DETAILS.md` (canonical DB meaning/contract)
- `db/schema.sql` (schema snapshot; must match migrations and the canonical DB contract)

If implementation conflicts with these files, the agent MUST either:

1. fix the implementation to match the specs, or
2. propose a spec change with a clear justification and explicit diffs, and receive approval before making changes.

---

## Command Execution Requirements

**CRITICAL: Do NOT use `sudo` for `pnpm`/Node commands.**

- Agents MUST use a bash shell for repo commands when possible (avoid cmd.exe / PowerShell-specific instructions).
- **Never run `pnpm`, `node`, or dev scripts as root**. Doing so commonly creates root-owned `node_modules/` and breaks installs for everyone else.
- If you hit permission issues:
  - Fix file ownership/permissions in the workspace (don’t “paper over” by using `sudo pnpm`).
  - Delete and reinstall dependencies if needed (e.g., remove `node_modules/` and re-run `pnpm install` as your normal user).

This keeps local dev behavior consistent with standard modern Node/pnpm workflows.

---

## Project Architecture

### Applications (Monorepo)

- `apps/customer-kiosk`
  - Customer-facing tablet UI at each check-in window
  - Idle state: Club Dallas logo only
  - During a lane session: shows customer name and membership number (if present)
  - Customer selects rental preference: Locker / Standard / Double / Special
  - Optional Gym Locker option appears only for grandfathered membership-number ranges
  - Handles waitlist intent (desired type when unavailable) and backup selection
  - Shows upgrade disclaimer only when the user elects an upgrade/waitlist path
  - Shows the club agreement contract (placeholder text for now), captures signature, submits to server
  - Real-time updates via WebSockets

- `apps/employee-register`
  - Employee-facing tablet per register lane (2 lanes)
  - Works alongside Square POS (Square runs on separate iPads)
  - Creates and manages lane sessions, assigns rooms/lockers, triggers customer kiosk state
  - Has a mode toggle: CHECKIN vs RENEWAL vs (optional) CHECKOUT-ASSIST
  - Displays organized inventory lists:
    - Collapsible sections by tier: Special, Double, Standard
    - Lockers shown as a collapsible grid (001–108)
  - Auto-expands the customer-selected tier and sorts rooms by:
    1. available/clean first
    2. near-expiration next
    3. newest occupied last
  - Must confirm assignment before committing (server-authoritative + transactional locks)
  - Supports checkout claim/verification notifications coming from checkout kiosks
  - Authentication required at shift start; remains signed in until user signs out

- `apps/cleaning-station-kiosk`
  - Staff-facing tablet mounted near key hooks (dirty/clean)
  - Camera/QR scanning is NOT required in the primary workflow
  - After staff auth (WebAuthn fingerprint or PIN), show two live lists:
    - DIRTY rooms (eligible to begin cleaning)
    - CLEANING rooms (eligible to finish cleaning)
  - Staff selects one or multiple rooms from ONLY ONE list at a time
    - Selecting in one column disables the other column (prevents mixed-status batch)
  - Primary action button becomes:
    - "Begin Cleaning" for DIRTY selection
    - "Finish Cleaning" for CLEANING selection
  - After action completes, kiosk returns to lock screen (requires re-auth)
  - All transitions validated server-side; overrides must be logged and excluded from metrics

- `apps/checkout-kiosk`
  - Customer-facing tablet kiosk used inside the club for self-service checkout initiation
  - Idle state: Club Dallas logo only
  - On start: instructs customer to scan locker/room key tag (front camera visible)
  - After scan: shows checklist (locker: key+towel; room: key+sheets+remote if assigned)
  - Includes notice: staff must verify items; towels/sheets can go in laundry bin; keys/remotes must be handed to staff
  - Customer submits checklist, which triggers a notification on employee register tablets
  - First employee to claim the notification owns the checkout verification
  - Late fee and ban logic applied server-side and displayed to employee + customer
  - After verification and (if required) payment is marked paid, kiosk shows completion message then returns to idle after ~10s

- `apps/office-dashboard`
  - Office PC web app (admin + managers)
  - Admin tools:
    - Create/update staff, set roles, set/reset PINs
    - Manage staff passkeys (WebAuthn) and revoke credentials
  - Admin-only metrics view:
    - Occupied/unoccupied counts
    - Rooms expiring soon and overdue (overdue at top, red, most expired first)
    - Cleaning metrics overall and by staff / shift
  - Audit logs searchable and exportable
  - System configuration values visible and editable (where applicable)

### Backend

- `services/api`
  - Server-authoritative REST API
  - WebSocket realtime updates for inventory + lane sessions + checkout notifications
  - Postgres database
  - Transactional locking on assignments and status transitions

### Shared Packages

- `packages/shared`
  - Canonical enums, Zod schemas, transition guards, pricing helpers
  - Room tier classification and mapping rules
  - Shared event types for WebSockets

- (optional) `packages/ui`
  - Shared UI components and styling rules
  - Black/white theme aligned to Club Dallas branding

---

## Core Rules (Must Not Be Violated)

1. **Server is the single source of truth**
   - Clients never assume inventory, assignment validity, eligibility, or pricing
   - All critical decisions are confirmed by the API

2. **Concurrency must be safe**
   - Room/locker assignments must be transactional with row locks
   - Prevent double booking when two lanes attempt to take the last unit

3. **Room status transitions are enforced**
   - Normal flow: DIRTY → CLEANING → CLEAN → OCCUPIED → DIRTY (at checkout)
   - Skipping steps requires explicit override
   - Overrides must be logged with staff identity and reason

4. **Overrides and anomalies exclude metrics**
   - Any transition performed via override is flagged and excluded from performance metrics
   - Anomalous events (e.g., impossible durations) are excluded from stats as well

5. **Realtime is push-based**
   - WebSockets broadcast server events; do not rely on polling for correctness

6. **Authentication is mandatory**
   - Employee apps require staff auth (WebAuthn preferred, PIN fallback)
   - Employee Register: one login per shift, stays logged in until sign-out
   - Cleaning Station: must re-auth for each begin/finish batch (returns to lock screen)

7. **Square is external**
   - Square POS runs on separate iPads
   - This system computes quotes and creates payment intents, but payment is taken in Square
   - Staff manually marks payment intents as paid after collecting payment in Square
   - Never assume payment succeeded without explicit "mark paid"

---

## Coding Standards

- TypeScript everywhere
- Strict typing enabled
- Zod validation for all request bodies
- Deterministic, testable business logic (pricing, eligibility, transitions)
- OpenAPI contract should remain aligned with actual endpoints
- Add tests for every bug fix and every core business rule

---

## Commands

From repo root:

- Install:
  `pnpm install`

- Start:
  `pnpm dev`

- Tests:
  `pnpm test`

- Lint:
  `pnpm lint`

- Typecheck:
  `pnpm typecheck`

---

## What the Agent Must Check Before Major Changes

- Does this affect pricing rules, membership fee rules, youth rules, or time windows?
- Does this affect room tier mapping (Standard/Double/Special) or room numbering?
- Does this affect checkout late fee / ban logic?
- Does this affect concurrency or locking?
- Does this affect WebAuthn/PIN authentication requirements?

If yes, explain impact and add/adjust tests.

---

End of instructions.
