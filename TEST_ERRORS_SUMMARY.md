# Test Errors Summary

## Overall Statistics
- **Total Failed Tests**: 44
- **Test Files Affected**: 6 (auth, cleaning, checkout, agreements, visits, checkin)
- **Passing Tests**: 65

## Error Categories

### 1. 500 Internal Server Errors (Most Common - ~30 tests)
These suggest exceptions being thrown in the code.

**Affected Areas:**
- Auth routes: PIN login, re-authentication flows
- Cleaning routes: Batch status transitions  
- Checkout routes: Late fee calculations
- Agreement routes: Agreement signing
- Visit routes: Block creation and agreement signing

**Common Pattern**: Tests expect 200/201 but get 500, indicating unhandled exceptions.

### 2. 404 Not Found Errors (~8 tests)
**Affected Areas:**
- Check-in flow: sign-agreement endpoint
- Visit creation: initial/renewal block creation
- Agreement signing for upgrades
- Ban enforcement checks

### 3. 400 Bad Request Errors (~5 tests)
**Affected Areas:**
- Upgrade disclaimer logging (waitlist/upgrade)
- Some cleaning transitions (DIRTY → CLEANING gets 400 instead of expected 200)

### 4. Foreign Key Constraint Violations (~4 tests)
**Specific Errors:**
- `checkout_requests_customer_id_fkey`: Tests trying to insert checkout_requests with non-existent customer_id
- `sessions_customer_id_fkey`: Test cleanup trying to delete customers still referenced by sessions

### 5. Undefined Property Access (~3 tests)
- `Cannot read properties of undefined (reading 'agreement_text_snapshot')`
- `Cannot read properties of undefined (reading 'id')` (visit.id)

### 6. 401 Unauthorized Errors (~2 tests)
- Check-in select-rental endpoint

### 7. 403 Forbidden Errors (~1 test)
- Admin credential revocation (gets 403 instead of 200)

## Potential Root Causes

### A. Database/Transaction Issues (LIKELY PRIMARY CAUSE)
- Many 500 errors occur in routes using database transactions (`transaction()` function)
- Pattern: All failing endpoints use `transaction()` or `serializableTransaction()` from db/index.ts
- Possible issues:
  - Transaction client not properly handling errors
  - Connection pool issues
  - Missing database initialization in some test scenarios

### B. Authentication Middleware
- Auth tests don't mock middleware (unlike cleaning tests which mock requireAuth)
- Some endpoints may be failing auth checks unexpectedly
- Re-authentication flows consistently failing (all return 500)
- Pattern: Auth-related endpoints that don't require auth (like login-pin) still fail

### C. Missing Test Data Dependencies  
- Foreign key violations indicate missing prerequisite records
- Pattern: Tests trying to insert records with foreign keys to non-existent records
- Specific cases:
  - checkout_requests referencing customers that don't exist
  - Sessions referencing customers that are being deleted in cleanup

### D. Error Handling Visibility
- 500 errors are being caught but actual error messages aren't visible
- NODE_ENV not set to 'test' in vitest config (FIXED: now set in vitest.config.ts)
- Some routes (cleaning) don't include error details even in test mode (unlike auth/checkout routes)

## COMMONALITY ANALYSIS

### ROOT CAUSE IDENTIFIED

**Primary Issue: PostgreSQL Type Error in Staff Lookup Queries**

The error message reveals the problem:
```
"operator does not exist: character varying ~~* uuid"
```

**Location**: `services/api/src/routes/auth.ts` and `services/api/src/routes/webauthn.ts`

**Problem**: The SQL query tries to use ILIKE (text operator) on a UUID column:
```sql
WHERE (id = $1 OR name ILIKE $1)  -- WRONG: id is UUID, can't use ILIKE
```

**Fix Applied**: Cast UUID to text for comparison:
```sql
WHERE (id::text = $1 OR name ILIKE $1)  -- CORRECT: cast UUID to text first
```

This single fix should resolve **ALL auth-related 500 errors** (PIN login, re-auth, WebAuthn).

**Secondary Pattern**:
- Foreign key constraint violations are test setup issues (missing prerequisite data)
- These are separate from the 500 errors and can be fixed by ensuring test data is properly created
- Tests need to create customers before creating checkout_requests that reference them

## Recommendations

1. **Enable detailed error logging in tests** - Modify error handlers to include error details when NODE_ENV=test
2. **Fix test data setup** - Ensure all foreign key dependencies are created before use
3. **Review transaction error handling** - Check if transactions are properly rolling back on errors
4. **Add error response inspection** - Tests should log response.body on failure to see actual error messages
5. **Verify database schema** - Ensure migrations are up to date and constraints match expectations

