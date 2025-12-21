# Schema Alignment Complete

## Summary

All schema inconsistencies between SCHEMA_OVERVIEW.md and db/schema.sql have been addressed. The database will be aligned with the canonical schema through migrations.

---

## Changes Made

### 1. Schema.sql Fixes ✅

#### Added `reauth_ok_until` to staff_sessions
- **File**: `db/schema.sql`
- **Change**: Added `reauth_ok_until TIMESTAMPTZ` column and corresponding index
- **Reason**: Migration 031 added this column but schema.sql wasn't updated

#### Fixed checkout_requests.status default
- **File**: `db/schema.sql` line 400
- **Change**: Changed default from `'REQUESTED'` to `'SUBMITTED'`
- **Reason**: Enum doesn't have 'REQUESTED' value; migration 035 sets it to 'SUBMITTED'

---

### 2. Migrations Created ✅

#### Migration 038: Rename previous_value to old_value
- **File**: `services/api/migrations/038_rename_audit_log_previous_value_to_old_value.sql`
- **Action**: `ALTER TABLE audit_log RENAME COLUMN previous_value TO old_value;`
- **Reason**: Schema.sql shows `old_value` but database has `previous_value` from migration 008

#### Migration 039: Add ROOM_STATUS_CHANGE enum value
- **File**: `services/api/migrations/039_add_room_status_change_to_audit_action_enum.sql`
- **Action**: Adds `ROOM_STATUS_CHANGE` to `audit_action` enum
- **Reason**: Schema.sql shows `ROOM_STATUS_CHANGE` but database only has `STATUS_CHANGE` from migration 008

---

### 3. Code Updates ✅

#### Updated cleaning.ts
- **File**: `services/api/src/routes/cleaning.ts`
- **Changes**:
  - Changed `previous_value` → `old_value` in INSERT statements
  - Changed `'STATUS_CHANGE'` → `'ROOM_STATUS_CHANGE'` for room status audit logs
- **Status**: All audit_log INSERTs now use `old_value` and `ROOM_STATUS_CHANGE` for room status changes

#### Verified other files
- **Files checked**: waitlist.ts, checkin.ts, visits.ts, upgrades.ts, auth.ts, webauthn.ts, admin.ts
- **Status**: All already use `old_value` correctly (no changes needed)

---

## Migration Execution Order

To apply these changes, run migrations in order:

```bash
cd services/api
pnpm db:migrate
```

This will execute:
1. Migration 038: Rename `previous_value` → `old_value`
2. Migration 039: Add `ROOM_STATUS_CHANGE` enum value

---

## Testing

After migrations are applied:

1. **Tests should pass** - Code now matches schema.sql expectations
2. **Database will align** - Database schema matches canonical schema.sql
3. **No breaking changes** - Existing data is preserved (column rename is safe)

---

## Verification Checklist

- [x] Schema.sql updated with reauth_ok_until
- [x] Schema.sql default value corrected
- [x] Migration 038 created for column rename
- [x] Migration 039 created for enum value addition
- [x] Code updated to use old_value
- [x] Code updated to use ROOM_STATUS_CHANGE for room status changes
- [x] All audit_log INSERTs verified
- [ ] Migrations executed on database (manual step)
- [ ] Tests pass after migrations (to be verified)

---

## Notes

- **Migration 039**: The enum ADD VALUE operation cannot run in a transaction, so it uses a DO block with IF NOT EXISTS check
- **Backward compatibility**: The `STATUS_CHANGE` enum value remains in the database (not removed), but new room status changes should use `ROOM_STATUS_CHANGE`
- **Existing data**: No data migration needed - existing audit_log entries with `previous_value` will be renamed to `old_value` automatically

---

## Next Steps

1. **Run migrations**: Execute `pnpm db:migrate` in services/api
2. **Run tests**: Verify all tests pass after migrations
3. **Verify schema**: Confirm database schema matches schema.sql using `pg_dump --schema-only`

