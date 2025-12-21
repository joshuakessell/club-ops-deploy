# Migration 034: Normalize Identity on Customers - Summary

## Completed

### 1. Database Migration (034_normalize_identity_on_customers.sql)
- ✅ Backfilled customers from members
- ✅ Added customer_id columns to: visits, lane_sessions, checkout_requests, late_checkout_events, sessions, rooms, lockers
- ✅ Backfilled all customer_id columns from members via membership_number join
- ✅ Swapped foreign keys from members to customers
- ✅ Constrained checkin_blocks.rental_type to rental_type enum
- ✅ Added CHECK constraint to prevent new DELUXE/VIP room type assignments
- ✅ Updated indexes for new column names

### 2. TypeScript Types (packages/shared)
- ✅ Added RentalType enum
- ✅ Updated Room.assignedTo → assignedToCustomerId
- ✅ Updated Locker.assignedTo → assignedToCustomerId
- ✅ Updated CheckinBlock.rentalType to use RentalType enum
- ✅ Exported RentalType from shared package

### 3. Schema Documentation (db/schema.sql)
- ✅ Marked members table as LEGACY with comment
- ✅ Updated all foreign key references to use customers
- ✅ Updated column names (assigned_to → assigned_to_customer_id, member_id → customer_id)
- ✅ Updated rental_type to use enum type
- ✅ Updated indexes

### 4. API Routes - Partially Updated
- ✅ sessions.ts: Updated CreateSessionSchema (memberId → customerId), queries use customers table
- ⚠️ visits.ts: Partially updated (interfaces updated, some queries still need updating)
- ⚠️ Other routes: Need systematic updates

## Remaining Work

### API Routes Needing Updates
The following routes still reference `members` table or use `member_id`:

1. **visits.ts** - Needs complete update:
   - Replace all `members` queries with `customers`
   - Update `assigned_to` → `assigned_to_customer_id` in room/locker queries
   - Update `member_id` → `customer_id` in session inserts
   - Replace `member.` references with `customer.`

2. **checkin.ts** - Needs update:
   - Replace `members` queries with `customers`
   - Update lane session customer_id references
   - Update room/locker assignment queries

3. **checkout.ts** - Needs update:
   - Replace `members` queries with `customers`
   - Update customer lookup logic

4. **lanes.ts** - Needs update:
   - Replace `members` queries with `customers`
   - Update customer_id references

5. **upgrades.ts** - Needs update:
   - Replace `members` queries with `customers`

6. **waitlist.ts** - Needs update:
   - Replace `members` queries with `customers`

7. **agreements.ts** - Needs update:
   - Replace `members` queries with `customers`

8. **admin.ts** - May need updates if it references members

9. **inventory.ts** - Check for member references

10. **pricing/engine.ts** - Needs update:
    - Replace member lookups with customer lookups
    - Update DOB, membership validity, ban status to come from customers table

### Test Updates Needed
All test files need updates:
- Replace `memberId` with `customerId` in test data
- Replace `members` table inserts with `customers` table inserts
- Update all queries to use `customer_id` instead of `member_id`
- Update `assigned_to` → `assigned_to_customer_id` in room/locker queries

Key test files:
- `tests/auth.test.ts`
- `tests/checkin.test.ts`
- `tests/checkout.test.ts`
- `tests/cleaning.test.ts`
- `tests/agreements.test.ts`
- `tests/visits.test.ts`
- `tests/sessions.test.ts` (if exists)

### OpenAPI Schema Updates
- Update all schemas that reference `memberId` to use `customerId`
- Remove memberId from operational flow endpoints
- Update request/response examples

## Migration Execution

To apply the migration:
```bash
cd services/api
pnpm db:migrate
```

## Testing Strategy

1. Run migration on test database
2. Update test data setup to use customers table
3. Fix tests one file at a time
4. Run full test suite: `pnpm test`
5. Fix any remaining issues

## Notes

- The `members` table is kept for now but marked as legacy
- All foreign key dependencies have been migrated to `customers`
- The migration is designed to be safe and reversible (except for column renames)
- Existing data is preserved through backfill operations


