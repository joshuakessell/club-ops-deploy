# Club Dallas POS System Spec (Index + Invariants)

This file is the stable entry point: business invariants + where to find details.
Do not duplicate the API contract (openapi.yaml) or DB definitions (docs/database/\*) here.

## Canonical terminology

Room tiers (runtime): STANDARD | DOUBLE | SPECIAL
Rental types: LOCKER | STANDARD | DOUBLE | SPECIAL | GYM_LOCKER
Legacy tier names must not appear in runtime code or UI copy; use STANDARD/DOUBLE/SPECIAL.

## Facility inventory contract

- Lockers: 001–108
- Rooms: 200–262 excluding known non-existent numbers
  Canonical list lives in: packages/shared/src/inventory.ts

## System invariants

- Server is the single source of truth for inventory, eligibility, pricing, assignments
- Concurrency safety: assignments and status transitions are transactional
- Room status transitions:
  - Normal: DIRTY → CLEANING → CLEAN → OCCUPIED → DIRTY
  - Skipping steps requires explicit override + audit reason
- Overrides/anomalies must be flagged and excluded from metrics

## Security model

- Staff/admin actions require staff authentication
- Customer/kiosk actions require kiosk token (or staff auth) even if “on LAN”
- WebSocket connections must be authenticated (kiosk token or staff)

## Realtime contract

Canonical event types and payload schemas:

- packages/shared/src/types.ts
- packages/shared/src/websocketSchemas.ts

## Where details live

- API contract: openapi.yaml
- DB meaning/contracts: docs/database/\*
- Monorepo structure (canonical): docs/FILE_STRUCTURE.md
- Check-in / lane session flows: docs/specs/\* (add new spec docs here)
- Register sessions admin: docs/specs/register-sessions-admin.md
- Staff scheduling + timeclock + documents: docs/specs/staff-scheduling-timeclock-documents.md

## Change process

If you change business rules:

1. update tests
2. update openapi.yaml as needed
3. update/append docs/specs/\* and keep this file short
