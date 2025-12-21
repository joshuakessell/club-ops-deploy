# Schema Inconsistencies: SCHEMA_OVERVIEW.md vs db/schema.sql

## Summary

After comparing SCHEMA_OVERVIEW.md (conceptual source of truth) with db/schema.sql (current database state), here are the inconsistencies found:

---

## 1. Audit Log Column Names

### Issue
- **SCHEMA_OVERVIEW.md**: Describes audit_log with "before/after" (conceptual, doesn't specify exact names)
- **db/schema.sql**: Shows `old_value` and `new_value` columns
- **Actual Database (from migrations)**: Migration 008 created `previous_value` and `new_value`
- **Current Code**: Uses `previous_value` (after our fixes) and `STATUS_CHANGE` enum value

### Inconsistency
- Schema.sql claims `old_value` exists, but:
  - Migration 008 creates `previous_value`
  - No migration found that renames `previous_value` → `old_value`
  - Test database has `previous_value` (causing failures)

### Recommendation
**Option A**: Update schema.sql to match actual database (`previous_value`)
**Option B**: Create migration to rename `previous_value` → `old_value` (aligns with schema.sql intent)

**Decision Needed**: Which is the source of truth? Based on AGENTS.md, `db/schema.sql` is canonical, so we should migrate the database.

---

## 2. Audit Action Enum: ROOM_STATUS_CHANGE vs STATUS_CHANGE

### Issue
- **SCHEMA_OVERVIEW.md**: Mentions audit actions but doesn't specify exact enum values
- **db/schema.sql**: Lists `'ROOM_STATUS_CHANGE'` in audit_action enum (line 61)
- **Migration 008**: Creates enum with `'STATUS_CHANGE'` (not `ROOM_STATUS_CHANGE`)
- **Current Code**: Uses `STATUS_CHANGE` (after our fixes)
- **Test Database**: Has `STATUS_CHANGE` from migration 008

### Inconsistency
- Schema.sql shows `ROOM_STATUS_CHANGE` but no migration adds it
- Migration 008 creates `STATUS_CHANGE`
- Test database has `STATUS_CHANGE`

### Recommendation
**Option A**: Update schema.sql to show `STATUS_CHANGE` (matches current database)
**Option B**: Create migration to add `ROOM_STATUS_CHANGE` and update code (aligns with schema.sql intent)

**Decision Needed**: Schema.sql is canonical, so we should migrate.

---

## 3. Block Type Enum: FINAL_2H vs FINAL2H

### Issue
- **SCHEMA_OVERVIEW.md**: Mentions `checkin_blocks` with types `INITIAL_6H / RENEWAL_6H / FINAL_2H`
- **db/schema.sql**: block_type enum has `('INITIAL', 'RENEWAL', 'FINAL2H')` (no underscores, no duration suffix)
- **Migration 016**: Creates enum with `('INITIAL', 'RENEWAL', 'FINAL2H')`

### Inconsistency
- SCHEMA_OVERVIEW uses descriptive names with duration (`INITIAL_6H`, `RENEWAL_6H`, `FINAL_2H`)
- Actual schema uses shorter names (`INITIAL`, `RENEWAL`, `FINAL2H`)

### Status
**Minor**: SCHEMA_OVERVIEW is conceptual; actual implementation uses shorter enum values. This is acceptable as long as code is consistent.

---

## 4. Checkout Request Status: REQUESTED vs SUBMITTED

### Issue
- **SCHEMA_OVERVIEW.md**: Specifies `CheckoutRequestStatus: SUBMITTED, CLAIMED, VERIFIED, CANCELLED`
- **db/schema.sql**: Shows enum `('SUBMITTED', 'CLAIMED', 'VERIFIED', 'CANCELLED')`
- **Migration 019**: Creates enum, but original values unclear from search
- **Migration 035**: Renames `REQUESTED` → `SUBMITTED` and `COMPLETED` → `VERIFIED`

### Status
**ALIGNED**: Schema.sql shows correct values after migration 035. Code should use `SUBMITTED`.

---

## 5. Lane Session Mode: CHECKIN vs CHECKIN

### Issue
- **SCHEMA_OVERVIEW.md**: Specifies `LaneSessionMode: CHECKIN, RENEWAL`
- **db/schema.sql**: `checkin_mode VARCHAR(20) DEFAULT 'CHECKIN'`
- **Migration 027**: Adds checkin_mode, updated in 035 to match SCHEMA_OVERVIEW

### Status
**ALIGNED**: Schema.sql matches SCHEMA_OVERVIEW.

---

## 6. Missing Columns/Fields

### checkout_requests.status Initial Value
- **Schema.sql line 400**: Default status is `'REQUESTED'` (string literal)
- **Migration 035**: Changed enum to use `'SUBMITTED'` as default
- **Issue**: Schema.sql may show old default

### Verification Needed
Check if schema.sql reflects migration 035 changes correctly.

---

## 7. Agreement Signatures - checkin_id vs checkin_block_id

### Issue
- **SCHEMA_OVERVIEW.md**: Says "agreement_signature → checkin_block (required)"
- **db/schema.sql**: Has both:
  - `checkin_id UUID NOT NULL REFERENCES sessions(id)` (required, from migration 013)
  - `checkin_block_id UUID REFERENCES checkin_blocks(id)` (nullable, added in migration 017)

### Status
**PARTIAL**: Schema has both fields. SCHEMA_OVERVIEW suggests checkin_block should be the primary reference. This may be intentional (backwards compatibility) or needs clarification.

---

## 8. Payment Purpose Enum

### Issue
- **SCHEMA_OVERVIEW.md**: Mentions `PaymentPurpose` enum with values: CHECKIN/RENEWAL/LATE_FEE/UPGRADE/MEMBERSHIP_FEE/FINAL_EXTENSION_2H
- **db/schema.sql**: No payment_purpose enum found in schema.sql
- **payment_intents table**: Has no explicit purpose enum column

### Status
**MISSING**: Schema doesn't have payment_purpose enum, but SCHEMA_OVERVIEW expects it. Either:
- Add migration to create enum and column, OR
- Remove from SCHEMA_OVERVIEW if not implemented

---

## 9. Staff Sessions - reauth_ok_until

### Issue
- **SCHEMA_OVERVIEW.md**: Doesn't explicitly mention reauth_ok_until
- **db/schema.sql**: Doesn't show reauth_ok_until column
- **Migration 031**: Adds reauth_ok_until to staff_sessions
- **Current Code**: Uses reauth_ok_until in auth routes

### Status
**SCHEMA_GAP**: Migration exists but schema.sql doesn't reflect it. Schema.sql needs updating OR migration wasn't applied.

---

## 10. Sessions Table Structure

### Issue
- **SCHEMA_OVERVIEW.md**: Doesn't detail sessions table structure
- **db/schema.sql**: Shows `sessions` table with:
  - `checkin_at TIMESTAMPTZ` (not `check_in_time`)
  - `checkout_at TIMESTAMPTZ`
  - `status VARCHAR(50)` (not enum)
- **Migration 004**: Original migration may have used different names

### Status
**NEEDS VERIFICATION**: Check if code uses correct column names (`checkin_at` vs `check_in_time`).

---

## Additional Issues Found

### 11. staff_sessions.reauth_ok_until Missing from schema.sql

### Issue
- **Migration 031**: Adds `reauth_ok_until TIMESTAMPTZ` column to staff_sessions
- **db/schema.sql**: Does NOT include reauth_ok_until column (lines 183-192)
- **Current Code**: Uses reauth_ok_until in auth routes

### Status
**SCHEMA_OUT_OF_DATE**: Migration exists but schema.sql wasn't regenerated.

---

### 12. checkout_requests.status Default Value

### Issue
- **Migration 035**: Sets default to `'SUBMITTED'::checkout_request_status_new`
- **db/schema.sql line 400**: Shows `DEFAULT 'REQUESTED'` (invalid - 'REQUESTED' not in enum)
- **Enum values**: `('SUBMITTED', 'CLAIMED', 'VERIFIED', 'CANCELLED')` - no 'REQUESTED'

### Status
**SCHEMA_ERROR**: Schema.sql has incorrect default value. Should be `'SUBMITTED'`.

---

## Summary of Actions Needed

### Critical (Must Fix)
1. **audit_log column name**: 
   - Schema.sql says `old_value`, database has `previous_value`
   - **Action**: Create migration to rename `previous_value` → `old_value` (schema.sql is canonical)

2. **audit_action enum value**:
   - Schema.sql says `ROOM_STATUS_CHANGE`, database has `STATUS_CHANGE`
   - **Action**: Create migration to add `ROOM_STATUS_CHANGE` value OR update existing references

3. **staff_sessions.reauth_ok_until**:
   - Migration 031 adds it, but schema.sql missing it
   - **Action**: Update schema.sql to include the column

4. **checkout_requests.status default**:
   - Schema.sql shows `'REQUESTED'` but enum doesn't have it
   - **Action**: Update schema.sql default to `'SUBMITTED'`

### Medium Priority
5. **Payment purpose enum**: Implement as described in SCHEMA_OVERVIEW OR remove from docs
6. **Agreement signatures dual references**: Document/clarify why both checkin_id and checkin_block_id exist

### Low Priority (Acceptable Differences)
7. Block type enum naming (FINAL2H vs FINAL_2H) - implementation detail
8. sessions.checkin_at vs check_in_time - verify code uses correct name

---

## Recommended Fix Order

1. **Update schema.sql** to fix obvious errors (reauth_ok_until, checkout default)
2. **Create migrations** to align database with schema.sql:
   - Rename `previous_value` → `old_value` in audit_log
   - Add `ROOM_STATUS_CHANGE` to audit_action enum (or update all references)
3. **Update all code** to use `old_value` and `ROOM_STATUS_CHANGE`
4. **Update tests** to match corrected schema
5. **Regenerate schema.sql** from actual database after migrations run

