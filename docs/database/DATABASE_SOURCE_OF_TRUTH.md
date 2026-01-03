# ClubOperationsPOS Database Source of Truth

**Status:** Draft v0.2 (Demo contract)

This document is the canonical reference for database concepts, naming, and meaning across:
- `services/api` (the only writer to the database)
- `apps/employee-register`
- `apps/customer-kiosk`
- `apps/office-dashboard`
- `packages/shared` (shared enums and payload shapes)

If a rule, meaning, or data contract is not defined here, it is not considered stable.

This file is intended to supersede older, scattered “schema overview” notes. Several migrations and shared enums reference a `SCHEMA_OVERVIEW.md` that is not present in the repo snapshot. This document replaces it.

## Principles

1. **API-owned writes**
   - All database writes MUST happen through the API service.
   - Apps MUST NOT write directly to the database.

2. **Database is the canonical record of operational truth**
   - Customer identity, check-in outcomes, occupancy, payments, agreements, staff sessions, and scheduling MUST be persisted in the database.
   - UI state and WebSocket payloads MUST be derived from database state.

3. **Single canonical representation per concept**
   - A concept MUST have one canonical representation.
   - If duplication exists during transition, the duplication MUST be explicitly labeled as either:
     - **Derived** (computed from canonical data), or
     - **Legacy** (kept temporarily, scheduled for removal)

4. **Enums and statuses are contracts**
   - Every status field and enum MUST have a defined set of allowed values in this document.
   - The database SHOULD enforce allowed values using PostgreSQL enum types or explicit `CHECK` constraints.

5. **Time semantics are explicit**
   - All timestamps are stored as `TIMESTAMPTZ` and interpreted as UTC.
   - “Checkout time” MUST be represented as a stored timestamp (example: `checkin_blocks.ends_at`) and not inferred from client clocks.

6. **Integrity by default**
   - References to other entities SHOULD use foreign keys.
   - If a reference intentionally cannot be a foreign key, this document MUST explain why.

7. **Auditability**
   - Security-sensitive or financially meaningful state transitions SHOULD be recorded in `audit_log`.
   - Audit entries SHOULD prefer `staff_id` (UUID) over free-form user identifiers.

8. **Privacy and PII minimization**
   - PII SHOULD be minimized and protected.
   - If ID scan raw values are stored, the system MUST define encryption, access boundaries, and retention expectations.

## Decisions locked for the demo and for the final DB shape

These decisions are the “source of truth” that all apps and API routes must follow going forward.

### Identity and membership
- `customers` is the canonical identity table for all guests, including members and non-members.
- `members` is legacy and is kept temporarily for import validation only.
- `customers.membership_number` is optional.
- `customers.membership_number` is unique when present.
- `customers.id_scan_hash` is an optional forward-looking field used for dedupe and faster matching once the new scanning system is implemented.

### Stay and occupancy model
- A customer’s durable operational history is stored as:
  - `visits` (overall presence at the club)
  - `checkin_blocks` (a single stay segment with explicit `starts_at` and `ends_at`)
- For operational truth (availability and countdown), `checkin_blocks` is the canonical occupancy record.
- `lane_sessions` is ephemeral live coordination state only and is not the durable record of a stay.

### Agreements
- Every stay requires a new agreement:
  - initial check-ins require a new agreement
  - renewals require a new agreement
- The canonical signed artifact for each stay is stored on the block:
  - `checkin_blocks.agreement_pdf`
  - `checkin_blocks.agreement_signed_at`
- `agreement_signatures` is supplemental structured metadata (signature capture, text snapshot) and should ultimately reference `checkin_blocks` as its primary linkage.

### Rooms, lockers, and current state
- `rooms` and `lockers` are the canonical inventory entities.
- Cleaning state is represented by `room_status` (shared by rooms and lockers).
- Occupancy is represented by:
  - `rooms.status = OCCUPIED` or `lockers.status = OCCUPIED`, and
  - an active `checkin_blocks` row that provides the authoritative checkout time.
- Out-of-order rooms are represented by `rooms.override_flag = true` (not available for assignment even if clean).

### Lane selection and pricing
- Two-sided selection uses the propose/confirm fields on `lane_sessions`.
- Once locked, `lane_sessions.desired_rental_type` is the canonical locked selection used for quoting and assignment.
- `payment_intents.quote_json` is the canonical price breakdown once a payment intent exists.

### Check-in mode values
- Canonical values for lane mode are `CHECKIN` and `RENEWAL`.
- Legacy value `INITIAL` is treated as an alias of `CHECKIN` during transition and should be removed via normalization and enforcement.

### Payment intent linkage
- `payment_intents.lane_session_id` is the canonical linkage.
- `lane_sessions.payment_intent_id` is a redundant inverse pointer and MUST match (or be removed in cleanup).

## Bounded contexts

The database is organized into bounded contexts. Each table belongs to one primary context.

1. **Identity and Customers**
   - Primary table: `customers`
   - Legacy: `members`

2. **Lane Check-in Orchestration**
   - Primary table: `lane_sessions`

3. **Visits and Occupancy History**
   - Primary tables: `visits`, `checkin_blocks`

4. **Inventory and Housekeeping**
   - Primary tables: `rooms`, `lockers`, `key_tags`, `cleaning_events`, `cleaning_batches`, `cleaning_batch_rooms`

5. **Payments and Cashiering**
   - Primary tables: `payment_intents`, `register_sessions`

6. **Agreements and Documents**
   - Primary tables: `agreements`, `agreement_signatures`, `employee_documents`
   - Block storage: `checkin_blocks.agreement_pdf`, `checkin_blocks.agreement_signed_at`

7. **Staff and Authentication**
   - Primary tables: `staff`, `staff_sessions`, `staff_webauthn_credentials`, `devices`

8. **Scheduling and Timeclock**
   - Primary tables: `employee_shifts`, `timeclock_sessions`

9. **Checkout and Late Checkout**
   - Primary tables: `checkout_requests`, `late_checkout_events`

10. **Audit and Reporting**
   - Primary table: `audit_log`

## Glossary

**Agreement**
The active set of terms and conditions a customer must accept for a stay. Stored as a versioned record in `agreements`.

**Agreement PDF**
The canonical signed agreement artifact stored on the stay record as `checkin_blocks.agreement_pdf`.

**Agreement signature**
A structured signature capture record, including signature inputs and a text snapshot of what was signed. Stored in `agreement_signatures`. Canonically linked to a stay via `checkin_block_id`.

**Checkout time**
The authoritative end timestamp of a stay, stored as `checkin_blocks.ends_at`.

**Customer**
The canonical identity record for a guest, stored in `customers`.

**Lane**
A physical check-in station that links one employee-register with one customer-kiosk for a single interaction.

**Lane session**
Live orchestration record for a lane, stored in `lane_sessions`. Ephemeral coordination state, not durable occupancy truth.

**Occupancy**
A resource (room or locker) being assigned to a customer for a time interval. Canonically represented by a `checkin_blocks` row with a non-null `room_id` or `locker_id` and a future `ends_at`.

**Past due balance**
A numeric balance stored on the customer (`customers.past_due_balance`) representing an outstanding amount owed.

**Payment intent**
A record representing an amount due, its pricing breakdown, and its outcome status. Stored in `payment_intents`.

**Rental type**
A classification for what the customer is renting (example: `STANDARD`, `DOUBLE`, `SPECIAL`, `LOCKER`, `GYM_LOCKER`). Used by `lane_sessions` and `checkin_blocks`.

**Stay**
A single time-bounded occupancy segment. In the schema, a stay maps to one `checkin_blocks` row. Every stay requires a new agreement.

**Visit**
A durable record of a customer’s overall presence that may span multiple stays (blocks). Stored in `visits`.

## Legacy and transitional artifacts

The migration history indicates transitional artifacts that must be treated explicitly:

- `members` is legacy and should not be used by operational flows.
- `sessions` predates the lane-based flow and may remain during cleanup, but is not the canonical stay model.
- `agreement_signatures.checkin_id` references legacy `sessions(id)`; new signature records should link to `checkin_blocks` instead.
- `room_type` enum still contains legacy values (`DELUXE`, `VIP`, and `LOCKER`). New assignments must use the canonical tiers only.

## Cleanup backlog

These are known cleanup items implied by the locked decisions above. They can be addressed after the demo flow is stable.

1. Enforce `customers.membership_number` uniqueness with a partial UNIQUE index where not null.
2. Normalize `lane_sessions.checkin_mode` to `CHECKIN` and `RENEWAL`, then enforce allowed values.
3. Add DB-level constraint for `checkin_blocks` so exactly one of `room_id` or `locker_id` is set.
4. Migrate legacy `agreement_signatures` away from `sessions` and enforce `checkin_block_id` as the primary linkage.
5. Align all code paths to use `assigned_to_customer_id` for rooms and lockers (legacy `assigned_to` should not be referenced).

## Appendix A: Migration index and conflict flags

This appendix is a working index for reviewing redundancy and streamlining. It is not a contract by itself. The contract is defined above.

