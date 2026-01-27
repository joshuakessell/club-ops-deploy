-- Fix telemetry_events schema regardless of what migration 063 applied.
-- Requirements:
-- - Idempotent / safe on existing DBs
-- - Do not drop data, do not drop/recreate the table, do not change PK type
-- - Ensure required columns + defaults + indexes exist

-- Ensure table exists (keep id type unspecified if it already exists).
CREATE TABLE IF NOT EXISTS telemetry_events (
  id BIGSERIAL PRIMARY KEY
);

-- Ensure core columns exist.
ALTER TABLE telemetry_events
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS app TEXT,
  ADD COLUMN IF NOT EXISTS level TEXT,
  ADD COLUMN IF NOT EXISTS kind TEXT,
  ADD COLUMN IF NOT EXISTS route TEXT,
  ADD COLUMN IF NOT EXISTS message TEXT,
  ADD COLUMN IF NOT EXISTS stack TEXT,
  ADD COLUMN IF NOT EXISTS request_id TEXT,
  ADD COLUMN IF NOT EXISTS session_id TEXT,
  ADD COLUMN IF NOT EXISTS device_id TEXT,
  ADD COLUMN IF NOT EXISTS lane TEXT,
  ADD COLUMN IF NOT EXISTS method TEXT,
  ADD COLUMN IF NOT EXISTS status INTEGER,
  ADD COLUMN IF NOT EXISTS url TEXT,
  ADD COLUMN IF NOT EXISTS meta JSONB;

-- Optional-but-supported columns (safe for existing DBs and future ingestion).
ALTER TABLE telemetry_events
  ADD COLUMN IF NOT EXISTS env TEXT,
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS ip_address INET;

-- Defaults + NOT NULL constraints (backfill first so we never fail on existing data).
ALTER TABLE telemetry_events
  ALTER COLUMN created_at SET DEFAULT NOW();
UPDATE telemetry_events SET created_at = NOW() WHERE created_at IS NULL;
ALTER TABLE telemetry_events
  ALTER COLUMN created_at SET NOT NULL;

UPDATE telemetry_events SET app = 'unknown' WHERE app IS NULL OR btrim(app) = '';
ALTER TABLE telemetry_events
  ALTER COLUMN app SET NOT NULL;

UPDATE telemetry_events SET level = 'error' WHERE level IS NULL OR btrim(level) = '';
ALTER TABLE telemetry_events
  ALTER COLUMN level SET NOT NULL;

UPDATE telemetry_events SET kind = 'unknown' WHERE kind IS NULL OR btrim(kind) = '';
ALTER TABLE telemetry_events
  ALTER COLUMN kind SET NOT NULL;

-- Ensure meta is always present.
ALTER TABLE telemetry_events
  ALTER COLUMN meta SET DEFAULT '{}'::jsonb;
UPDATE telemetry_events SET meta = '{}'::jsonb WHERE meta IS NULL;
ALTER TABLE telemetry_events
  ALTER COLUMN meta SET NOT NULL;

-- If env exists (or we just added it), ensure inserts that omit it still work.
ALTER TABLE telemetry_events
  ALTER COLUMN env SET DEFAULT 'unknown';

-- Indexes (avoid duplicates by checking whether any index already references the column).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
    WHERE i.indrelid = 'telemetry_events'::regclass
      AND a.attname = 'created_at'
  ) THEN
    CREATE INDEX telemetry_events_created_at_idx ON telemetry_events (created_at);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
    WHERE i.indrelid = 'telemetry_events'::regclass
      AND a.attname = 'app'
  ) THEN
    CREATE INDEX telemetry_events_app_idx ON telemetry_events (app);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
    WHERE i.indrelid = 'telemetry_events'::regclass
      AND a.attname = 'kind'
  ) THEN
    CREATE INDEX telemetry_events_kind_idx ON telemetry_events (kind);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
    WHERE i.indrelid = 'telemetry_events'::regclass
      AND a.attname = 'level'
  ) THEN
    CREATE INDEX telemetry_events_level_idx ON telemetry_events (level);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
    WHERE i.indrelid = 'telemetry_events'::regclass
      AND a.attname = 'request_id'
  ) THEN
    CREATE INDEX telemetry_events_request_id_idx ON telemetry_events (request_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
    WHERE i.indrelid = 'telemetry_events'::regclass
      AND a.attname = 'device_id'
  ) THEN
    CREATE INDEX telemetry_events_device_id_idx ON telemetry_events (device_id);
  END IF;
END $$;

