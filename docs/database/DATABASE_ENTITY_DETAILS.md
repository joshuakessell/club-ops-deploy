# Database entity details

This document is canonical for **table-by-table meaning**, **column-level contracts**, and **invariants**.

If any other documentation (including historical “schema overview” notes) conflicts with this document, **this document wins**.

## How to use

- Use this doc when implementing or reviewing:
  - API behavior that reads/writes the DB
  - migrations in `services/api/migrations/`
  - schema snapshot updates in `db/schema.sql`
- When you discover a mismatch between code and database meaning, fix the mismatch by updating code/migrations and/or these docs (these docs define the intended contract).

## Entities (contract overview)

This repo contains a number of operational entities (customers, visits, lane sessions, inventory units like rooms/lockers, checkout requests, audit logs, etc.).

The detailed per-table sections should live here, and should capture at minimum:

- **Purpose**: what the table represents in the product
- **Primary key**: identifier and how it is used
- **Key columns**: required vs optional, meaning, and lifecycle
- **Relationships**: foreign keys and ownership rules
- **Invariants**: rules that must always hold (constraints + application enforcement)

> Note: The current DDL snapshot is in `db/schema.sql`, and the schema evolution history is in `services/api/migrations/`. Those artifacts must match the meaning and invariants described here.

---

## Canonical entity definitions (authoritative)

This section is the **single authoritative place** (within this repo) that defines the meaning of the following operational entities:

- `customers`
- `lane_sessions`
- `payment_intents`
- `visits`
- `checkin_blocks`
- `rooms`
- `lockers`
- `agreements`
- `agreement_signatures`

Other markdown files may describe workflows, but **must not redefine** these entities’ meanings or list “schema contracts” that can diverge. If needed, they should link here.

### `customers`

- **Purpose**: The canonical identity record for a person receiving service at the club (check-ins, renewals, upgrades, checkout, bans, balances).
- **Primary key**: `customers.id` (UUID).
- **Key columns** (non-exhaustive):
  - `name`: Display name for operational UIs (may be edited/corrected).
  - `dob`: Date of birth (optional).
  - `membership_number`, `membership_card_type`, `membership_valid_until`: Optional membership metadata when known.
  - `id_scan_hash` / `id_scan_value`: Optional ID-scan derived identifiers used to resolve/merge identity.
  - `banned_until`: If present and in the future, customer is currently banned.
  - `past_due_balance`: Monetary balance owed (numeric).
- **Relationships**:
  - `visits.customer_id` → `customers.id`
  - Many other operational tables may reference `customers.id` for ownership/attribution.
- **Invariants**:
  - **Operational workflows use `customers` as authoritative identity** (not `members`).
  - Membership-related values are **attributes**, not identity: a customer can exist without a membership number.

### `lane_sessions`

- **Purpose**: A short-lived, device/lane-scoped coordination record for an in-progress counter check-in/renewal/upgrade flow (shared state between employee-register + customer-kiosk).
- **Primary key**: `lane_sessions.id` (UUID).
- **Key columns** (non-exhaustive):
  - `lane_id`: Which lane the session belongs to (e.g. lane 1 / lane 2).
  - `status`: Current lifecycle status (see `lane_session_status` enum in `db/schema.sql` for allowed values).
  - `staff_id`: Staff member currently operating the lane (nullable depending on stage).
  - `customer_id`: The resolved customer for this flow (nullable early, required for completion paths that create a visit).
  - Selection coordination:
    - `proposed_rental_type`, `proposed_by`
    - `selection_confirmed`, `selection_confirmed_by`, `selection_locked_at`
  - Waitlist coordination:
    - `waitlist_desired_type`, `backup_rental_type`
  - Pricing / acknowledgement:
    - `price_quote_json` (server-authoritative quote snapshot)
    - `disclaimers_ack_json` (record of acknowledgements, when applicable)
  - Payment:
    - `payment_intent_id` (links to payment tracking for this session)
- **Relationships**:
  - `payment_intents.lane_session_id` → `lane_sessions.id` (where used)
  - `checkin_blocks.session_id` → `lane_sessions.id` (where used)
- **Invariants**:
  - A `lane_session` is **coordination state**, not a historical ledger. Historical records are `visits` + `checkin_blocks` (+ `charges`, etc.).
  - Server remains authoritative; clients may propose values, but the API validates/locks transitions.

### `payment_intents`

- **Purpose**: Tracks an amount due/paid for a lane session (payment is collected externally; this table records the intent and staff “mark paid” outcome).
- **Primary key**: `payment_intents.id` (UUID).
- **Key columns** (non-exhaustive):
  - `lane_session_id`: Optional link to the lane session that generated the intent.
  - `amount`: Amount due for the intent.
  - `status`: Payment lifecycle state (see `payment_status` enum in `db/schema.sql`).
  - `quote_json`: Immutable-ish quote snapshot used to compute/display totals.
  - `square_transaction_id`: Optional external reference (if recorded).
  - `paid_at`: Timestamp of when the system recorded the payment as paid.
- **Relationships**:
  - `lane_sessions.payment_intent_id` → `payment_intents.id` (where used)
- **Invariants**:
  - This system does **not** assume external payment succeeded without an explicit “mark paid” action.
  - Status transitions are validated server-side and should be audited.

### `visits`

- **Purpose**: A historical record representing a customer’s overall visit lifecycle (start/end) which can contain one or more check-in blocks.
- **Primary key**: `visits.id` (UUID).
- **Key columns**:
  - `customer_id`: Owning customer (required).
  - `started_at`: Visit start time.
  - `ended_at`: Visit end time (nullable until ended).
- **Relationships**:
  - `checkin_blocks.visit_id` → `visits.id`
- **Invariants**:
  - A visit belongs to exactly one customer.
  - Check-in blocks are the authoritative sub-records for time windows and assigned resources.

### `checkin_blocks`

- **Purpose**: A historical record of a specific paid check-in time window within a visit (initial, renewal, final extension), including assigned inventory and key features.
- **Primary key**: `checkin_blocks.id` (UUID).
- **Key columns** (non-exhaustive):
  - `visit_id`: Owning visit (required).
  - `block_type`: Block lifecycle type (see `block_type` enum in `db/schema.sql`).
  - `starts_at`, `ends_at`: The time window covered by this block.
  - Assigned inventory:
    - `room_id` (nullable)
    - `locker_id` (nullable)
    - `rental_type` (required; see `rental_type` enum in `db/schema.sql`)
  - Agreement gating:
    - `agreement_signed` (boolean)
  - Misc:
    - `has_tv_remote` (boolean)
    - `waitlist_id` (nullable)
  - Coordination:
    - `session_id` (nullable link back to the lane session that created the block)
- **Relationships**:
  - `agreement_signatures.checkin_block_id` → `checkin_blocks.id` (where used)
  - `charges.checkin_block_id` → `checkin_blocks.id` (where used)
- **Invariants**:
  - A check-in block belongs to exactly one visit.
  - `starts_at < ends_at` must always hold.
  - Assigned inventory is reflected both here (historical) and on the inventory unit (current assignment), with server-side locking for concurrency safety.

### `rooms`

- **Purpose**: Inventory units representing rentable rooms and their current operational state.
- **Primary key**: `rooms.id` (UUID).
- **Key columns** (non-exhaustive):
  - `number`: Human-readable identifier (e.g., "101").
  - `type`: Room tier/type (see `room_type` enum in `db/schema.sql`).
  - `status`: Current state (see `room_status` enum in `db/schema.sql`).
  - `assigned_to_customer_id`: Current assignment (nullable).
  - `override_flag`: Marks that an override occurred affecting metrics eligibility.
  - `version`: Concurrency/version field used for safe updates.
- **Relationships**:
  - `checkin_blocks.room_id` → `rooms.id` (historical assignment within blocks)
- **Invariants**:
  - Room status transitions are enforced server-side (normal flow and override behavior).
  - Deprecated room types are not permitted for active usage (see constraints in `db/schema.sql`).

### `lockers`

- **Purpose**: Inventory units representing rentable lockers and their current operational state.
- **Primary key**: `lockers.id` (UUID).
- **Key columns**:
  - `number`: Human-readable identifier (e.g., "001").
  - `status`: Current state (uses `room_status` enum).
  - `assigned_to_customer_id`: Current assignment (nullable).
- **Relationships**:
  - `checkin_blocks.locker_id` → `lockers.id` (historical assignment within blocks)
- **Invariants**:
  - Lockers participate in assignment/checkout flows similarly to rooms (server-authoritative assignment; concurrency safe).

### `agreements`

- **Purpose**: Stores the current and historical versions of the club agreement text presented to customers.
- **Primary key**: `agreements.id` (UUID).
- **Key columns**:
  - `version`: Version label for the agreement content.
  - `title`, `body_text`: Presented content.
  - `active`: Whether this agreement is the currently active one for signing.
- **Invariants**:
  - At most one agreement should be active at a time (enforced by application logic unless constrained in DB).
  - Agreement text used for signatures must be snapshotted into `agreement_signatures`.

### `agreement_signatures`

- **Purpose**: Captures a customer’s signature (and metadata) against a specific agreement version and the agreement text snapshot at signing time.
- **Primary key**: `agreement_signatures.id` (UUID).
- **Key columns** (non-exhaustive):
  - `agreement_id`: Agreement version signed.
  - `agreement_text_snapshot`, `agreement_version`: Snapshot of exactly what was signed.
  - `checkin_block_id`: The check-in block this signature applies to (nullable in legacy rows; prefer populated).
  - Signature payload:
    - `signature_png_base64` and/or `signature_strokes_json`
  - `signed_at`: Timestamp of signing.
  - `customer_name`, `membership_number`: Display snapshot at time of signing (not authoritative identity).
- **Invariants**:
  - Signature records are immutable audit artifacts: do not “edit” signed content; create new signatures when needed.
  - The agreement text snapshot must correspond to the agreement version fields stored alongside it.

---

## Legacy / non-authoritative identity tables

### `members` (deprecated)

`members` exists only as a temporary legacy artifact. **All operational workflows must use `customers` as authoritative identity**.


