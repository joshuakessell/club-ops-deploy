# Database source of truth

This repository’s canonical definition of **database/schema meaning**, **table/column contracts**, and **invariants** lives in:

- `docs/database/DATABASE_SOURCE_OF_TRUTH.md` (this document)
- `docs/database/DATABASE_ENTITY_DETAILS.md`

If anything in code, migrations, `db/schema.sql`, OpenAPI docs, or other markdown files conflicts with these database contract docs, **these docs win**.

## What this document is (and isn’t)

- **This is**: the authoritative place to define *what the database means* (entity semantics, invariants, and contract expectations that code must uphold).
- **This is not**: a generated DDL dump.

For the current physical schema snapshot and the change history, see:

- `db/schema.sql` (schema-only snapshot)
- `services/api/migrations/` (migration history)

Those artifacts must remain consistent with the contract described here and in `DATABASE_ENTITY_DETAILS.md`.

## Contract rules (high level)

- **Naming/meaning beats legacy notes**: Any older schema notes are non-authoritative.
- **Invariants are enforceable**: When feasible, invariants should be enforced in the DB (constraints) and defended in the API layer.
- **Migrations follow the contract**: If a migration comment references older schema docs, it should be updated to reference these canonical docs.


