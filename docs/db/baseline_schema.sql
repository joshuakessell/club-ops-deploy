-- Canonical baseline schema (documentation only; not executable migration).
-- Organized by domain; order: extensions, enums, tables, constraints, indexes.
-- Domain intent map:
-- core: customers + visits
-- sessions: check-in session state, agreements, reservations
-- inventory: rooms, lockers, key tags
-- ops: checkout, cleaning, devices/registers
-- finance: payment intents + charges
-- audit: audit_log
-- telemetry: telemetry events + traces/spans
-- hr: staff, auth sessions, scheduling, timekeeping, documents
-- meta: migration tracking

-- Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

-- Enums
-- domain: hr
CREATE TYPE public.shift_status AS ENUM (
    'SCHEDULED',
    'UPDATED',
    'CANCELED'
);

CREATE TYPE public.staff_role AS ENUM (
    'STAFF',
    'ADMIN'
);

CREATE TYPE public.time_off_request_status AS ENUM (
    'PENDING',
    'APPROVED',
    'DENIED'
);

-- domain: inventory
CREATE TYPE public.key_tag_type AS ENUM (
    'QR',
    'NFC'
);

CREATE TYPE public.room_status AS ENUM (
    'DIRTY',
    'CLEANING',
    'CLEAN',
    'OCCUPIED'
);

CREATE TYPE public.room_type AS ENUM (
    'STANDARD',
    'DELUXE',
    'VIP',
    'LOCKER',
    'DOUBLE',
    'SPECIAL'
);

-- domain: sessions
CREATE TYPE public.block_type AS ENUM (
    'INITIAL',
    'RENEWAL',
    'FINAL2H'
);

CREATE TYPE public.inventory_reservation_kind AS ENUM (
    'LANE_SELECTION',
    'UPGRADE_HOLD'
);

CREATE TYPE public.inventory_resource_type AS ENUM (
    'room',
    'locker'
);

CREATE TYPE public.lane_session_status AS ENUM (
    'IDLE',
    'ACTIVE',
    'AWAITING_CUSTOMER',
    'AWAITING_ASSIGNMENT',
    'AWAITING_PAYMENT',
    'AWAITING_SIGNATURE',
    'COMPLETED',
    'CANCELLED'
);

CREATE TYPE public.rental_type AS ENUM (
    'LOCKER',
    'STANDARD',
    'DOUBLE',
    'SPECIAL',
    'GYM_LOCKER'
);

CREATE TYPE public.waitlist_status AS ENUM (
    'ACTIVE',
    'OFFERED',
    'COMPLETED',
    'CANCELLED',
    'EXPIRED'
);

-- domain: finance
CREATE TYPE public.payment_status AS ENUM (
    'DUE',
    'PAID',
    'CANCELLED',
    'REFUNDED'
);

-- domain: ops
CREATE TYPE public.checkout_request_status AS ENUM (
    'SUBMITTED',
    'CLAIMED',
    'VERIFIED',
    'CANCELLED'
);

-- domain: audit
CREATE TYPE public.audit_action AS ENUM (
    'CREATE',
    'UPDATE',
    'DELETE',
    'STATUS_CHANGE',
    'ASSIGN',
    'RELEASE',
    'OVERRIDE',
    'CHECK_IN',
    'CHECK_OUT',
    'UPGRADE_DISCLAIMER',
    'STAFF_WEBAUTHN_ENROLLED',
    'STAFF_LOGIN_WEBAUTHN',
    'STAFF_LOGIN_PIN',
    'STAFF_LOGOUT',
    'STAFF_WEBAUTHN_REVOKED',
    'STAFF_PIN_RESET',
    'STAFF_REAUTH_REQUIRED',
    'STAFF_CREATED',
    'STAFF_UPDATED',
    'STAFF_ACTIVATED',
    'STAFF_DEACTIVATED',
    'REGISTER_SIGN_IN',
    'REGISTER_SIGN_OUT',
    'REGISTER_FORCE_SIGN_OUT',
    'WAITLIST_CREATED',
    'WAITLIST_CANCELLED',
    'WAITLIST_OFFERED',
    'WAITLIST_COMPLETED',
    'UPGRADE_STARTED',
    'UPGRADE_PAID',
    'UPGRADE_COMPLETED',
    'FINAL_EXTENSION_STARTED',
    'FINAL_EXTENSION_PAID',
    'FINAL_EXTENSION_COMPLETED',
    'STAFF_REAUTH_PIN',
    'STAFF_REAUTH_WEBAUTHN',
    'ROOM_STATUS_CHANGE',
    'SHIFT_UPDATED',
    'TIMECLOCK_ADJUSTED',
    'TIMECLOCK_CLOSED',
    'DOCUMENT_UPLOADED',
    'TIME_OFF_REQUESTED',
    'TIME_OFF_APPROVED',
    'TIME_OFF_DENIED'
);

-- Tables
-- domain: core
CREATE TABLE public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    dob date,
    membership_number character varying(50),
    membership_card_type character varying(20),
    membership_valid_until date,
    banned_until timestamp with time zone,
    id_scan_hash character varying(255),
    id_scan_value text,
    primary_language text,
    notes text,
    past_due_balance numeric(10,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customers_primary_language_check CHECK ((primary_language = ANY (ARRAY['EN'::text, 'ES'::text])))
);

CREATE TABLE public.visits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    customer_id uuid NOT NULL
);

-- domain: hr
CREATE TABLE public.employee_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    doc_type text NOT NULL,
    filename text NOT NULL,
    mime_type text NOT NULL,
    storage_key text NOT NULL,
    uploaded_by uuid NOT NULL,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    notes text,
    sha256_hash text,
    CONSTRAINT employee_documents_doc_type_check CHECK ((doc_type = ANY (ARRAY['ID'::text, 'W4'::text, 'I9'::text, 'OFFER_LETTER'::text, 'NDA'::text, 'OTHER'::text])))
);

CREATE TABLE public.employee_shifts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    shift_code text NOT NULL,
    role text,
    status public.shift_status DEFAULT 'SCHEDULED'::public.shift_status NOT NULL,
    notes text,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT employee_shifts_shift_code_check CHECK ((shift_code = ANY (ARRAY['A'::text, 'B'::text, 'C'::text])))
);

CREATE TABLE public.staff (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    role public.staff_role DEFAULT 'STAFF'::public.staff_role NOT NULL,
    qr_token_hash character varying(255),
    pin_hash character varying(255),
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.staff_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    staff_id uuid NOT NULL,
    device_id character varying(255) NOT NULL,
    device_type character varying(50) NOT NULL,
    session_token character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    expires_at timestamp with time zone NOT NULL,
    reauth_ok_until timestamp with time zone
);

CREATE TABLE public.staff_webauthn_credentials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    staff_id uuid NOT NULL,
    device_id character varying(255) NOT NULL,
    credential_id text NOT NULL,
    public_key text NOT NULL,
    sign_count bigint DEFAULT 0 NOT NULL,
    transports jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone,
    revoked_at timestamp with time zone
);

CREATE TABLE public.time_off_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    day date NOT NULL,
    reason text,
    status public.time_off_request_status DEFAULT 'PENDING'::public.time_off_request_status NOT NULL,
    decided_by uuid,
    decided_at timestamp with time zone,
    decision_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.timeclock_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    shift_id uuid,
    clock_in_at timestamp with time zone NOT NULL,
    clock_out_at timestamp with time zone,
    source text NOT NULL,
    created_by uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT timeclock_sessions_source_check CHECK ((source = ANY (ARRAY['EMPLOYEE_REGISTER'::text, 'OFFICE_DASHBOARD'::text])))
);

CREATE TABLE public.webauthn_challenges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    challenge text NOT NULL,
    staff_id uuid,
    device_id character varying(255),
    type character varying(50) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- domain: inventory
CREATE TABLE public.key_tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid,
    locker_id uuid,
    tag_type public.key_tag_type NOT NULL,
    tag_code character varying(255) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT key_tags_exactly_one_target_chk CHECK (((
CASE
    WHEN (room_id IS NULL) THEN 0
    ELSE 1
END +
CASE
    WHEN (locker_id IS NULL) THEN 0
    ELSE 1
END) = 1))
);

CREATE TABLE public.lockers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    number character varying(20) NOT NULL,
    status public.room_status DEFAULT 'CLEAN'::public.room_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    assigned_to_customer_id uuid
);

CREATE TABLE public.rooms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    number character varying(20) NOT NULL,
    type public.room_type DEFAULT 'STANDARD'::public.room_type NOT NULL,
    status public.room_status DEFAULT 'CLEAN'::public.room_status NOT NULL,
    floor integer DEFAULT 1 NOT NULL,
    last_status_change timestamp with time zone DEFAULT now() NOT NULL,
    override_flag boolean DEFAULT false NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    assigned_to_customer_id uuid,
    CONSTRAINT rooms_type_no_deprecated CHECK ((type <> ALL (ARRAY['DELUXE'::public.room_type, 'VIP'::public.room_type])))
);

-- domain: sessions
CREATE TABLE public.agreement_signatures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agreement_id uuid NOT NULL,
    customer_name character varying(255) NOT NULL,
    membership_number character varying(50),
    signed_at timestamp with time zone DEFAULT now() NOT NULL,
    signature_png_base64 text,
    signature_strokes_json jsonb,
    agreement_text_snapshot text NOT NULL,
    agreement_version character varying(50) NOT NULL,
    device_id character varying(255),
    device_type character varying(50),
    user_agent text,
    ip_address inet,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    checkin_block_id uuid
);

CREATE TABLE public.agreements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    version character varying(50) NOT NULL,
    title character varying(255) NOT NULL,
    body_text text DEFAULT ''::text NOT NULL,
    active boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.checkin_blocks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    visit_id uuid NOT NULL,
    block_type public.block_type NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    room_id uuid,
    locker_id uuid,
    session_id uuid,
    agreement_signed boolean DEFAULT false NOT NULL,
    agreement_pdf bytea,
    agreement_signed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    has_tv_remote boolean DEFAULT false NOT NULL,
    waitlist_id uuid,
    rental_type public.rental_type NOT NULL
);

CREATE TABLE public.inventory_reservations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    resource_type public.inventory_resource_type NOT NULL,
    resource_id uuid NOT NULL,
    kind public.inventory_reservation_kind NOT NULL,
    lane_session_id uuid,
    waitlist_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    released_at timestamp with time zone,
    release_reason text,
    CONSTRAINT inventory_reservations_lane_session_required CHECK (((kind <> 'LANE_SELECTION'::public.inventory_reservation_kind) OR (lane_session_id IS NOT NULL))),
    CONSTRAINT inventory_reservations_waitlist_required CHECK (((kind <> 'UPGRADE_HOLD'::public.inventory_reservation_kind) OR (waitlist_id IS NOT NULL)))
);

CREATE TABLE public.lane_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lane_id character varying(50) NOT NULL,
    status public.lane_session_status DEFAULT 'IDLE'::public.lane_session_status NOT NULL,
    staff_id uuid,
    customer_display_name character varying(255),
    membership_number character varying(50),
    desired_rental_type public.rental_type,
    waitlist_desired_type public.rental_type,
    backup_rental_type public.rental_type,
    assigned_resource_id uuid,
    assigned_resource_type character varying(20),
    price_quote_json jsonb,
    disclaimers_ack_json jsonb,
    payment_intent_id uuid,
    membership_purchase_intent character varying(20),
    membership_purchase_requested_at timestamp with time zone,
    membership_choice character varying(20),
    kiosk_acknowledged_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    checkin_mode character varying(20) DEFAULT 'CHECKIN'::character varying,
    renewal_hours integer,
    customer_id uuid,
    proposed_rental_type public.rental_type,
    proposed_by character varying(20),
    selection_confirmed boolean DEFAULT false,
    selection_confirmed_by character varying(20),
    selection_locked_at timestamp with time zone,
    CONSTRAINT lane_sessions_membership_choice_check CHECK ((((membership_choice)::text = ANY (ARRAY[('ONE_TIME'::character varying)::text, ('SIX_MONTH'::character varying)::text])) OR (membership_choice IS NULL))),
    CONSTRAINT lane_sessions_renewal_hours_check CHECK (((renewal_hours = ANY (ARRAY[2, 6])) OR (renewal_hours IS NULL))),
    CONSTRAINT lane_sessions_proposed_by_check CHECK (((proposed_by)::text = ANY (ARRAY[('CUSTOMER'::character varying)::text, ('EMPLOYEE'::character varying)::text]))),
    CONSTRAINT lane_sessions_selection_confirmed_by_check CHECK (((selection_confirmed_by)::text = ANY (ARRAY[('CUSTOMER'::character varying)::text, ('EMPLOYEE'::character varying)::text])))
);

CREATE TABLE public.waitlist (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    visit_id uuid NOT NULL,
    checkin_block_id uuid NOT NULL,
    desired_tier public.rental_type NOT NULL,
    backup_tier public.rental_type NOT NULL,
    locker_or_room_assigned_initially uuid,
    room_id uuid,
    status public.waitlist_status DEFAULT 'ACTIVE'::public.waitlist_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    offered_at timestamp with time zone,
    offer_expires_at timestamp with time zone,
    last_offered_at timestamp with time zone,
    offer_attempts integer DEFAULT 0 NOT NULL,
    completed_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    cancelled_by_staff_id uuid
);

-- domain: finance
CREATE TABLE public.charges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    visit_id uuid NOT NULL,
    checkin_block_id uuid,
    type character varying(50) NOT NULL,
    amount numeric(10,2) NOT NULL,
    payment_intent_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.payment_intents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lane_session_id uuid,
    amount numeric(10,2) NOT NULL,
    status public.payment_status DEFAULT 'DUE'::public.payment_status NOT NULL,
    quote_json jsonb NOT NULL,
    square_transaction_id character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    paid_at timestamp with time zone
);

-- domain: ops
CREATE TABLE public.checkout_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    occupancy_id uuid NOT NULL,
    key_tag_id uuid,
    kiosk_device_id character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    claimed_by_staff_id uuid,
    claimed_at timestamp with time zone,
    claim_expires_at timestamp with time zone,
    customer_checklist_json jsonb NOT NULL,
    late_minutes integer DEFAULT 0 NOT NULL,
    late_fee_amount numeric(10,2) DEFAULT 0 NOT NULL,
    ban_applied boolean DEFAULT false NOT NULL,
    items_confirmed boolean DEFAULT false NOT NULL,
    fee_paid boolean DEFAULT false NOT NULL,
    completed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    customer_id uuid NOT NULL,
    status public.checkout_request_status DEFAULT 'SUBMITTED'::public.checkout_request_status
);

CREATE TABLE public.cleaning_batch_rooms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    batch_id uuid NOT NULL,
    room_id uuid NOT NULL,
    status_from public.room_status NOT NULL,
    status_to public.room_status NOT NULL,
    transition_time timestamp with time zone DEFAULT now() NOT NULL,
    override_flag boolean DEFAULT false NOT NULL,
    override_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.cleaning_batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    staff_id character varying(255) NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    room_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.cleaning_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid NOT NULL,
    staff_id uuid NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    from_status public.room_status NOT NULL,
    to_status public.room_status NOT NULL,
    override_flag boolean DEFAULT false NOT NULL,
    override_reason text,
    device_id character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.devices (
    device_id character varying(255) NOT NULL,
    display_name character varying(255) NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.late_checkout_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    occupancy_id uuid NOT NULL,
    checkout_request_id uuid,
    late_minutes integer NOT NULL,
    fee_amount numeric(10,2) NOT NULL,
    ban_applied boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    customer_id uuid NOT NULL
);

CREATE TABLE public.register_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    device_id character varying(255) NOT NULL,
    register_number integer NOT NULL,
    last_heartbeat timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    signed_out_at timestamp with time zone,
    CONSTRAINT register_sessions_register_number_check CHECK ((register_number = ANY (ARRAY[1, 2])))
);

-- domain: audit
CREATE TABLE public.audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id character varying(255),
    user_role character varying(50),
    action public.audit_action NOT NULL,
    entity_type character varying(50) NOT NULL,
    entity_id uuid NOT NULL,
    old_value jsonb,
    new_value jsonb,
    override_reason text,
    ip_address inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    staff_id uuid,
    metadata jsonb
);

-- domain: telemetry
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

-- domain: meta
CREATE TABLE public.schema_migrations (
    id SERIAL,
    name character varying(255) NOT NULL,
    executed_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Constraints
-- domain: core
ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.visits
    ADD CONSTRAINT visits_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.visits
    ADD CONSTRAINT visits_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;

-- domain: hr
ALTER TABLE ONLY public.employee_documents
    ADD CONSTRAINT employee_documents_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.staff(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.employee_documents
    ADD CONSTRAINT employee_documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.staff(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.employee_shifts
    ADD CONSTRAINT employee_shifts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.employee_shifts
    ADD CONSTRAINT employee_shifts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.staff(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.employee_shifts
    ADD CONSTRAINT employee_shifts_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.staff(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.employee_shifts
    ADD CONSTRAINT employee_shifts_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.staff(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_qr_token_hash_key UNIQUE (qr_token_hash);
ALTER TABLE ONLY public.staff_sessions
    ADD CONSTRAINT staff_sessions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.staff_sessions
    ADD CONSTRAINT staff_sessions_session_token_key UNIQUE (session_token);
ALTER TABLE ONLY public.staff_sessions
    ADD CONSTRAINT staff_sessions_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.staff_webauthn_credentials
    ADD CONSTRAINT staff_webauthn_credentials_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.staff_webauthn_credentials
    ADD CONSTRAINT staff_webauthn_credentials_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.time_off_requests
    ADD CONSTRAINT time_off_requests_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.staff(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.time_off_requests
    ADD CONSTRAINT time_off_requests_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.staff(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.timeclock_sessions
    ADD CONSTRAINT timeclock_sessions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.staff(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.timeclock_sessions
    ADD CONSTRAINT timeclock_sessions_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.staff(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.timeclock_sessions
    ADD CONSTRAINT timeclock_sessions_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.employee_shifts(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.webauthn_challenges
    ADD CONSTRAINT webauthn_challenges_challenge_key UNIQUE (challenge);
ALTER TABLE ONLY public.webauthn_challenges
    ADD CONSTRAINT webauthn_challenges_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.webauthn_challenges
    ADD CONSTRAINT webauthn_challenges_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE CASCADE;

-- domain: inventory
ALTER TABLE ONLY public.key_tags
    ADD CONSTRAINT key_tags_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.key_tags
    ADD CONSTRAINT key_tags_tag_code_key UNIQUE (tag_code);
ALTER TABLE ONLY public.key_tags
    ADD CONSTRAINT key_tags_locker_id_fkey FOREIGN KEY (locker_id) REFERENCES public.lockers(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.key_tags
    ADD CONSTRAINT key_tags_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.lockers
    ADD CONSTRAINT lockers_number_key UNIQUE (number);
ALTER TABLE ONLY public.lockers
    ADD CONSTRAINT lockers_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.lockers
    ADD CONSTRAINT lockers_assigned_to_customer_id_fkey FOREIGN KEY (assigned_to_customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_number_key UNIQUE (number);
ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_assigned_to_customer_id_fkey FOREIGN KEY (assigned_to_customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;

-- domain: sessions
ALTER TABLE ONLY public.agreement_signatures
    ADD CONSTRAINT agreement_signatures_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.agreement_signatures
    ADD CONSTRAINT agreement_signatures_agreement_id_fkey FOREIGN KEY (agreement_id) REFERENCES public.agreements(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.agreement_signatures
    ADD CONSTRAINT agreement_signatures_checkin_block_id_fkey FOREIGN KEY (checkin_block_id) REFERENCES public.checkin_blocks(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.agreements
    ADD CONSTRAINT agreements_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.checkin_blocks
    ADD CONSTRAINT checkin_blocks_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.checkin_blocks
    ADD CONSTRAINT checkin_blocks_locker_id_fkey FOREIGN KEY (locker_id) REFERENCES public.lockers(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.checkin_blocks
    ADD CONSTRAINT checkin_blocks_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.checkin_blocks
    ADD CONSTRAINT checkin_blocks_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.lane_sessions(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.checkin_blocks
    ADD CONSTRAINT checkin_blocks_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES public.visits(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.checkin_blocks
    ADD CONSTRAINT checkin_blocks_waitlist_id_fkey FOREIGN KEY (waitlist_id) REFERENCES public.waitlist(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.inventory_reservations
    ADD CONSTRAINT inventory_reservations_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.inventory_reservations
    ADD CONSTRAINT inventory_reservations_lane_session_fk FOREIGN KEY (lane_session_id) REFERENCES public.lane_sessions(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.inventory_reservations
    ADD CONSTRAINT inventory_reservations_waitlist_fk FOREIGN KEY (waitlist_id) REFERENCES public.waitlist(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.lane_sessions
    ADD CONSTRAINT lane_sessions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.lane_sessions
    ADD CONSTRAINT fk_lane_sessions_payment_intent FOREIGN KEY (payment_intent_id) REFERENCES public.payment_intents(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.lane_sessions
    ADD CONSTRAINT lane_sessions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.lane_sessions
    ADD CONSTRAINT lane_sessions_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.waitlist
    ADD CONSTRAINT waitlist_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.waitlist
    ADD CONSTRAINT waitlist_cancelled_by_staff_id_fkey FOREIGN KEY (cancelled_by_staff_id) REFERENCES public.staff(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.waitlist
    ADD CONSTRAINT waitlist_checkin_block_id_fkey FOREIGN KEY (checkin_block_id) REFERENCES public.checkin_blocks(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.waitlist
    ADD CONSTRAINT waitlist_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.waitlist
    ADD CONSTRAINT waitlist_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES public.visits(id) ON DELETE CASCADE;

-- domain: finance
ALTER TABLE ONLY public.charges
    ADD CONSTRAINT charges_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.charges
    ADD CONSTRAINT charges_checkin_block_id_fkey FOREIGN KEY (checkin_block_id) REFERENCES public.checkin_blocks(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.charges
    ADD CONSTRAINT charges_payment_intent_id_fkey FOREIGN KEY (payment_intent_id) REFERENCES public.payment_intents(id);
ALTER TABLE ONLY public.charges
    ADD CONSTRAINT charges_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES public.visits(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.payment_intents
    ADD CONSTRAINT payment_intents_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.payment_intents
    ADD CONSTRAINT payment_intents_lane_session_id_fkey FOREIGN KEY (lane_session_id) REFERENCES public.lane_sessions(id) ON DELETE CASCADE;

-- domain: ops
ALTER TABLE ONLY public.checkout_requests
    ADD CONSTRAINT checkout_requests_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.checkout_requests
    ADD CONSTRAINT checkout_requests_claimed_by_staff_id_fkey FOREIGN KEY (claimed_by_staff_id) REFERENCES public.staff(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.checkout_requests
    ADD CONSTRAINT checkout_requests_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.checkout_requests
    ADD CONSTRAINT checkout_requests_key_tag_id_fkey FOREIGN KEY (key_tag_id) REFERENCES public.key_tags(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.cleaning_batch_rooms
    ADD CONSTRAINT cleaning_batch_rooms_batch_id_room_id_key UNIQUE (batch_id, room_id);
ALTER TABLE ONLY public.cleaning_batch_rooms
    ADD CONSTRAINT cleaning_batch_rooms_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.cleaning_batch_rooms
    ADD CONSTRAINT cleaning_batch_rooms_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.cleaning_batches(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.cleaning_batch_rooms
    ADD CONSTRAINT cleaning_batch_rooms_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.cleaning_batches
    ADD CONSTRAINT cleaning_batches_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.cleaning_events
    ADD CONSTRAINT cleaning_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.cleaning_events
    ADD CONSTRAINT cleaning_events_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.cleaning_events
    ADD CONSTRAINT cleaning_events_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_pkey PRIMARY KEY (device_id);
ALTER TABLE ONLY public.late_checkout_events
    ADD CONSTRAINT late_checkout_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.late_checkout_events
    ADD CONSTRAINT late_checkout_events_checkout_request_id_fkey FOREIGN KEY (checkout_request_id) REFERENCES public.checkout_requests(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.late_checkout_events
    ADD CONSTRAINT late_checkout_events_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.register_sessions
    ADD CONSTRAINT register_sessions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.register_sessions
    ADD CONSTRAINT register_sessions_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.staff(id) ON DELETE CASCADE;

-- domain: audit
ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE SET NULL;

-- domain: telemetry
ALTER TABLE ONLY public.telemetry_events
    ADD CONSTRAINT telemetry_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.telemetry_spans
    ADD CONSTRAINT telemetry_spans_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.telemetry_spans
    ADD CONSTRAINT telemetry_spans_trace_id_fkey FOREIGN KEY (trace_id) REFERENCES public.telemetry_traces(trace_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.telemetry_traces
    ADD CONSTRAINT telemetry_traces_pkey PRIMARY KEY (trace_id);

-- domain: meta
ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_name_key UNIQUE (name);
ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (id);

-- Indexes
-- domain: core
CREATE INDEX idx_customers_banned ON public.customers USING btree (banned_until) WHERE (banned_until IS NOT NULL);
CREATE INDEX idx_customers_dob ON public.customers USING btree (dob) WHERE (dob IS NOT NULL);
CREATE INDEX idx_customers_id_hash ON public.customers USING btree (id_scan_hash) WHERE (id_scan_hash IS NOT NULL);
CREATE INDEX idx_customers_membership ON public.customers USING btree (membership_number) WHERE (membership_number IS NOT NULL);
CREATE INDEX idx_visits_started ON public.visits USING btree (started_at);

-- domain: hr
CREATE INDEX idx_employee_documents_employee ON public.employee_documents USING btree (employee_id);
CREATE INDEX idx_employee_documents_type ON public.employee_documents USING btree (doc_type);
CREATE INDEX idx_employee_documents_uploaded_by ON public.employee_documents USING btree (uploaded_by);
CREATE INDEX idx_employee_shifts_dates ON public.employee_shifts USING btree (starts_at, ends_at);
CREATE INDEX idx_employee_shifts_employee ON public.employee_shifts USING btree (employee_id);
CREATE INDEX idx_employee_shifts_shift_code ON public.employee_shifts USING btree (shift_code);
CREATE INDEX idx_employee_shifts_status ON public.employee_shifts USING btree (status);
CREATE INDEX idx_staff_active ON public.staff USING btree (active) WHERE (active = true);
CREATE INDEX idx_staff_qr_token_hash ON public.staff USING btree (qr_token_hash) WHERE (qr_token_hash IS NOT NULL);
CREATE INDEX idx_staff_role ON public.staff USING btree (role);
CREATE INDEX idx_staff_sessions_active ON public.staff_sessions USING btree (staff_id, revoked_at) WHERE (revoked_at IS NULL);
CREATE INDEX idx_staff_sessions_device ON public.staff_sessions USING btree (device_id, device_type);
CREATE INDEX idx_staff_sessions_reauth_ok ON public.staff_sessions USING btree (session_token, reauth_ok_until) WHERE ((revoked_at IS NULL) AND (reauth_ok_until IS NOT NULL));
CREATE INDEX idx_staff_sessions_staff_id ON public.staff_sessions USING btree (staff_id);
CREATE INDEX idx_staff_sessions_token ON public.staff_sessions USING btree (session_token) WHERE (revoked_at IS NULL);
CREATE INDEX idx_webauthn_credentials_active ON public.staff_webauthn_credentials USING btree (staff_id, revoked_at) WHERE (revoked_at IS NULL);
CREATE INDEX idx_webauthn_credentials_credential_id ON public.staff_webauthn_credentials USING btree (credential_id) WHERE (revoked_at IS NULL);
CREATE INDEX idx_webauthn_credentials_device_id ON public.staff_webauthn_credentials USING btree (device_id) WHERE (revoked_at IS NULL);
CREATE INDEX idx_webauthn_credentials_staff_id ON public.staff_webauthn_credentials USING btree (staff_id) WHERE (revoked_at IS NULL);
CREATE INDEX idx_time_off_requests_day ON public.time_off_requests USING btree (day);
CREATE UNIQUE INDEX idx_time_off_requests_employee_day ON public.time_off_requests USING btree (employee_id, day);
CREATE INDEX idx_time_off_requests_status ON public.time_off_requests USING btree (status);
CREATE INDEX idx_timeclock_sessions_dates ON public.timeclock_sessions USING btree (clock_in_at, clock_out_at);
CREATE INDEX idx_timeclock_sessions_employee ON public.timeclock_sessions USING btree (employee_id);
CREATE UNIQUE INDEX idx_timeclock_sessions_employee_open ON public.timeclock_sessions USING btree (employee_id) WHERE (clock_out_at IS NULL);
CREATE INDEX idx_timeclock_sessions_open ON public.timeclock_sessions USING btree (clock_out_at) WHERE (clock_out_at IS NULL);
CREATE INDEX idx_timeclock_sessions_shift ON public.timeclock_sessions USING btree (shift_id) WHERE (shift_id IS NOT NULL);
CREATE INDEX idx_webauthn_challenges_challenge ON public.webauthn_challenges USING btree (challenge);
CREATE INDEX idx_webauthn_challenges_expires ON public.webauthn_challenges USING btree (expires_at);
CREATE INDEX idx_webauthn_challenges_staff_device ON public.webauthn_challenges USING btree (staff_id, device_id) WHERE (expires_at IS NOT NULL);

-- domain: inventory
CREATE INDEX idx_key_tags_active ON public.key_tags USING btree (is_active) WHERE (is_active = true);
CREATE INDEX idx_key_tags_code ON public.key_tags USING btree (tag_code);
CREATE INDEX idx_key_tags_room ON public.key_tags USING btree (room_id);
CREATE INDEX idx_lockers_assigned_customer ON public.lockers USING btree (assigned_to_customer_id) WHERE (assigned_to_customer_id IS NOT NULL);
CREATE INDEX idx_lockers_status ON public.lockers USING btree (status);
CREATE INDEX idx_rooms_assigned_customer ON public.rooms USING btree (assigned_to_customer_id) WHERE (assigned_to_customer_id IS NOT NULL);
CREATE INDEX idx_rooms_floor ON public.rooms USING btree (floor);
CREATE INDEX idx_rooms_status ON public.rooms USING btree (status);
CREATE INDEX idx_rooms_type ON public.rooms USING btree (type);

-- domain: sessions
CREATE INDEX idx_agreement_signatures_agreement ON public.agreement_signatures USING btree (agreement_id);
CREATE INDEX idx_agreement_signatures_checkin_block ON public.agreement_signatures USING btree (checkin_block_id) WHERE (checkin_block_id IS NOT NULL);
CREATE INDEX idx_agreement_signatures_signed_at ON public.agreement_signatures USING btree (signed_at);
CREATE INDEX idx_agreements_active ON public.agreements USING btree (active) WHERE (active = true);
CREATE INDEX idx_checkin_blocks_ends_at ON public.checkin_blocks USING btree (ends_at) WHERE (ends_at IS NOT NULL);
CREATE INDEX idx_checkin_blocks_session ON public.checkin_blocks USING btree (session_id) WHERE (session_id IS NOT NULL);
CREATE INDEX idx_checkin_blocks_tv_remote ON public.checkin_blocks USING btree (has_tv_remote) WHERE (has_tv_remote = true);
CREATE INDEX idx_checkin_blocks_type ON public.checkin_blocks USING btree (block_type);
CREATE INDEX idx_checkin_blocks_visit ON public.checkin_blocks USING btree (visit_id);
CREATE INDEX idx_checkin_blocks_waitlist ON public.checkin_blocks USING btree (waitlist_id) WHERE (waitlist_id IS NOT NULL);
CREATE INDEX idx_inventory_reservations_active_expires_at ON public.inventory_reservations USING btree (expires_at) WHERE (released_at IS NULL);
CREATE INDEX idx_inventory_reservations_waitlist_active ON public.inventory_reservations USING btree (waitlist_id) WHERE (released_at IS NULL);
CREATE UNIQUE INDEX uniq_inventory_reservations_active_resource ON public.inventory_reservations USING btree (resource_type, resource_id) WHERE (released_at IS NULL);
CREATE INDEX idx_lane_sessions_checkin_mode ON public.lane_sessions USING btree (checkin_mode);
CREATE INDEX idx_lane_sessions_lane ON public.lane_sessions USING btree (lane_id);
CREATE INDEX idx_lane_sessions_lane_active ON public.lane_sessions USING btree (lane_id, status) WHERE (status = ANY (ARRAY['ACTIVE'::public.lane_session_status, 'AWAITING_CUSTOMER'::public.lane_session_status, 'AWAITING_ASSIGNMENT'::public.lane_session_status, 'AWAITING_PAYMENT'::public.lane_session_status, 'AWAITING_SIGNATURE'::public.lane_session_status]));
CREATE INDEX idx_lane_sessions_selection_state ON public.lane_sessions USING btree (proposed_rental_type, selection_confirmed) WHERE (proposed_rental_type IS NOT NULL);
CREATE INDEX idx_lane_sessions_staff ON public.lane_sessions USING btree (staff_id) WHERE (staff_id IS NOT NULL);
CREATE INDEX idx_lane_sessions_status ON public.lane_sessions USING btree (status);
CREATE INDEX idx_waitlist_active ON public.waitlist USING btree (status, created_at) WHERE (status = 'ACTIVE'::public.waitlist_status);
CREATE INDEX idx_waitlist_block ON public.waitlist USING btree (checkin_block_id);
CREATE INDEX idx_waitlist_created_at ON public.waitlist USING btree (created_at);
CREATE INDEX idx_waitlist_desired_tier ON public.waitlist USING btree (desired_tier);
CREATE INDEX idx_waitlist_offered ON public.waitlist USING btree (status, created_at) WHERE (status = 'OFFERED'::public.waitlist_status);
CREATE INDEX idx_waitlist_status ON public.waitlist USING btree (status);
CREATE INDEX idx_waitlist_visit ON public.waitlist USING btree (visit_id);

-- domain: finance
CREATE INDEX idx_charges_block ON public.charges USING btree (checkin_block_id) WHERE (checkin_block_id IS NOT NULL);
CREATE UNIQUE INDEX idx_charges_payment_intent ON public.charges USING btree (payment_intent_id) WHERE (payment_intent_id IS NOT NULL);
CREATE INDEX idx_charges_visit ON public.charges USING btree (visit_id);
CREATE INDEX idx_payment_intents_due ON public.payment_intents USING btree (status) WHERE (status = 'DUE'::public.payment_status);
CREATE INDEX idx_payment_intents_lane_session ON public.payment_intents USING btree (lane_session_id);
CREATE INDEX idx_payment_intents_status ON public.payment_intents USING btree (status);

-- domain: ops
CREATE INDEX idx_checkout_requests_claim_expires ON public.checkout_requests USING btree (claim_expires_at) WHERE (claim_expires_at IS NOT NULL);
CREATE INDEX idx_checkout_requests_claimed ON public.checkout_requests USING btree (claimed_by_staff_id) WHERE (claimed_by_staff_id IS NOT NULL);
CREATE INDEX idx_checkout_requests_kiosk ON public.checkout_requests USING btree (kiosk_device_id);
CREATE INDEX idx_checkout_requests_occupancy ON public.checkout_requests USING btree (occupancy_id);
CREATE INDEX idx_cleaning_batch_rooms_batch ON public.cleaning_batch_rooms USING btree (batch_id);
CREATE INDEX idx_cleaning_batch_rooms_room ON public.cleaning_batch_rooms USING btree (room_id);
CREATE INDEX idx_cleaning_batch_rooms_transition ON public.cleaning_batch_rooms USING btree (transition_time);
CREATE INDEX idx_cleaning_batches_incomplete ON public.cleaning_batches USING btree (completed_at) WHERE (completed_at IS NULL);
CREATE INDEX idx_cleaning_batches_staff ON public.cleaning_batches USING btree (staff_id);
CREATE INDEX idx_cleaning_batches_started ON public.cleaning_batches USING btree (started_at);
CREATE INDEX idx_cleaning_events_completed ON public.cleaning_events USING btree (completed_at);
CREATE INDEX idx_cleaning_events_device ON public.cleaning_events USING btree (device_id) WHERE (device_id IS NOT NULL);
CREATE INDEX idx_cleaning_events_override ON public.cleaning_events USING btree (override_flag) WHERE (override_flag = true);
CREATE INDEX idx_cleaning_events_room ON public.cleaning_events USING btree (room_id);
CREATE INDEX idx_cleaning_events_staff ON public.cleaning_events USING btree (staff_id);
CREATE INDEX idx_cleaning_events_started ON public.cleaning_events USING btree (started_at);
CREATE INDEX idx_devices_enabled ON public.devices USING btree (enabled) WHERE (enabled = true);
CREATE INDEX idx_late_checkout_events_created ON public.late_checkout_events USING btree (created_at);
CREATE INDEX idx_late_checkout_events_occupancy ON public.late_checkout_events USING btree (occupancy_id);
CREATE INDEX idx_late_checkout_events_request ON public.late_checkout_events USING btree (checkout_request_id) WHERE (checkout_request_id IS NOT NULL);
CREATE INDEX idx_register_sessions_device ON public.register_sessions USING btree (device_id);
CREATE UNIQUE INDEX idx_register_sessions_device_active ON public.register_sessions USING btree (device_id) WHERE (signed_out_at IS NULL);
CREATE INDEX idx_register_sessions_employee ON public.register_sessions USING btree (employee_id);
CREATE INDEX idx_register_sessions_heartbeat ON public.register_sessions USING btree (last_heartbeat) WHERE (signed_out_at IS NULL);
CREATE UNIQUE INDEX idx_register_sessions_register_active ON public.register_sessions USING btree (register_number) WHERE (signed_out_at IS NULL);

-- domain: audit
CREATE INDEX idx_audit_log_action ON public.audit_log USING btree (action);
CREATE INDEX idx_audit_log_created ON public.audit_log USING btree (created_at);
CREATE INDEX idx_audit_log_entity ON public.audit_log USING btree (entity_type, entity_id);
CREATE INDEX idx_audit_log_overrides ON public.audit_log USING btree (created_at) WHERE (action = 'OVERRIDE'::public.audit_action);
CREATE INDEX idx_audit_log_staff_id ON public.audit_log USING btree (staff_id);
CREATE INDEX idx_audit_log_user ON public.audit_log USING btree (user_id);

-- domain: telemetry
CREATE INDEX telemetry_events_app_idx ON public.telemetry_events USING btree (app);
CREATE INDEX telemetry_events_created_at_idx ON public.telemetry_events USING btree (created_at);
CREATE INDEX telemetry_events_device_id_idx ON public.telemetry_events USING btree (device_id);
CREATE INDEX telemetry_events_kind_idx ON public.telemetry_events USING btree (kind);
CREATE INDEX telemetry_events_level_idx ON public.telemetry_events USING btree (level);
CREATE INDEX telemetry_events_request_id_idx ON public.telemetry_events USING btree (request_id);
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
