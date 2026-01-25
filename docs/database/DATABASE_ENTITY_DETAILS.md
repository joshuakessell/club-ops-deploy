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
- `waitlist`
- `inventory_reservations`
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

### `waitlist`

- **Purpose**: Tracks customers currently in an **upgrade waitlist** for a higher room tier during an active visit/check-in block.
- **Primary key**: `waitlist.id` (UUID).
- **Key columns**:
  - **Identity / scope**:
    - `visit_id`: Owning active visit (required).
    - `checkin_block_id`: The active check-in block whose checkout time governs eligibility (required).
  - **Upgrade intent**:
    - `desired_tier`: Desired room tier (STANDARD/DOUBLE/SPECIAL); validated server-side.
    - `backup_tier`: Fallback tier used for initial assignment; stored for coordination.
    - `locker_or_room_assigned_initially`: The initial resource assigned (debug/audit convenience).
  - **Offer/hold tracking**:
    - `status`: Lifecycle state (`waitlist_status` enum).
      - `ACTIVE`: Eligible to be offered when inventory becomes available.
      - `OFFERED`: Currently has an active room hold/offer associated (see `inventory_reservations`).
    - `room_id`: The room being held/offered for this entry when `status='OFFERED'` (nullable).
    - `offered_at`: When the current offer/hold began.
    - `offer_expires_at`: When the current offer/hold expires (timed).
    - `last_offered_at`: The most recent time this entry was offered/held (used for fair rotation without changing queue position).
    - `offer_attempts`: Number of times an offer/hold has been created for this entry (monotonic counter).
- **Relationships**:
  - `waitlist.visit_id` → `visits.id`
  - `waitlist.checkin_block_id` → `checkin_blocks.id`
  - `waitlist.room_id` → `rooms.id` (optional; points to the currently held room when offered)
- **Invariants**:
  - Waitlist entries are only eligible while the visit is active and `checkin_block.ends_at > now()`.
  - An entry cannot be simultaneously `ACTIVE` and `OFFERED`; clients may de-dupe defensively but server should enforce consistent transitions.

### `inventory_reservations`

- **Purpose**: Explicit, time-bound holds on inventory resources (rooms/lockers) to prevent selection/assignment races across lanes and upgrade flows.
- **Primary key**: `inventory_reservations.id` (UUID).
- **Key columns**:
  - `resource_type`: `room` or `locker`.
  - `resource_id`: UUID of the resource (FK enforced by application; the DB stores only the UUID).
  - `kind`:
    - `LANE_SELECTION`: Resource reserved by a lane session selection.
    - `UPGRADE_HOLD`: Resource reserved for a waitlist upgrade hold/offer.
  - `lane_session_id`: Required when `kind='LANE_SELECTION'`.
  - `waitlist_id`: Required when `kind='UPGRADE_HOLD'`.
  - `expires_at`: Expiration time for timed holds (nullable for holds that are purely lifecycle-bound).
  - `released_at` / `release_reason`: Release metadata. An active reservation is one with `released_at IS NULL`.
- **Relationships**:
  - `inventory_reservations.lane_session_id` → `lane_sessions.id` (optional)
  - `inventory_reservations.waitlist_id` → `waitlist.id` (optional)
- **Invariants**:
  - At most **one active reservation per resource** at a time (enforced by a partial unique index on `(resource_type, resource_id)` where `released_at IS NULL`).
  - Reservations are used by selection/assignment queries to exclude held inventory from general availability.

### `visits`

- **Purpose**: A historical record representing a customer’s overall visit lifecycle (start/end) which can contain one or more check-in blocks.
- **Primary key**: `visits.id` (UUID).
- **Key columns**:
  - `customer_id`: Owning customer (required).
  - `started_at`: Visit start time.
  - `ended_at`: Visit end time (nullable until ended).
- **Relationships**:
  - `visits.customer_id` → `customers.id`
  - `checkin_blocks.visit_id` → `visits.id`
  - `charges.visit_id` → `visits.id`
  - `waitlist.visit_id` → `visits.id`
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

Legacy identity tables have been removed. **All operational workflows must use `customers` as authoritative identity**.

---

## Staff scheduling / timeclock / HR support tables

These tables support _internal staff operations_ (office-dashboard scheduling, timeclock compliance reporting, and employee document storage). They are not part of customer-facing identity or inventory contracts, but they are still server-authoritative and audited.

### `employee_shifts`

- **Purpose**: A scheduled shift assignment for a staff member for a specific window of time.
- **Primary key**: `employee_shifts.id` (UUID).
- **Key columns**:
  - `employee_id`: Owning staff member (`staff.id`).
  - `starts_at`, `ends_at`: Scheduled window (timestamptz; `starts_at < ends_at` expected).
  - `shift_code`: One of `A`, `B`, `C` (maps to the 1st/2nd/3rd shift windows in `SPEC.md`).
  - `status`: `SCHEDULED` | `UPDATED` | `CANCELED`.
  - `notes`: Optional scheduling notes.
  - `created_by`, `updated_by`: Staff attribution for management changes.
- **Invariants**:
  - Shift windows must be stored as ISO timestamps; UIs render them in America/Chicago.
  - Shift updates must be attributable (audit log + `updated_by`).

### `timeclock_sessions`

- **Purpose**: Captures a clock-in/clock-out work session for a staff member, optionally linked to a scheduled shift.
- **Primary key**: `timeclock_sessions.id` (UUID).
- **Key columns**:
  - `employee_id`: Owning staff member.
  - `shift_id`: Optional reference to `employee_shifts.id`.
  - `clock_in_at`, `clock_out_at`: Work window (open sessions have `clock_out_at = NULL`).
  - `source`: One of `EMPLOYEE_REGISTER` | `OFFICE_DASHBOARD` (where the clock event originated).
- **Invariants**:
  - At most one open session per employee (enforced via partial unique index on `employee_id` where `clock_out_at IS NULL`).

### `employee_documents`

- **Purpose**: Metadata records for employee HR/onboarding documents stored in an external storage key (local FS for demo).
- **Primary key**: `employee_documents.id` (UUID).
- **Key columns**:
  - `employee_id`: Owning staff member.
  - `doc_type`: `ID` | `W4` | `I9` | `OFFER_LETTER` | `NDA` | `OTHER`.
  - `filename`, `mime_type`, `storage_key`: Storage metadata.
  - `uploaded_by`: Staff member who uploaded the document.
- **Invariants**:
  - Documents are audit artifacts; uploads must be attributable (`uploaded_by`) and authenticated.

### `time_off_requests`

- **Purpose**: A staff member’s request to take a specific day off, reviewed by management.
- **Primary key**: `time_off_requests.id` (UUID).
- **Key columns**:
  - `employee_id`: Requesting staff member.
  - `day`: The requested day off (`DATE`, interpreted in the club’s operational timezone).
  - `status`: `PENDING` | `APPROVED` | `DENIED`.
  - `reason`: Optional employee-provided reason.
  - `decided_by`, `decided_at`, `decision_notes`: Management decision attribution.
- **Invariants**:
  - At most one request per employee per day (enforced by unique index on `(employee_id, day)`).
  - Approvals/denials must be audited with actor identity.
