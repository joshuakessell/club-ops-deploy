# Club Dallas POS Upgrade: Employee Register Layout + Unified Scan Flow + Kiosk Agreement Sync

This checklist is the implementation plan derived from:

- `SPEC.md` (Counter Check-in Flow v1 + Employee Register Standard View)
- `openapi.yaml` (API contract targets for check-in + agreement)
- `docs/database/DATABASE_SOURCE_OF_TRUTH.md` + `docs/database/DATABASE_ENTITY_DETAILS.md` + `db/schema.sql` (canonical DB meaning/contracts)

---

## UI (Employee Register Layout)

- **Status note (2026-01-07)**: Employee Register UI cleanup completed for this slice — removed redundant hamburger/menu in `RegisterSignIn` and unified scan entry into a single **Scan** button (legacy scan behaviors preserved behind the new entrypoint).

- [ ] **P0 — Standard view layout matches spec (landscape, split-screen friendly)**
  - Done when: Employee Register renders in a stable landscape layout with touch-friendly controls, works alongside Square (split-screen), and preserves existing sign-in/top-bar/slide-in sign-out behavior.

- [ ] **P0 — Inventory lists presented as four collapsible sections**
  - Done when: UI shows **Lockers (grid 001–108)** + **Standard** + **Double** + **Special** as collapsible sections, with the customer-selected tier auto-expanded.

- [ ] **P0 — Inventory ordering and visual indicators**
  - Done when: Within each tier list, ordering is: **upgrade requests at top**, then **available (CLEAN, green)**, then **CLEANING**, then **DIRTY**, then **occupied sorted by closest expiration** with **yellow/amber near-expiration** and **red overdue**, and “room became available while pending upgrade exists” uses an **orange outline** indicator.

- [ ] **P0 — Assignment confirmation UX is explicit**
  - Done when: Selecting an item never commits assignment until staff clicks **Assign**; an assignment attempt that fails due to a race shows a clear error and refreshes availability from server-authoritative state.

- [ ] **P1 — Auto-select first available unit for chosen tier**
  - Done when: Choosing a tier auto-selects the first available unit in that tier (without committing), and staff can override selection within the same tier before confirming.

- [ ] **P1 — Cross-type assignment prompts customer confirmation**
  - Done when: If staff tries to assign a different tier than the customer requested, the customer kiosk shows “You requested X, staff selected Y. Accept?” and staff UI reflects “pending customer confirmation” until the customer accepts/declines and the system reverts on decline.

---

## Scanning (Unified Scan Flow)

- **Status note (2026-01-07)**: Implemented “No match found → Create new account” flow in Scan Mode. After `/v1/checkin/scan` returns NO_MATCH (STATE_ID), register prompts **Cancel** or **Yes/Create**, calls `/v1/customers/create-from-scan`, then opens the new customer via `POST /v1/checkin/lane/:laneId/start` with `customerId`.

- [ ] **P0 — One scan capture flow for ID + membership (scanner wedge + optional camera)**
  - Done when: Employee Register supports a single, consistent scan entry system that can accept keyboard-wedge scans and (if enabled) camera-scanned PDF417, and routes them to the correct backend calls with clear UI prompts for “Scan ID” vs “Scan Membership”.

- [ ] **P0 — ID scan produces an `IdScanPayload` and calls the correct endpoint**
  - Done when: An ID scan results in a parsed payload compatible with `openapi.yaml` for `POST /v1/checkin/lane/{laneId}/scan-id` (raw/fullName/first+last/dob/idNumber/jurisdiction), and the lane session updates on both devices via WebSocket.

- [ ] **P0 — Manual fallback for identity capture**
  - Done when: If scanning fails (unreadable barcode, missing name, or device limitations), staff can manually enter customer name and still start/continue the lane session without blocking the flow.

- [ ] **P1 — Membership scan updates membership number and allowed rental options**
  - Done when: A membership scan updates the lane session’s membership number and causes both devices to update allowed rental options (including conditional Gym Locker eligibility when applicable).

- [ ] **P1 — Scanner buffering is robust**
  - Done when: Rapid scans do not double-submit or mix ID vs membership modes; the scan buffer resets reliably after submission; errors do not leave the app “stuck” in a scan state.

---

## Backend Matching (Customer Resolution + Session Updates)

- **Status note (2026-01-07)**: Implemented server-side scan classification + customer matching endpoint (`POST /v1/checkin/scan`) with AAMVA vs membership classification, match by `id_scan_hash`/`id_scan_value`, name+DOB fallback enrichment, and membership-number matching; employee-register Scan Mode now calls this endpoint first.

- [ ] **P0 — Customer resolution follows the spec (“ID scan hash logic”)**
  - Done when: The backend deterministically resolves/creates a customer from ID scan data (including when only partial fields are present), avoids duplicate customer creation for repeat scans, and returns a stable `customerId` for the lane session.

- [ ] **P0 — `/start` vs `/scan-id` behavior is consistent and documented**
  - Done when: `POST /v1/checkin/lane/{laneId}/start` (with `idScanValue`/`membershipScanValue`) and `POST /v1/checkin/lane/{laneId}/scan-id` produce equivalent lane session identity outcomes, with a clear single “preferred” path for the Employee Register to use.

- [ ] **P0 — Session updates are broadcast to lane (server-authoritative)**
  - Done when: After ID/membership updates, server broadcasts `SESSION_UPDATED` to the lane with customer name, membership number, allowed rentals, selection state, and agreement/payment gating state as needed for UI correctness.

- [ ] **P1 — Banned customer handling is enforced**
  - Done when: Scans that map to a banned customer are rejected with a clear error (per API contract), and the UI displays a staff-friendly message without proceeding in the flow.

---

## Kiosk Agreement Sync (Customer Kiosk ↔ Employee Register)

- [ ] **P0 — Agreement required only for INITIAL and RENEWAL checkin_blocks**
  - Done when: Customer kiosk shows the agreement/signature step only when the server indicates the session mode is CHECKIN or RENEWAL; upgrades do not require agreement signing.

- [ ] **P0 — Agreement signing gates assignment**
  - Done when: The backend prevents assignment until the agreement is signed when required, and both UIs clearly show “agreement required” vs “agreement signed” states (no optimistic client-side bypass).

- [ ] **P0 — Agreement signature storage and linkage**
  - Done when: `POST /v1/checkin/lane/{laneId}/sign-agreement` stores the signature payload and links it to the created `checkin_block` via `agreement_signatures`, matching canonical DB meaning/contracts.

- [ ] **P1 — Real-time sync of agreement state**
  - Done when: After kiosk signs, Employee Register is updated in real time (via `SESSION_UPDATED` or a dedicated event) to reflect agreement completion without manual refresh.

- [ ] **P2 — Offline/retry-friendly kiosk signing**
  - Done when: If the kiosk temporarily loses connectivity during signing, it can retry submission safely (idempotent or de-duplicated server-side), and both devices converge on a consistent “signed” state after reconnection.

---

## Tests (API + UI)

- [ ] **P0 — API tests for unified scan flow**
  - Done when: `services/api/tests` includes coverage for `POST /v1/checkin/lane/:laneId/scan-id` and `POST /v1/checkin/lane/:laneId/start` (idScanValue/membershipScanValue) verifying consistent customer resolution and lane session updates.

- [ ] **P0 — API tests for agreement gating**
  - Done when: Tests prove that assignment is rejected when agreement is required but not signed, and succeeds once the kiosk signs; tests validate correct mode handling (CHECKIN/RENEWAL vs upgrade paths).

- [ ] **P1 — UI tests for employee register inventory ordering + indicators**
  - Done when: `apps/employee-register` vitest tests cover ordering rules and at least one visual indicator state (available/near-expiration/overdue/waitlist highlight) using deterministic fixture data.

- [ ] **P1 — UI tests for scan capture robustness**
  - Done when: `apps/employee-register` tests cover wedge-scan buffering with back-to-back scans, mode switching (ID vs membership), and error recovery (no stuck state).

- [ ] **P2 — UI tests for kiosk agreement sync**
  - Done when: `apps/customer-kiosk` tests cover agreement UI gating (shown only when required), signature submission, and subsequent state transition driven by WebSocket/session update.

---

## Assumptions / Open Questions

- **Membership scan format**: Is the membership card encoded as QR, barcode, NFC, or plain numeric wedge input? Current spec mentions “QR/NFC” at a high level but the concrete encoding/format isn’t confirmed.
- **Gym Locker eligibility**: The spec describes “grandfathered membership-number ranges” but does not specify the exact ranges/logic source. Where is the canonical rule (DB config vs hard-coded enum vs admin setting)?
- **ID scan sources**: Employee Register currently supports both wedge scans and camera PDF417 parsing; confirm whether camera scanning is required in production or just a fallback.
- **Agreement body**: The spec allows placeholder text for now; confirm whether we need versioning (agreement revision IDs) or audit metadata beyond the stored signature payload.
- **Event contract**: `SPEC.md` lists several WebSocket event names; confirm which are canonical in `packages/shared` and whether agreement status should be part of `SESSION_UPDATED` vs a dedicated event.
