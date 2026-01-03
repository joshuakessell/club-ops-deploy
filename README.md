# Club Operations POS

A multi-application system for managing club check-ins, room inventory, cleaning workflows, and operational metrics.

## 🏗️ Architecture

```
club-operations-pos/
├── apps/
│   ├── customer-kiosk/      # Tablet-based kiosk UI for check-ins
│   ├── cleaning-station-kiosk/ # Staff tablet kiosk for cleaning workflow
│   ├── employee-register/   # Employee-facing tablet app (with Square POS)
│   ├── checkout-kiosk/      # Customer kiosk for self-service checkout initiation
│   └── office-dashboard/    # Web app for administration
├── services/
│   └── api/                 # Fastify REST API + WebSocket server
├── packages/
│   ├── shared/              # Shared types, enums, validators
│   └── ui/                  # Shared UI package (styles + components)
└── infra/                   # Infrastructure configs (placeholder)
```

## 🚀 Getting Started

### Mac Studio / macOS Quickstart

This repo runs cleanly on **macOS (Apple Silicon)** with **pnpm**.

**Prerequisites**

- **Node.js**: >= 18 (Node 20+ recommended)
- **pnpm**: pinned via `packageManager` in the root `package.json` (Corepack optional; using `pnpm` directly is fine)
- **Docker Desktop**: required for local Postgres (runs on host port **5433**)

**Note:** Do **not** use `sudo` for `pnpm` commands.

**Fast path (recommended)**

```bash
./scripts/bootstrap-mac.sh
```

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
pnpm db:start

# 3. Run database migrations
pnpm db:migrate

# 4. Seed the database with sample data
pnpm db:seed

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
- **Checkout Kiosk**: http://localhost:5177

### WebSockets

The UIs connect directly to the API WebSocket on port 3001:

- `ws://<host>:3001/ws`
- Some lane-specific streams use `ws://<host>:3001/ws?lane=LANE_1` (or `LANE_2`)

In local dev, Vite also proxies `/ws` to the API for convenience, but the apps currently construct the explicit `ws://<host>:3001/ws` URL.

### Repo Scan

Run these from repo root:

```bash
pnpm doctor
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

### Commands

| Command | Description |
|---------|-------------|
| `pnpm install` | Install all dependencies |
| `pnpm dev` | Start all services in development mode |
| `pnpm kill-ports` | Free dev ports (API + app ports, plus DB status check) |
| `pnpm doctor` | Repo health scan (builds deps, runs typecheck/lint/tests/build) |
| `pnpm db:start` | Start Postgres via `services/api/docker-compose.yml` |
| `pnpm db:stop` | Stop Postgres |
| `pnpm db:reset` | Recreate Postgres volume and restart |
| `pnpm db:migrate` | Run DB migrations |
| `pnpm db:seed` | Seed DB with sample data |
| `pnpm build` | Build all packages and apps |
| `pnpm test` | Run all tests |
| `pnpm lint` | Lint all packages |
| `pnpm typecheck` | TypeScript type checking |
| `pnpm format` | Format code with Prettier |

### Database Setup

The API uses PostgreSQL running in Docker. The database is configured to use port **5433** (mapped from container port 5432) to avoid conflicts with local PostgreSQL installations.

The DB scripts support both Docker Compose v2 (`docker compose`) and legacy Compose (`docker-compose`).

Database scripts automatically wait for Postgres readiness before running migrations or seeds. This avoids connection reset errors during container startup and works consistently across macOS, Linux, CI, and cloud environments.

**Database commands** (run from repo root):

```bash
# Start PostgreSQL in Docker
pnpm db:start

# Stop PostgreSQL
pnpm db:stop

# Run database migrations
pnpm db:migrate

# Reset database (drops all data and reruns migrations)
pnpm db:reset

# Seed database with sample data
pnpm db:seed
```

**Database Configuration:**
- Host: `localhost`
- Port: `5433`
- Database: `club_operations`
- User: `clubops`
- Password: `clubops_dev`

See `docs/database/DATABASE_SOURCE_OF_TRUTH.md` and `docs/database/DATABASE_ENTITY_DETAILS.md` for the canonical database contract. See [services/api/README.md](./services/api/README.md) for local database setup.

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

## 📋 Specifications and Documentation

**SPEC.md is the canonical source of truth** for business rules and product behavior. All implementation must align with SPEC.md.

### Key Specification Files

- **SPEC.md** - Technical specification and business rules (canonical)
- **AGENTS.md** - Agent coding guidelines and project architecture
- **openapi.yaml** - API contract (should match implemented endpoints)
- **db/schema.sql** - Database schema snapshot (should match current migrations)

### Database contract

The canonical sources of truth for **database/schema meaning**, **table/column contract**, and **invariants** are:

- `docs/database/DATABASE_SOURCE_OF_TRUTH.md`
- `docs/database/DATABASE_ENTITY_DETAILS.md`

They **supersede older scattered schema notes** across the repo. If there is any conflict, these docs win.

### Regenerating Schema Documentation

If migrations have changed and you need to update `db/schema.sql`:

```bash
# Option 1: Use pg_dump (if database is running)
cd services/api
pnpm db:start
pg_dump -h localhost -p 5433 -U clubops -d club_operations --schema-only > ../../db/schema.sql

# Option 2: Manually consolidate from migrations
# Review all files in services/api/migrations/ and create consolidated schema
```

If API endpoints have changed and you need to update `openapi.yaml`:

- Review all route files in `services/api/src/routes/`
- Update openapi.yaml to match actual endpoint paths, methods, and schemas
- Ensure security requirements (auth/admin) are documented correctly

### SPEC Compliance Check

Run the compliance check to ensure codebase aligns with SPEC.md:

```bash
pnpm spec:check
```

This validates:
- Room tier enums match SPEC.md (STANDARD, DOUBLE, SPECIAL)
- No forbidden tier strings exist (VIP, DELUXE, etc.)
- Room tier values are correct

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
   pnpm db:seed
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

## ☁️ Cursor Cloud Agents (optional)

This repo includes a conservative `.cursor/environment.json` that runs:

- `pnpm install`
- `pnpm typecheck`
- `pnpm test` (if Docker is available; otherwise runs unit tests that don’t require Postgres)

To snapshot and reuse the environment, use Cursor’s **Cloud Agent Setup** workflow and commit any generated config files you want to keep reproducible.

## 📝 License

Private - Internal use only.

