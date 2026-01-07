# Club Operations POS - Technical Specification

## Overview

This system manages club operations including customer check-ins, room assignments, locker allocations, cleaning workflows, and staff metrics tracking.

---

## Applications

### Customer Kiosk (`apps/customer-kiosk`)

**Note**: The authoritative end-to-end behavior is specified in **"Counter Check-in Flow v1"** below. This section is a high-level summary only.

**Purpose**: Tablet-based self-service kiosk for customer check-ins.

**Features**:

- Logo-only idle screen until session is created
- ID scan to display customer name
- Membership card scanning (QR/NFC) to display membership number
- Conditional Gym Locker option for grandfathered memberships only
- Real-time room availability display
- Rental type selection (Locker, Standard, Double, Special; Gym Locker when eligible)
- Locker assignment confirmation

**Flow**:

1. **Idle State**: Displays logo only, waiting for employee register to create session
2. **After ID Scan**: Customer name appears (via SESSION_UPDATED WebSocket event)
3. **After Membership Scan**: Membership number appears (via SESSION_UPDATED WebSocket event)
4. **Rental Options**: Displays available rental options including Gym Locker if eligible

**Technical Requirements**:

- Locked single-app experience (no browser navigation)
- WebSocket connection for live inventory updates and session events
- Listens for SESSION_UPDATED events to update UI state
- Offline-capable with sync on reconnection
- Touch-optimized UI (minimum 44px touch targets)

### Employee Register (`apps/employee-register`)

**Purpose**: Staff-facing tablet application for register sign-in and check-in session management.

**Register Sign-In Flow**:

- Maximum of two active register sessions (Register 1 and Register 2)
- Each tablet has a manually assigned `deviceId` (constant or environment variable, fallback in localStorage)
- Sign-in flow:
  1. **Select Employee**: Modal lists all available employees (excludes employees already signed into any register)
  2. **Enter PIN**: 4-digit numeric PIN input, server-only verification
  3. **Register Assignment**:
     - If no registers occupied: Show "Register 1" and "Register 2" buttons
     - If one register occupied: Automatically assign remaining register, show confirmation
  4. **Confirm**: Server locks employeeId + deviceId + registerNumber
- Signed-in state: Club Dallas logo with 50% black overlay, top bar with employee name and register number, right-side slide-in menu with "Sign Out"
- Heartbeat loop (90 seconds TTL) to release abandoned sessions
- Sign out releases register session on server

**Check-in Features** (see "Counter Check-in Flow v1" below):

- Barcode scanner input capture for ID and membership scans
- Customer lookup and check-in processing
- Room assignment with real-time availability
- Locker assignment and key tracking
- Session countdown timers
- Integration with Square POS (external)

**Technical Requirements**:

- Landscape-only layout optimized for Android tablets
- Material UI Dark theme (black-and-white)
- Modal-based sign-in flow with shake animation on PIN failure
- Right-side slide-in menu
- Heartbeat loop while signed in
- Split-screen compatible (runs alongside Square)
- Captures barcode scanner input (keyboard wedge mode)
- Sends ID scans to `/v1/checkin/lane/:laneId/scan-id` endpoint
- Real-time inventory synchronization via WebSocket

---

## Counter Check-in Flow v1 (Source of Truth)

This section defines the complete counter check-in workflow for the customer kiosk and employee register applications.

### Overview

The counter check-in flow enables a two-sided selection model where both the customer (via kiosk) and employee (via register) can propose rental type selections, with the first confirmation locking the choice. The flow handles waitlist scenarios, upgrade disclaimers, agreement signing, payment, and assignment in a strict sequence.

### Customer Identity Capture

1. **ID Scan**: Employee scans customer ID using barcode wedge scanner connected to employee-register tablet
   - Input captured as keyboard input (barcode scanner in wedge mode)
   - Manual fallback: Employee can enter customer name manually if scan fails
   - API endpoint: `POST /v1/checkin/lane/:laneId/start` with `idScanValue` (or manual entry)
   - System creates/resolves customer record using ID scan hash logic

2. **Membership Scan** (optional): Employee scans membership card
   - Updates session with membership number
   - Determines allowed rentals (including Gym Locker if eligible)

3. **Real-time Sync**: Both customer kiosk and employee register display:
   - Customer name
   - Membership number (if present)
   - Allowed rental options

### Two-Sided Selection Model

Both customer (kiosk) and employee (register) can propose and confirm rental type selections:

1. **Propose Selection**:
   - Either side can propose a rental type (LOCKER, STANDARD, DOUBLE, SPECIAL, GYM_LOCKER)
   - Proposal is stored but not locked
   - Other side sees the proposal in real-time via WebSocket

2. **Confirm Selection** (First-Wins Locking):
   - Either side can confirm the proposed selection
   - **First confirmation locks the choice**; the other side must acknowledge
   - Once locked, the other device shows an acknowledgement prompt
   - Further steps are gated until the locked choice is acknowledged

3. **Cross-Type Assignment**:
   - If employee assigns a different tier than customer requested, customer must confirm
   - Customer sees: "You requested X, staff selected Y. Accept?"
   - Customer can accept or decline; if declined, assignment is reverted

### Unavailable Type → Waitlist Flow

When customer selects an unavailable rental type:

1. **Waitlist Modal Appears**:
   - Shows desired type is unavailable
   - Displays waitlist position (1-based, computed from queue depth)
   - Displays estimated ready time (ETA):
     - Algorithm: Find Nth occupied checkin_block where N = position
     - ETA = block.ends_at + 15 minutes buffer
     - If insufficient occupancy data, ETA = null (shown as "Unknown")
   - Shows upgrade fee breakdown for the desired upgrade path (using fixed fees from pricing engine)

2. **Upgrade Disclaimer Acknowledgement**:
   - Customer must acknowledge upgrade terms (ack only, no signature)
   - Terms include: upgrade fees apply to remaining time, no refunds, checkout time unchanged
   - Acknowledgement is stored in `lane_sessions.disclaimers_ack_json`
   - This gates further progress; customer cannot proceed without acknowledging

3. **Fallback Selection Required**:
   - Customer must select an available fallback rental type
   - Server validates fallback is available at selection time
   - Fallback is stored as `backup_rental_type` in lane session

4. **Waitlist Entry Created**:
   - Created when check-in completes (after assignment)
   - Links to visit and checkin_block
   - Status: ACTIVE until upgrade is offered

### Agreement Signing

1. **Requirement**: Agreement signature is required **only for INITIAL and RENEWAL checkin_blocks**
   - Upgrades do not require agreement signing
   - Agreement body is placeholder (empty text allowed for now)

2. **Signature Capture**:
   - Customer signs on kiosk touchscreen
   - Signature stored as PNG data URL or vector points JSON
   - Stored in `agreement_signatures` table, linked to `checkin_block_id`

3. **Gating**: Agreement must be signed before assignment can occur

### Payment Flow

1. **Amount Display**:
   - After agreement signed, customer sees amount due
   - Employee sees payment quote with line items
   - Payment intent created with status DUE

2. **External Payment**:
   - Employee takes payment in Square POS (external system)
   - Square runs on separate iPad

3. **Mark Paid**:
   - After Square payment succeeds, employee clicks "Mark Paid" in employee-register
   - Endpoint: `POST /v1/payments/:id/mark-paid`
   - Requires staff authentication
   - Updates payment intent status to PAID
   - Audited in audit_log

4. **Gating**: Assignment cannot occur until payment is marked PAID

### Assignment and Completion

1. **Assignment**:
   - Only after payment marked PAID, employee can assign room/locker
   - Employee selects from inventory lists (see "Employee Register Standard View" below)
   - Assignment uses transactional locking to prevent double-booking
   - Employee must click "Assign" to confirm

2. **Check-in Completion**:
   - After assignment, system creates visit and checkin_block
   - Room/locker transitions to OCCUPIED
   - Waitlist entry created if applicable
   - Lane session status → COMPLETED

3. **Reset**:
   - Both devices reset to idle state
   - Customer kiosk returns to logo-only screen
   - Employee register clears session state

### Employee Register Standard View

The employee register displays organized inventory lists:

1. **Four Dropdown Lists**:
   - Lockers (collapsible grid 001-108)
   - Standard rooms
   - Double rooms
   - Special rooms

2. **Ordering Within Each List**:
   - **Upgrade requests** (waitlist entries needing fulfillment) at top
   - Then **available** (status CLEAN, highlighted in green)
   - Then **cleaning** (status CLEANING)
   - Then **dirty** (status DIRTY)
   - Then **occupied** sorted by closest expiration (countdown, most expired first)

3. **Visual Indicators**:
   - If a room becomes available and there is a pending waitlist upgrade in that tier, outline that room in orange
   - Available rooms: green highlight
   - Near-expiration occupied: yellow/amber
   - Overdue occupied: red

4. **Assignment Behavior**:
   - Auto-select first available unit of chosen tier
   - Employee can click "Assign" to confirm, or choose a different unit of same tier then "Assign"
   - Assigning a different tier triggers customer confirmation on kiosk

### WebSocket Events

**Server → Client**:

- `SESSION_UPDATED` - Lane session created/updated (customer name, membership, allowed rentals, selection state)
- `SELECTION_PROPOSED` - Rental type proposed by customer or employee
- `SELECTION_LOCKED` - Selection confirmed and locked (first-confirm-wins)
- `SELECTION_ACKNOWLEDGED` - Other side acknowledged locked selection
- `WAITLIST_CREATED` - Waitlist entry created with position and ETA
- `ASSIGNMENT_CREATED` - Room/locker assigned
- `ASSIGNMENT_FAILED` - Assignment failed (race condition)
- `CUSTOMER_CONFIRMATION_REQUIRED` - Cross-type assignment requires customer confirmation
- `CUSTOMER_CONFIRMED` / `CUSTOMER_DECLINED` - Customer response to cross-type assignment

### Flow Sequence Summary

1. Employee scans ID → Customer identity captured
2. Both devices show customer name + rental options
3. Either side proposes selection → Other side sees proposal
4. First confirmation locks selection → Other side must acknowledge
5. If unavailable → Waitlist modal → ETA + position → Upgrade disclaimer ack → Fallback selection
6. Agreement signing (INITIAL/RENEWAL only) → Signature stored
7. Payment quote displayed → Employee takes payment in Square → Employee marks paid
8. Assignment → Employee confirms → Check-in completes → Both devices reset

### Office Dashboard (`apps/office-dashboard`)

**Purpose**: Administrative web application for oversight and management.

**Features**:

- Global view of all rooms and lockers
- Staff activity monitoring
- Waitlist management
- Override capabilities with audit logging
- Metrics and analytics dashboards
- Cleaning workflow management

**Technical Requirements**:

- Desktop-optimized responsive design
- Role-based access control
- Audit trail for all override actions
- Export capabilities for reporting

---

## API Service (`services/api`)

### REST Endpoints

| Method | Endpoint                    | Description                                              |
| ------ | --------------------------- | -------------------------------------------------------- |
| GET    | `/health`                   | Health check                                             |
| GET    | `/rooms`                    | List all rooms                                           |
| GET    | `/rooms/:id`                | Get room details                                         |
| PATCH  | `/rooms/:id/status`         | Update room status                                       |
| POST   | `/rooms/batch-status`       | Batch status update                                      |
| GET    | `/inventory`                | Get inventory summary                                    |
| GET    | `/lockers`                  | List all lockers                                         |
| POST   | `/sessions`                 | Create check-in session                                  |
| POST   | `/sessions/scan-id`         | Scan ID to create/update session with customer name      |
| POST   | `/sessions/scan-membership` | Scan membership to update session with membership number |
| GET    | `/sessions/active`          | List active sessions                                     |

### WebSocket Events

**Server → Client**:

- `ROOM_STATUS_CHANGED` - Room status transition
- `INVENTORY_UPDATED` - Inventory counts changed
- `ROOM_ASSIGNED` - Room assigned to customer
- `ROOM_RELEASED` - Room released from session
- `SESSION_UPDATED` - Session created or updated (contains customer_name, membership_number, allowed_rentals)

**Client → Server**:

- `subscribe` - Subscribe to specific event types
- `unsubscribe` - Unsubscribe from events

---

## Shared Package (`packages/shared`)

**Deprecated / superseded**: The enum lists and “data model” sketches previously in this section were historical and have drifted (e.g., legacy `members`/`sessions`, deprecated room types).

Use these canonical sources instead:

- `packages/shared/src/*` for TypeScript enums/schemas used by apps/services
- `openapi.yaml` for API request/response contracts
- `docs/database/DATABASE_SOURCE_OF_TRUTH.md` and `docs/database/DATABASE_ENTITY_DETAILS.md` for database meaning/contracts

---

## Cleaning Station Logic

### Batch Scanning

Staff can scan multiple room key tags in sequence:

1. Scan room tags (QR or NFC)
2. System determines primary action based on scanned statuses
3. If all same status → single action button
4. If mixed statuses → resolution UI required

### Resolution UI

When mixed statuses are scanned:

- Display per-room status sliders
- Each slider shows: DIRTY / CLEANING / CLEAN
- Only adjacent transitions allowed without override
- Override requires confirmation modal with reason

---

## Metrics & Analytics

### Tracked Metrics

| Metric            | Description                      |
| ----------------- | -------------------------------- |
| Response Time     | DIRTY → CLEANING transition time |
| Cleaning Duration | CLEANING → CLEAN transition time |
| Rooms Per Shift   | Count by staff member            |
| Batch Efficiency  | Rooms cleaned per batch          |

### Exclusions

Records excluded from metrics:

- Rooms with `overrideFlag: true`
- Transitions with anomalous timestamps (<30s or >4h)
- Test/training accounts

---

## Security Considerations

### Authentication

- JWT-based authentication
- Refresh token rotation
- Session timeout: 8 hours (staff), 30 minutes (kiosk idle)

### Authorization

| Role    | Capabilities                            |
| ------- | --------------------------------------- |
| Kiosk   | Read-only room availability             |
| Staff   | Check-in/out, room/locker assignment    |
| Manager | Override capabilities, staff management |
| Admin   | Full system access, audit logs          |

### Audit Logging

All state-changing operations logged:

- Timestamp
- User ID and role
- Action type
- Previous and new values
- Override reason (if applicable)

---

## Database Schema (Postgres)

**Deprecated / superseded**: This spec is not a database schema reference.

For canonical database meaning/contracts, see:

- `docs/database/DATABASE_SOURCE_OF_TRUTH.md`
- `docs/database/DATABASE_ENTITY_DETAILS.md`

For the current schema snapshot and history, see:

- `db/schema.sql`
- `services/api/migrations/`

---

## Development Roadmap

### Phase 1 (Current)

- [x] Monorepo scaffold
- [x] Shared types and validation
- [x] API skeleton with health check
- [x] WebSocket infrastructure
- [x] App scaffolds with placeholder UIs

### Phase 2

- [ ] Database integration
- [ ] Room CRUD operations
- [ ] Basic check-in flow
- [ ] Real-time inventory updates

### Phase 3

- [ ] Cleaning station workflow
- [ ] Batch operations
- [ ] Override system with audit

### Phase 4

- [ ] Metrics dashboard
- [ ] Staff management
- [ ] Reporting and exports
