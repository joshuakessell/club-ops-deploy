# Telemetry Workflow

## Ingestion
- UI events are captured by `@club-ops/ui` via `installTelemetry` and posted to `/api/v1/telemetry`.
- Backend errors and logs are captured by the API telemetry plugin in `services/api/src/telemetry/plugin.ts`.

## Storage
- All telemetry is stored in Postgres in the `telemetry_events` table.

## Viewing (Admin)
- Open **Office Dashboard → Telemetry** (admin-only).
- Filter by app/level/kind/lane/search and expand any row for full details.

## Exporting
- **UI**: Use the “Download JSON/CSV” buttons on the Telemetry page.
- **CLI**: `pnpm telemetry:export` (requires an admin bearer token).

Example:
```
ADMIN_TOKEN=YOUR_TOKEN SINCE=24h FORMAT=json OUT=./telemetry-export.json pnpm telemetry:export
```

Optional filters: `APP`, `LEVEL`, `KIND`, `LANE`, `Q`.

## ChatGPT Analysis
- Attach the exported JSON/CSV file and ask for clustering, grouping, and root-cause analysis.
