# Database entity details

This document is canonical for **table-by-table meaning**, **column-level contracts**, and **invariants**.

If any other documentation (including historical “schema overview” notes) conflicts with this document, **this document wins**.

## How to use

- Use this doc when implementing or reviewing:
  - API behavior that reads/writes the DB
  - migrations in `services/api/migrations/`
  - schema snapshot updates in `db/schema.sql`
- When you discover a mismatch between code and database meaning, fix the mismatch by updating code/migrations and/or these docs (these docs define the intended contract).

## Entities (contract overview)

This repo contains a number of operational entities (customers, visits, lane sessions, inventory units like rooms/lockers, checkout requests, audit logs, etc.).

The detailed per-table sections should live here, and should capture at minimum:

- **Purpose**: what the table represents in the product
- **Primary key**: identifier and how it is used
- **Key columns**: required vs optional, meaning, and lifecycle
- **Relationships**: foreign keys and ownership rules
- **Invariants**: rules that must always hold (constraints + application enforcement)

> Note: The current DDL snapshot is in `db/schema.sql`, and the schema evolution history is in `services/api/migrations/`. Those artifacts must match the meaning and invariants described here.


