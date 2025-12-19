# Club Operations POS

A multi-application system for managing club check-ins, room inventory, cleaning workflows, and operational metrics.

## 🏗️ Architecture

```
club-operations-pos/
├── apps/
│   ├── customer-kiosk/      # Tablet-based kiosk UI for check-ins
│   ├── employee-register/   # Employee-facing tablet app (with Square POS)
│   └── office-dashboard/    # Web app for administration
├── services/
│   └── api/                 # Fastify REST API + WebSocket server
├── packages/
│   └── shared/              # Shared types, enums, validators
└── infra/                   # Infrastructure configs (placeholder)
```

## 🚀 Getting Started

### Prerequisites

- **Node.js** >= 18.0.0
- **pnpm** >= 8.0.0
- **Docker Desktop** (for local PostgreSQL)

### Local Setup

Follow these steps in order to get the development environment running:

```bash
# 1. Install all dependencies
pnpm install

# 2. Start PostgreSQL in Docker
pnpm --filter @club-ops/api db:start

# 3. Run database migrations
pnpm --filter @club-ops/api db:migrate

# 4. Seed the database with sample data
pnpm --filter @club-ops/api seed

# 5. Start all services in development mode
pnpm dev
```

### Development

After setup, you can start all services with:

```bash
pnpm dev
```

This starts:
- **API Server**: http://localhost:3001
  - Health check: http://localhost:3001/health
- **Customer Kiosk**: http://localhost:5173
- **Cleaning Station Kiosk**: http://localhost:5174
- **Employee Register**: http://localhost:5175
- **Office Dashboard**: http://localhost:5176

WebSocket endpoint: `ws://localhost:3001/ws`

### Commands

| Command | Description |
|---------|-------------|
| `pnpm install` | Install all dependencies |
| `pnpm dev` | Start all services in development mode |
| `pnpm build` | Build all packages and apps |
| `pnpm test` | Run all tests |
| `pnpm lint` | Lint all packages |
| `pnpm typecheck` | TypeScript type checking |
| `pnpm format` | Format code with Prettier |

### Database Setup

The API uses PostgreSQL running in Docker. The database is configured to use port **5433** (mapped from container port 5432) to avoid conflicts with local PostgreSQL installations.

**Database commands** (run from repo root):

```bash
# Start PostgreSQL in Docker
pnpm --filter @club-ops/api db:start

# Stop PostgreSQL
pnpm --filter @club-ops/api db:stop

# Run database migrations
pnpm --filter @club-ops/api db:migrate

# Check migration status
pnpm --filter @club-ops/api db:migrate:status

# Rollback last migration
pnpm --filter @club-ops/api db:migrate:rollback

# Reset database (drops all data and reruns migrations)
pnpm --filter @club-ops/api db:reset

# Seed database with sample data
pnpm --filter @club-ops/api seed
```

**Database Configuration:**
- Host: `localhost`
- Port: `5433`
- Database: `club_operations`
- User: `clubops`
- Password: `clubops_dev`

See [services/api/README.md](./services/api/README.md) for detailed database documentation.

## 📦 Packages

### `@club-ops/shared`

Shared code used across all apps and services:

- **Enums**: `RoomStatus`, `RoomType`
- **Transition validation**: `isAdjacentTransition()`, `validateTransition()`
- **Zod schemas**: Request/response validation
- **Types**: `Room`, `Locker`, `InventorySummary`, WebSocket events

### `@club-ops/api`

Fastify-based REST API server with WebSocket support:

- `GET /health` - Health check endpoint
- `ws://host:port/ws` - WebSocket for real-time updates

## 🔑 Core Rules

1. **Server is the single source of truth** - Clients never assume state
2. **Room status transitions are enforced** - DIRTY → CLEANING → CLEAN
3. **Overrides exclude metrics** - Flagged rooms don't affect analytics
4. **Concurrency is safe** - Transactional updates with row locking
5. **Realtime is push-based** - WebSocket broadcasts, no polling

See [AGENTS.md](./AGENTS.md) for complete coding guidelines.

## 🧪 Testing

```bash
# Run all tests
pnpm test

# Run tests in watch mode (specific package)
pnpm --filter @club-ops/shared test:watch
```

### Local Test Flow: Agreement and Upgrade

To test the agreement signing and upgrade disclaimer flows:

1. **Seed the database** (includes active agreement):
   ```bash
   pnpm --filter @club-ops/api seed
   ```

2. **Start development servers**:
   ```bash
   pnpm dev
   ```

3. **Create a check-in**:
   - Use the employee-register app to scan ID and membership
   - Create a session with a room assignment
   - The customer-kiosk will show the rental options

4. **Customer signs placeholder agreement**:
   - After selecting a rental option, the agreement screen appears
   - The agreement shows a blank scroll area (no text yet)
   - Customer must:
     - Check "I agree" checkbox
     - Sign on the signature pad
     - Click "Submit"
   - The screen cannot be bypassed - "Signature required to continue" is displayed

5. **Optionally join waitlist** (shows upgrade disclaimer):
   - Customer clicks "Join Waitlist for Upgrade"
   - Upgrade disclaimer modal appears with:
     - "Upgrade availability and time estimates are not guarantees."
     - "Upgrade fees are charged only if an upgrade becomes available and you choose to accept it."
     - "Upgrades do not extend your stay. Your checkout time remains the same as your original 6-hour check-in."
     - "The full upgrade fee applies even if limited time remains."
   - Customer clicks "OK" to acknowledge
   - Disclaimer acknowledgment is logged to audit_log

6. **Perform upgrade later** (shows disclaimer OK; no agreement re-sign):
   - When upgrade becomes available, customer accepts it
   - Upgrade disclaimer modal appears again
   - Customer acknowledges with "OK"
   - **No agreement re-signing required** (upgrades don't require agreement)
   - checkout_at remains unchanged (original check-in + 6 hours)

**Key Points:**
- Agreement is required for initial check-in and renewal (6-hour blocks)
- Agreement is NOT required for upgrades
- Upgrade disclaimer is shown only when joining waitlist or accepting upgrade
- checkout_at never changes on upgrade (always checkin_at + 6 hours)

## 📝 License

Private - Internal use only.

