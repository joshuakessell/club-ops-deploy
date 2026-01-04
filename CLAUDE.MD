# Club Operations POS

A multi-application system for managing club check-ins, room inventory, cleaning workflows, and operational metrics. This is a TypeScript monorepo using pnpm workspaces.

## Project Overview

This system manages the complete lifecycle of room and locker rentals at a club:
- **Customer check-in** via dual-screen kiosks (customer + employee)
- **Inventory management** (rooms and lockers)
- **Cleaning workflow** tracking (DIRTY → CLEANING → CLEAN)
- **Checkout process** with self-service kiosks
- **Administrative dashboard** for staff management and metrics

## Architecture

```
club-operations-pos/
├── apps/                      # Frontend applications (Vite + React)
│   ├── customer-kiosk/       # Customer-facing check-in tablet
│   ├── employee-register/    # Employee check-in/assignment tablet
│   ├── cleaning-station-kiosk/ # Staff cleaning workflow tablet
│   ├── checkout-kiosk/       # Customer self-checkout tablet
│   └── office-dashboard/     # Admin web app
├── services/
│   └── api/                  # Fastify REST API + WebSocket server
├── packages/
│   ├── shared/              # Shared types, enums, Zod schemas
│   └── ui/                  # Shared UI components
└── docs/
    └── database/            # Database schema documentation
```

## Key Files & Documentation

**Primary source of truth files (READ THESE FIRST):**
- `SPEC.md` - Business rules and product behavior (canonical)
- `AGENTS.md` - Coding guidelines and architecture rules
- `docs/database/DATABASE_SOURCE_OF_TRUTH.md` - Database schema contract
- `docs/database/DATABASE_ENTITY_DETAILS.md` - Table/column details
- `openapi.yaml` - API contract

**Implementation must always align with these specs.**

## Development Workflow

### Setup
```bash
pnpm install              # Install all dependencies
pnpm db:start            # Start PostgreSQL (Docker, port 5433)
pnpm db:migrate          # Run migrations
pnpm db:seed             # Seed sample data
```

### Daily Development
```bash
pnpm dev                 # Start all services
pnpm kill-ports          # Free stuck ports if needed
```

### Quality Checks
```bash
pnpm doctor              # Full health check
pnpm typecheck           # TypeScript validation
pnpm lint                # ESLint
pnpm test                # Run all tests
pnpm build               # Build all packages
pnpm spec:check          # Validate SPEC.md compliance
```

### Application URLs (when running)
- API Server: http://localhost:3001
- Customer Kiosk: http://localhost:5173
- Cleaning Station: http://localhost:5174
- Employee Register: http://localhost:5175
- Office Dashboard: http://localhost:5176
- Checkout Kiosk: http://localhost:5177

## Critical Rules (NEVER VIOLATE)

1. **Server is the single source of truth** - Clients never assume state
2. **Concurrency must be safe** - Use transactional locking for assignments
3. **Room status transitions are enforced** - DIRTY → CLEANING → CLEAN → OCCUPIED
4. **Overrides exclude metrics** - Flagged transitions don't affect analytics
5. **Realtime is push-based** - WebSocket broadcasts, no polling
6. **Authentication is mandatory** - Staff auth required for employee apps
7. **NEVER use sudo** - Don't run pnpm/node commands as root

## Technology Stack

- **Frontend**: React + TypeScript + Vite
- **Backend**: Fastify + TypeScript
- **Database**: PostgreSQL (port 5433)
- **Validation**: Zod schemas
- **Package Manager**: pnpm (v10.27.0)
- **Monorepo**: pnpm workspaces

## Common Tasks

### Working with Database
```bash
pnpm db:start            # Start Postgres
pnpm db:stop             # Stop Postgres
pnpm db:migrate          # Run migrations
pnpm db:reset            # Drop and recreate
pnpm db:seed             # Add sample data
```

**Database connection:**
- Host: localhost
- Port: 5433
- Database: club_operations
- User: clubops
- Password: clubops_dev

### Adding New Features

Before making changes, check:
1. Does this affect pricing rules or membership logic?
2. Does this affect room tier mapping (Standard/Double/Special)?
3. Does this affect checkout late fee/ban logic?
4. Does this affect concurrency or locking?
5. Does this affect authentication requirements?

**If yes:** Explain impact and add/adjust tests.

### Code Standards

- TypeScript strict mode enabled
- Zod validation for all API request bodies
- Add tests for every bug fix and business rule
- Keep OpenAPI contract aligned with endpoints
- No backwards-compatibility hacks (delete unused code)
- Avoid over-engineering - make minimal necessary changes

## Shared Package Usage

### @club-ops/shared
Import shared types, enums, and validators:
```typescript
import { RoomStatus, RoomType } from '@club-ops/shared'
import { isAdjacentTransition, validateTransition } from '@club-ops/shared'
```

### @club-ops/ui
Import shared UI components:
```typescript
import { Button, Card } from '@club-ops/ui'
```

## WebSocket Integration

Apps connect to WebSocket server for real-time updates:
- Endpoint: `ws://localhost:3001/ws`
- Lane-specific: `ws://localhost:3001/ws?lane=LANE_1`
- Events: inventory updates, lane sessions, checkout notifications

## Finding Code

**Room/Locker inventory:** Start in `services/api/src/routes/rooms.ts`
**Check-in flow:** Start in `apps/employee-register/src/` and `apps/customer-kiosk/src/`
**Cleaning workflow:** Check `apps/cleaning-station-kiosk/src/`
**Authentication:** Look in `services/api/src/routes/auth.ts`
**Database schema:** See `services/api/migrations/` and `docs/database/`
**Business rules:** Always check `SPEC.md` first

## Troubleshooting

**Ports stuck?** Run `pnpm kill-ports`
**Type errors?** Run `pnpm build:deps` then `pnpm typecheck`
**Database issues?** Try `pnpm db:reset`
**Permission errors?** Never use sudo - fix file ownership instead
**Tests failing?** Ensure DB is running and migrations are up to date

## Important Notes

- This is a **private** repo for internal use only
- Square POS runs on separate iPads - we only track payment intents
- Employee Register: login once per shift, stays logged in
- Cleaning Station: must re-auth for each batch action
- Room tier enums: STANDARD, DOUBLE, SPECIAL (not VIP/DELUXE)
- Database docs supersede scattered schema notes across repo
