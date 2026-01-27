-- Telemetry events for UI + backend error analysis.
-- Ingestion is best-effort; rows are append-only.

CREATE TABLE IF NOT EXISTS telemetry_events (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  app TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('error', 'warn', 'info')),
  kind TEXT NOT NULL,
  route TEXT,
  message TEXT,
  stack TEXT,
  request_id TEXT,
  session_id TEXT,
  device_id TEXT,
  lane TEXT,
  method TEXT,
  status INTEGER,
  url TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS telemetry_events_created_at_idx ON telemetry_events (created_at);
CREATE INDEX IF NOT EXISTS telemetry_events_app_idx ON telemetry_events (app);
CREATE INDEX IF NOT EXISTS telemetry_events_kind_idx ON telemetry_events (kind);
CREATE INDEX IF NOT EXISTS telemetry_events_level_idx ON telemetry_events (level);
CREATE INDEX IF NOT EXISTS telemetry_events_request_id_idx ON telemetry_events (request_id);
CREATE INDEX IF NOT EXISTS telemetry_events_device_id_idx ON telemetry_events (device_id);

-- Telemetry events table (UI + backend error capture)
-- Notes:
-- - keep payload small + indexed for easy triage
-- - safe to run multiple times

-- Ensure gen_random_uuid is available (many existing migrations already assume this)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS telemetry_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Source
  app VARCHAR(100) NOT NULL,                 -- 'customer-kiosk' | 'employee-register' | 'api'
  env VARCHAR(50) NOT NULL DEFAULT 'unknown', -- 'development' | 'production' | 'test' | etc
  kind VARCHAR(80) NOT NULL,                 -- e.g. 'ui.error', 'http.error', 'backend.error'
  level VARCHAR(10) NOT NULL,                -- 'error' | 'warn' | 'info'

  -- Correlation
  request_id VARCHAR(128),
  session_id VARCHAR(128),                   -- telemetry session id (per-tab)
  device_id VARCHAR(255),
  lane VARCHAR(50),
  route TEXT,

  -- Message
  message TEXT,
  stack TEXT,

  -- HTTP context (optional)
  url TEXT,
  method VARCHAR(20),
  status INTEGER,

  -- Client/server context
  user_agent TEXT,
  ip_address INET,

  -- Everything else
  meta JSONB
);

CREATE INDEX IF NOT EXISTS idx_telemetry_events_created_at ON telemetry_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_events_app ON telemetry_events(app);
CREATE INDEX IF NOT EXISTS idx_telemetry_events_kind ON telemetry_events(kind);
CREATE INDEX IF NOT EXISTS idx_telemetry_events_level ON telemetry_events(level);
CREATE INDEX IF NOT EXISTS idx_telemetry_events_request_id ON telemetry_events(request_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_events_device_id ON telemetry_events(device_id);
