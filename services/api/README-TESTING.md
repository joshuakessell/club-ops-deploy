# Testing Guide

This guide explains how to set up and run tests for the Club Operations API.

## Prerequisites

1. **Docker Desktop** must be installed and running
2. **Node.js** and **pnpm** installed
3. Database migrations must be run before integration tests

## Quick Start

### 1. Start the Database

**Windows (PowerShell):**
```powershell
cd services/api
.\scripts\setup-db.ps1
```

**Linux/Mac:**
```bash
cd services/api
chmod +x scripts/setup-db.sh
./scripts/setup-db.sh
```

**Or manually:**
```bash
cd services/api
docker compose up -d
pnpm db:migrate
```

### 2. Run Tests

```bash
# Run all tests
pnpm test

# Run specific test file
pnpm test tests/pricing.test.ts

# Run in watch mode
pnpm test:watch
```

## Test Types

### Unit Tests
- **Pricing Engine** (`tests/pricing.test.ts`)
  - No database required
  - Tests pricing logic, discounts, membership fees
  - All 31 tests should pass

### Integration Tests
- **Check-in Flow** (`tests/checkin.test.ts`)
  - Requires database
  - Tests full check-in workflow
  - Tests concurrency and race conditions
  - Will skip if database is unavailable

- **Cleaning Batch** (`tests/cleaning.test.ts`)
  - Requires database
  - Tests room status transitions
  - Tests override logic

- **Auth** (`tests/auth.test.ts`)
  - Requires database
  - Tests staff authentication
  - Tests WebAuthn flows

## Database Setup

The test database uses Docker Compose:

- **Host:** localhost
- **Port:** 5433
- **Database:** club_operations
- **User:** clubops
- **Password:** clubops_dev

### Database Commands

```bash
# Start database
pnpm db:start

# Stop database
pnpm db:stop

# Run migrations
pnpm db:migrate

# Check migration status
pnpm db:migrate:status

# Reset database (WARNING: deletes all data)
pnpm db:reset
```

## Troubleshooting

### Database Connection Errors

If you see `ECONNREFUSED` errors:

1. **Check Docker is running:**
   ```bash
   docker info
   ```

2. **Check database container:**
   ```bash
   docker compose ps
   ```

3. **Check database logs:**
   ```bash
   docker compose logs postgres
   ```

4. **Restart database:**
   ```bash
   docker compose restart
   ```

### Migration Errors

If migrations fail:

1. **Check migration status:**
   ```bash
   pnpm db:migrate:status
   ```

2. **Check for conflicting migrations:**
   - Review `services/api/migrations/` directory
   - Ensure migration files are numbered sequentially

3. **Reset database (development only):**
   ```bash
   pnpm db:reset
   pnpm db:migrate
   ```

### Test Failures

1. **Ensure database is running and migrated:**
   ```bash
   docker compose ps
   pnpm db:migrate:status
   ```

2. **Check test output for specific errors:**
   - Integration tests will skip if database is unavailable
   - Look for "Skipped (database not available)" messages

3. **Run tests individually:**
   ```bash
   pnpm test tests/pricing.test.ts
   ```

## Continuous Integration

For CI/CD pipelines:

1. Start database:
   ```bash
   docker compose up -d
   ```

2. Wait for database:
   ```bash
   timeout 30 bash -c 'until docker compose exec -T postgres pg_isready -U clubops; do sleep 1; done'
   ```

3. Run migrations:
   ```bash
   pnpm db:migrate
   ```

4. Run tests:
   ```bash
   pnpm test
   ```

## Test Coverage

Current test coverage:

- ✅ Pricing engine: 100% (31 tests)
- ✅ Check-in flow: Integration tests (9 tests, requires DB)
- ✅ Cleaning batch: Integration tests (21 tests, requires DB)
- ✅ Auth: Integration tests (17 tests, requires DB)

## Writing New Tests

### Unit Tests (No Database)

```typescript
import { describe, it, expect } from 'vitest';
import { calculatePriceQuote } from '../src/pricing/engine.js';

describe('My Feature', () => {
  it('should work correctly', () => {
    const result = calculatePriceQuote({ ... });
    expect(result).toBe(expected);
  });
});
```

### Integration Tests (With Database)

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { query, initializeDatabase, closeDatabase } from '../src/db/index.js';

describe('My Feature', () => {
  let dbAvailable = false;

  beforeAll(async () => {
    try {
      await initializeDatabase();
      dbAvailable = true;
    } catch {
      console.warn('Database not available, skipping tests');
      return;
    }
  });

  afterAll(async () => {
    if (dbAvailable) {
      await closeDatabase();
    }
  });

  const runIfDbAvailable = (testFn: () => Promise<void>) => async () => {
    if (!dbAvailable) {
      console.log('    ↳ Skipped (database not available)');
      return;
    }
    await testFn();
  };

  it('should work with database', runIfDbAvailable(async () => {
    // Test code here
  }));
});
```




