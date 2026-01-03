# Staff Scheduling, Timeclock, and Employee Documents Specification

## Overview

This specification defines the staff scheduling, timeclock compliance tracking, and employee document management system for the Club Operations POS. The system supports shift definitions, timeclock sessions, compliance computation, and secure document storage.

## Shift Definitions

### Shift Windows (AM/PM Format)

The system uses three predefined shift windows with overlapping coverage:

- **Shift A**: 12:00 AM to 8:00 AM
- **Shift B**: 7:45 AM to 4:00 PM
- **Shift C**: 3:45 PM to 12:00 AM

### Overlap Windows

- Shift A and Shift B overlap: 7:45 AM to 8:00 AM (15 minutes)
- Shift B and Shift C overlap: 3:45 PM to 4:00 PM (15 minutes)

### Storage Format

- Shift times are stored in the database as ISO timestamps (UTC or timezone-aware)
- UI displays shift labels using AM/PM format as shown above
- When rendering, convert stored timestamps to local timezone (America/Chicago) and format as AM/PM

## Scheduled Shifts Model

### Database Schema

**Deprecated / superseded**: This spec’s schema sketches are not authoritative and may not match the current database.

If/when scheduled shifts are implemented in the database, the canonical table/column meaning must be defined in:

- `docs/database/DATABASE_SOURCE_OF_TRUTH.md`
- `docs/database/DATABASE_ENTITY_DETAILS.md`

And reflected in `db/schema.sql` + `services/api/migrations/`.

### Shift Status Lifecycle

- **SCHEDULED**: Initial state when shift is created
- **UPDATED**: Shift times or details were modified by management
- **CANCELED**: Shift was canceled (employee should not work this shift)

### Management Permissions

- Only ADMIN role can create, update, or cancel shifts
- All shift modifications are audited with actor attribution
- Shift updates must preserve audit trail (created_by, updated_by)

## Timeclock Sessions Model

### Database Schema

**Deprecated / superseded**: This spec’s schema sketches are not authoritative and may not match the current database.

If/when timeclock sessions are implemented in the database, the canonical table/column meaning must be defined in:

- `docs/database/DATABASE_SOURCE_OF_TRUTH.md`
- `docs/database/DATABASE_ENTITY_DETAILS.md`

And reflected in `db/schema.sql` + `services/api/migrations/`.

### Automatic Timeclock Session Creation

Timeclock sessions are automatically created and closed based on employee sign-ins/sign-outs to terminals:

**Register Sign-In** (`/v1/registers/confirm`):
- When an employee signs into a register (Register 1 or 2), a timeclock session is automatically created
- Source: `EMPLOYEE_REGISTER`
- If employee already has an open timeclock session, it is reused (shift may be attached if not already)
- Nearest scheduled shift is automatically attached if within shift window or 60-minute pre-start window

**Register Sign-Out** (`/v1/registers/signout`):
- When an employee signs out of a register, the timeclock session is closed IF:
  - Employee is not signed into any other register, AND
  - Employee is not signed into cleaning station (no active staff_sessions)
- Sets `clock_out_at = NOW()` for the open timeclock session

**Cleaning Station Sign-In** (`/v1/auth/login-pin` or WebAuthn):
- When an employee signs into cleaning station (and not already signed into a register), a timeclock session is created
- Source: `OFFICE_DASHBOARD` (represents cleaning station/office terminal)
- Nearest scheduled shift is automatically attached if applicable

**Cleaning Station Sign-Out** (`/v1/auth/logout`):
- When an employee signs out of cleaning station, the timeclock session is closed IF:
  - Employee is not signed into any register, AND
  - Employee has no other active staff_sessions
- Sets `clock_out_at = NOW()` for the open timeclock session

**Shift Attachment Logic**:
- When creating a timeclock session, the system finds the nearest scheduled shift where:
  - `NOW()` is within the shift window (starts_at to ends_at), OR
  - `NOW()` is within 60 minutes before starts_at (pre-start grace window)
- If multiple shifts qualify due to overlap, attach to the shift whose start time is closest to NOW()
- If no shift qualifies, create unscheduled session (shift_id = NULL)

## Compliance Computation Rules

### Metrics Computed

For each scheduled shift, compute:

1. **workedMinutesInWindow**: Minutes worked that overlap with the scheduled shift window
2. **scheduledMinutes**: Total scheduled minutes (ends_at - starts_at)
3. **compliancePercent**: (workedMinutesInWindow / scheduledMinutes) * 100

### Flags

Compliance flags are determined with a 5-minute grace threshold:

- **lateClockIn**: Clock-in occurred after (starts_at + 5 minutes)
- **earlyClockOut**: Clock-out occurred before (ends_at - 5 minutes)
- **missingClockOut**: No clock-out recorded (clock_out_at IS NULL for past shifts)
- **noShow**: No timeclock session found for the scheduled shift

### Computation Algorithm

1. Find all timeclock sessions for the employee in the date range
2. For each scheduled shift:
   - Find timeclock sessions that overlap with shift window
   - Calculate overlap minutes
   - Determine flags based on clock-in/clock-out times relative to shift boundaries
   - Compute compliance percentage

### Grace Thresholds

- **Clock-in grace**: 5 minutes after scheduled start
- **Clock-out grace**: 5 minutes before scheduled end
- These thresholds are configurable but default to 5 minutes for demo

## Employee Documents Model

### Database Schema

**Deprecated / superseded**: This spec’s schema sketches are not authoritative and may not match the current database.

If/when employee documents are implemented in the database, the canonical table/column meaning must be defined in:

- `docs/database/DATABASE_SOURCE_OF_TRUTH.md`
- `docs/database/DATABASE_ENTITY_DETAILS.md`

And reflected in `db/schema.sql` + `services/api/migrations/`.

### Document Types

- **ID**: Government-issued identification
- **W4**: Tax withholding form
- **I9**: Employment eligibility verification
- **OFFER_LETTER**: Job offer letter
- **NDA**: Non-disclosure agreement
- **OTHER**: Other document types

### Access Control

- Only ADMIN role can upload documents
- Documents are associated with specific employees
- Download access requires authentication (ADMIN or the employee themselves)
- File storage uses local filesystem for POC (services/api/uploads/)
- Storage key format: `{employee_id}/{document_id}/{filename}`

### Storage Implementation

**POC (Proof of Concept)**:
- Store files in `services/api/uploads/` directory
- Create subdirectories by employee_id for organization
- Store actual files with storage_key referencing the path
- Ensure uploads directory exists and is writable

**Future (Production)**:
- Interface designed to support S3 replacement
- Storage key format remains stable
- Migration path: update storage backend without changing API

## Demo Mode Seeding

### Seeding Window

Generate shifts for a 28-day window:
- Past 14 days
- Next 14 days (including today)

### Seeding Rules

**Shifts**:
- Each day: Schedule enough employees across A/B/C shifts to appear staffed
- Rotate employees so coverage varies by day
- Use exact shift windows:
  - Shift A: 12:00 AM to 8:00 AM
  - Shift B: 7:45 AM to 4:00 PM
  - Shift C: 3:45 PM to 12:00 AM

**Timeclock Sessions** (for past days only):
- Most sessions match scheduled shifts (realistic compliance)
- Include realistic anomalies:
  - Late clock-in (after shift start + 5 minutes)
  - Early clock-out (before scheduled end - 5 minutes)
  - Missing clock-out (clock_out_at NULL for at least one past day, then manager closes it)

**Today (America/Chicago timezone)**:
- Ensure at least 2 employees are currently clocked in
- Ensure at least 1 scheduled shift is currently active

**Employee Documents**:
- Seed 1-2 employee document records per employee with realistic filenames and doc types (storage schema is TBD; see canonical DB docs if/when implemented)
- Optionally create stub files in uploads folder so downloads work in demo

### Idempotency

- Check if demo shifts already exist in the 28-day window
- If shifts exist, skip seeding (idempotent)
- Provide reset mechanism to clear demo data if needed

### Execution

- Run seeding on API startup when `DEMO_MODE=true` environment variable is set
- Only seed if demo data is not already present (idempotent check)
- Log seeding activity for debugging

## API Endpoints

### Admin Endpoints (requireAuth + requireAdmin)

#### GET /v1/admin/shifts

Query parameters:
- `from` (ISO date string, optional)
- `to` (ISO date string, optional)
- `employeeId` (UUID, optional)

Returns array of shifts with computed compliance fields:
```typescript
{
  id: string;
  employeeId: string;
  employeeName: string;
  shiftCode: 'A' | 'B' | 'C';
  scheduledStart: string; // ISO
  scheduledEnd: string; // ISO
  actualClockIn: string | null; // ISO
  actualClockOut: string | null; // ISO
  workedMinutesInWindow: number;
  scheduledMinutes: number;
  compliancePercent: number;
  flags: {
    lateClockIn: boolean;
    earlyClockOut: boolean;
    missingClockOut: boolean;
    noShow: boolean;
  };
  status: 'SCHEDULED' | 'UPDATED' | 'CANCELED';
  notes: string | null;
}
```

#### PATCH /v1/admin/shifts/:shiftId

Request body:
```typescript
{
  starts_at?: string; // ISO
  ends_at?: string; // ISO
  employee_id?: string; // UUID
  status?: 'SCHEDULED' | 'UPDATED' | 'CANCELED';
  notes?: string;
  shift_code?: 'A' | 'B' | 'C';
}
```

- Updates shift fields
- Sets `updated_by` to current admin
- Writes audit log entry `SHIFT_UPDATED` with actor

#### GET /v1/admin/timeclock

Query parameters:
- `from` (ISO date string, optional)
- `to` (ISO date string, optional)
- `employeeId` (UUID, optional)

Returns array of timeclock sessions for reporting and drilldown.

#### PATCH /v1/admin/timeclock/:sessionId

Request body:
```typescript
{
  clock_in_at?: string; // ISO
  clock_out_at?: string | null; // ISO or null
  notes?: string;
}
```

- Allows manager adjustments to clock times
- Writes audit log entry `TIMECLOCK_ADJUSTED` with actor

#### POST /v1/admin/timeclock/:sessionId/close

- Sets `clock_out_at = NOW()` if currently NULL
- Adds note indicating manager closure
- Writes audit log entry

#### Employee Documents

- `GET /v1/admin/employees/:employeeId/documents` - List documents for employee
- `POST /v1/admin/employees/:employeeId/documents` - Upload document (multipart/form-data)
- `GET /v1/admin/documents/:documentId` - Download document

### Runtime Endpoints (requireAuth)

#### POST /v1/timeclock/clock-in

Request body:
```typescript
{
  source: 'EMPLOYEE_REGISTER' | 'OFFICE_DASHBOARD';
  notes?: string;
}
```

- Creates new timeclock session
- Attaches nearest scheduled shift if applicable
- Returns session details

#### POST /v1/timeclock/clock-out

- Closes employee's open timeclock session
- Sets `clock_out_at = NOW()`
- Returns session details

## Audit Logging

All management actions are logged with:
- `action`: SHIFT_UPDATED | TIMECLOCK_ADJUSTED | TIMECLOCK_CLOSED | DOCUMENT_UPLOADED
- `entity_type`: employee_shift | timeclock_session | employee_document
- `entity_id`: UUID of affected entity
- `staff_id`: Actor who performed the action

## Frontend Requirements

### Navigation

Add to office-dashboard:
- "Shifts" navigation item
- "Timeclock" navigation item
- "Employees" → Documents tab (within employee profile)

### Shifts Page

- Filter bar: date range picker, employee selector
- Display shifts grouped by day or week view
- Show shift label with AM/PM format: "Shift A (12:00 AM–8:00 AM)"
- Display compliance badge and flags
- Edit shift modal (PATCH /admin/shifts/:id)
- Drilldown to view associated timeclock sessions

### Timeclock Page

- "Currently clocked in" list (real-time)
- "Hours by employee" table for selected date range
- Session list with ability to:
  - Close open sessions (admin only)
  - Edit clock times (admin only)

### Employee Documents

- Documents tab in employee detail screen
- List documents with type, filename, upload date
- Upload document button (multipart form)
- Download/view link for each document

## Quality Requirements

- All types compile across shared, api, and office-dashboard packages
- Follow existing styling conventions (black/white theme)
- Log important changes with actor attribution
- Handle timezone conversions correctly (America/Chicago)
- Gracefully handle missing data (null checks)

