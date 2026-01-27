-- Establish baseline schema for telemetry domain.
-- Safe because this migration only creates telemetry domain objects on a fresh database.
-- Assumption: no cross-domain dependencies.
-- up migration
CREATE TABLE public.telemetry_events (
    id BIGSERIAL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    app text NOT NULL,
    level text NOT NULL,
    kind text NOT NULL,
    route text,
    message text,
    stack text,
    request_id text,
    session_id text,
    device_id text,
    lane text,
    method text,
    status integer,
    url text,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT telemetry_events_level_check CHECK ((level = ANY (ARRAY['error'::text, 'warn'::text, 'info'::text])))
);
CREATE TABLE public.telemetry_spans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trace_id text NOT NULL,
    app text DEFAULT 'unknown'::text NOT NULL,
    device_id text DEFAULT 'unknown'::text NOT NULL,
    session_id text DEFAULT 'unknown'::text NOT NULL,
    span_type text NOT NULL,
    name text,
    level text DEFAULT 'info'::text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    duration_ms integer,
    route text,
    method text,
    status integer,
    url text,
    message text,
    stack text,
    request_headers jsonb,
    response_headers jsonb,
    request_body jsonb,
    response_body jsonb,
    request_key text,
    incident_id text,
    incident_reason text,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL
);
CREATE TABLE public.telemetry_traces (
    trace_id text NOT NULL,
    app text DEFAULT 'unknown'::text NOT NULL,
    device_id text DEFAULT 'unknown'::text NOT NULL,
    session_id text DEFAULT 'unknown'::text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    incident_open boolean DEFAULT false NOT NULL,
    incident_last_at timestamp with time zone,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL
);
ALTER TABLE ONLY public.telemetry_events
    ADD CONSTRAINT telemetry_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.telemetry_traces
    ADD CONSTRAINT telemetry_traces_pkey PRIMARY KEY (trace_id);
ALTER TABLE ONLY public.telemetry_spans
    ADD CONSTRAINT telemetry_spans_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.telemetry_spans
    ADD CONSTRAINT telemetry_spans_trace_id_fkey FOREIGN KEY (trace_id) REFERENCES public.telemetry_traces(trace_id) ON DELETE CASCADE;
CREATE INDEX idx_telemetry_spans_incident_id ON public.telemetry_spans USING btree (incident_id);
CREATE INDEX idx_telemetry_spans_level ON public.telemetry_spans USING btree (level);
CREATE INDEX idx_telemetry_spans_request_key ON public.telemetry_spans USING btree (request_key);
CREATE INDEX idx_telemetry_spans_started_at ON public.telemetry_spans USING btree (started_at DESC);
CREATE INDEX idx_telemetry_spans_trace_id ON public.telemetry_spans USING btree (trace_id);
CREATE INDEX idx_telemetry_spans_type ON public.telemetry_spans USING btree (span_type);
CREATE INDEX idx_telemetry_traces_app ON public.telemetry_traces USING btree (app);
CREATE INDEX idx_telemetry_traces_device ON public.telemetry_traces USING btree (device_id);
CREATE INDEX idx_telemetry_traces_incident_last ON public.telemetry_traces USING btree (incident_last_at DESC);
CREATE INDEX idx_telemetry_traces_incident_open ON public.telemetry_traces USING btree (incident_open);
CREATE INDEX idx_telemetry_traces_last_seen ON public.telemetry_traces USING btree (last_seen_at DESC);
CREATE INDEX idx_telemetry_traces_session ON public.telemetry_traces USING btree (session_id);
CREATE INDEX telemetry_events_app_idx ON public.telemetry_events USING btree (app);
CREATE INDEX telemetry_events_created_at_idx ON public.telemetry_events USING btree (created_at);
CREATE INDEX telemetry_events_device_id_idx ON public.telemetry_events USING btree (device_id);
CREATE INDEX telemetry_events_kind_idx ON public.telemetry_events USING btree (kind);
CREATE INDEX telemetry_events_level_idx ON public.telemetry_events USING btree (level);
CREATE INDEX telemetry_events_request_id_idx ON public.telemetry_events USING btree (request_id);

-- down migration
DROP TABLE IF EXISTS public.telemetry_spans;
DROP TABLE IF EXISTS public.telemetry_traces;
DROP TABLE IF EXISTS public.telemetry_events;
