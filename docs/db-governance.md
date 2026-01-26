# Database Governance Rules

This database schema is governed by the following rules to ensure long-term maintainability, safety, and clarity.

## Source of Truth
- The live database and migration history are the source of truth.
- schema.sql is a generated artifact and must not be manually edited.

## Migrations
- All schema changes must be made via node-pg-migrate.
- Each migration must:
  - Have exactly one intent
  - Be scoped to a single domain
  - Be reversible
  - Include comments explaining why the change is safe

## Naming
- Migration filenames must follow:
  YYYYMMDDHHMM__<domain>__<intent>.sql
- Domains are fixed and documented.

## Deletions
- Tables may not be dropped unless:
  - They are not referenced in code
  - They have no foreign keys
  - pg_stat shows no reads
- Columns must be deprecated before removal.
- Enum values must be mapped before removal.

## Indexes
- Indexes must justify their existence with a query pattern.
- Unused indexes should be removed via migration.

## Reviews
- No migration may be merged without:
  - Static usage analysis
  - Database usage analysis
  - Explicit rollback plan

## Goal
This schema should feel deliberate, boring, and predictable.
