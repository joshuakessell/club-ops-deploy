-- Telemetry traces + spans for incident reconstruction.
-- Idempotent and safe on existing DBs.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS telemetry_traces (
  trace_id TEXT PRIMARY KEY,
  app TEXT NOT NULL DEFAULT 'unknown',
  device_id TEXT NOT NULL DEFAULT 'unknown',
  session_id TEXT NOT NULL DEFAULT 'unknown',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  incident_open BOOLEAN NOT NULL DEFAULT false,
  incident_last_at TIMESTAMPTZ,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS telemetry_spans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id TEXT NOT NULL REFERENCES telemetry_traces(trace_id) ON DELETE CASCADE,
  app TEXT NOT NULL DEFAULT 'unknown',
  device_id TEXT NOT NULL DEFAULT 'unknown',
  session_id TEXT NOT NULL DEFAULT 'unknown',
  span_type TEXT NOT NULL,
  name TEXT,
  level TEXT NOT NULL DEFAULT 'info',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  duration_ms INTEGER,
  route TEXT,
  method TEXT,
  status INTEGER,
  url TEXT,
  message TEXT,
  stack TEXT,
  request_headers JSONB,
  response_headers JSONB,
  request_body JSONB,
  response_body JSONB,
  request_key TEXT,
  incident_id TEXT,
  incident_reason TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_telemetry_traces_last_seen ON telemetry_traces(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_traces_incident_open ON telemetry_traces(incident_open);
CREATE INDEX IF NOT EXISTS idx_telemetry_traces_incident_last ON telemetry_traces(incident_last_at DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_traces_app ON telemetry_traces(app);
CREATE INDEX IF NOT EXISTS idx_telemetry_traces_device ON telemetry_traces(device_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_traces_session ON telemetry_traces(session_id);

CREATE INDEX IF NOT EXISTS idx_telemetry_spans_trace_id ON telemetry_spans(trace_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_spans_started_at ON telemetry_spans(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_spans_type ON telemetry_spans(span_type);
CREATE INDEX IF NOT EXISTS idx_telemetry_spans_level ON telemetry_spans(level);
CREATE INDEX IF NOT EXISTS idx_telemetry_spans_incident_id ON telemetry_spans(incident_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_spans_request_key ON telemetry_spans(request_key);
