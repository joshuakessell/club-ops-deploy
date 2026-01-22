-- Add incident flags to telemetry_traces (idempotent).

CREATE TABLE IF NOT EXISTS telemetry_traces (
  trace_id TEXT PRIMARY KEY
);

ALTER TABLE telemetry_traces
  ADD COLUMN IF NOT EXISTS incident_open BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS incident_last_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_telemetry_traces_incident_open ON telemetry_traces(incident_open);
CREATE INDEX IF NOT EXISTS idx_telemetry_traces_incident_last ON telemetry_traces(incident_last_at DESC);
