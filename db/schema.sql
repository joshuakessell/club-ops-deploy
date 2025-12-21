-- Club Operations POS Database Schema
-- This file represents the current state of the database schema.
-- It is generated from migrations and should match the actual database state.
-- To regenerate, run migrations or use pg_dump --schema-only.

-- ============================================================================
-- ENUMS
-- ============================================================================

-- Room status enum (from migration 002)
CREATE TYPE room_status AS ENUM ('DIRTY', 'CLEANING', 'CLEAN', 'OCCUPIED');

-- Room type enum (from migration 002, updated in 030)
-- Note: DELUXE and VIP values remain in enum but should not be used (migrated to DOUBLE/SPECIAL)
-- Migration 034 adds CHECK constraint to prevent new DELUXE/VIP assignments
CREATE TYPE room_type AS ENUM ('STANDARD', 'DELUXE', 'VIP', 'LOCKER', 'DOUBLE', 'SPECIAL');

-- Staff role enum (from migration 010)
CREATE TYPE staff_role AS ENUM ('STAFF', 'ADMIN');

-- Lane session status enum (from migration 023)
CREATE TYPE lane_session_status AS ENUM (
  'IDLE',
  'ACTIVE',
  'AWAITING_CUSTOMER',
  'AWAITING_ASSIGNMENT',
  'AWAITING_PAYMENT',
  'AWAITING_SIGNATURE',
  'COMPLETED',
  'CANCELLED'
);

-- Rental type enum (from migration 023)
CREATE TYPE rental_type AS ENUM (
  'LOCKER',
  'STANDARD',
  'DOUBLE',
  'SPECIAL',
  'GYM_LOCKER'
);

-- Payment status enum (from migration 025)
CREATE TYPE payment_status AS ENUM (
  'DUE',
  'PAID',
  'CANCELLED',
  'REFUNDED'
);

-- Block type enum (from migration 016)
CREATE TYPE block_type AS ENUM ('INITIAL', 'RENEWAL', 'FINAL2H');

-- Waitlist status enum (from migration 028)
CREATE TYPE waitlist_status AS ENUM ('ACTIVE', 'OFFERED', 'COMPLETED', 'CANCELLED', 'EXPIRED');

-- Checkout request status enum (from migration 019)
CREATE TYPE checkout_request_status AS ENUM ('SUBMITTED', 'CLAIMED', 'VERIFIED', 'CANCELLED');

-- Audit action enum (from migration 008, expanded in later migrations)
CREATE TYPE audit_action AS ENUM (
  'ROOM_STATUS_CHANGE',
  'ROOM_ASSIGNED',
  'ROOM_RELEASED',
  'SESSION_CREATED',
  'SESSION_COMPLETED',
  'SESSION_CANCELLED',
  'STAFF_LOGIN_PIN',
  'STAFF_LOGIN_WEBAUTHN',
  'STAFF_LOGOUT',
  'STAFF_REAUTH_PIN',
  'STAFF_REAUTH_WEBAUTHN',
  'STAFF_WEBAUTHN_ENROLLED',
  'STAFF_WEBAUTHN_REVOKED',
  'STAFF_PIN_RESET',
  'STAFF_CREATED',
  'STAFF_UPDATED',
  'STAFF_ACTIVATED',
  'STAFF_DEACTIVATED',
  'STAFF_REAUTH_REQUIRED',
  'CLEANING_BATCH_STARTED',
  'CLEANING_BATCH_COMPLETED',
  'OVERRIDE',
  'UPGRADE_DISCLAIMER',
  'WAITLIST_CREATED',
  'WAITLIST_OFFERED',
  'WAITLIST_COMPLETED',
  'WAITLIST_CANCELLED',
  'UPGRADE_STARTED',
  'UPGRADE_PAID',
  'UPGRADE_COMPLETED',
  'FINAL_EXTENSION_STARTED',
  'FINAL_EXTENSION_PAID',
  'FINAL_EXTENSION_COMPLETED'
);

-- ============================================================================
-- TABLES
-- ============================================================================

-- Members table (from migration 001, updated in 024)
-- LEGACY: This table is deprecated. All operational workflows should use customers(id) instead of members(id).
-- Foreign key dependencies have been migrated to customers. This table is kept temporarily for data validation
-- and will be removed in a future migration.
CREATE TABLE IF NOT EXISTS members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_number VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(50),
  dob DATE, -- Added in migration 024
  membership_card_type VARCHAR(50), -- Added in migration 024
  membership_valid_until DATE, -- Added in migration 024
  banned_until TIMESTAMPTZ, -- Added in migration 018
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Rooms table (from migration 002, updated in 026)
CREATE TABLE IF NOT EXISTS rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number VARCHAR(20) UNIQUE NOT NULL,
  type room_type NOT NULL DEFAULT 'STANDARD',
  status room_status NOT NULL DEFAULT 'CLEAN',
  floor INTEGER NOT NULL DEFAULT 1,
  last_status_change TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_to_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  override_flag BOOLEAN NOT NULL DEFAULT false,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lockers table (from migration 003)
CREATE TABLE IF NOT EXISTS lockers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number VARCHAR(20) UNIQUE NOT NULL,
  status room_status NOT NULL DEFAULT 'CLEAN',
  assigned_to_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sessions table (from migration 004, updated in 009, 014)
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
  locker_id UUID REFERENCES lockers(id) ON DELETE SET NULL,
  checkin_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checkout_at TIMESTAMPTZ,
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
  lane VARCHAR(50), -- Added in migration 009
  visit_id UUID REFERENCES visits(id) ON DELETE SET NULL, -- Added in migration 016
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Key tags table (from migration 005)
CREATE TABLE IF NOT EXISTS key_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
  locker_id UUID REFERENCES lockers(id) ON DELETE CASCADE,
  tag_code VARCHAR(255) UNIQUE NOT NULL,
  tag_type VARCHAR(50) NOT NULL DEFAULT 'QR',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Staff table (from migration 010)
CREATE TABLE IF NOT EXISTS staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  role staff_role NOT NULL DEFAULT 'STAFF',
  qr_token_hash VARCHAR(255) UNIQUE,
  pin_hash VARCHAR(255),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Staff sessions table (from migration 010, updated in 031)
CREATE TABLE IF NOT EXISTS staff_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  device_id VARCHAR(255) NOT NULL,
  device_type VARCHAR(50) NOT NULL,
  session_token VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  reauth_ok_until TIMESTAMPTZ -- Added in migration 031
);

-- Staff WebAuthn credentials table (from migration 022)
CREATE TABLE IF NOT EXISTS staff_webauthn_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  credential_id VARCHAR(255) UNIQUE NOT NULL,
  public_key BYTEA NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  device_type VARCHAR(50),
  device_name VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

-- Cleaning batches table (from migration 006)
CREATE TABLE IF NOT EXISTS cleaning_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  room_count INTEGER NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Cleaning batch rooms table (from migration 007)
CREATE TABLE IF NOT EXISTS cleaning_batch_rooms (
  batch_id UUID NOT NULL REFERENCES cleaning_batches(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  PRIMARY KEY (batch_id, room_id)
);

-- Cleaning events table (from migration 012)
CREATE TABLE IF NOT EXISTS cleaning_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  from_status room_status NOT NULL,
  to_status room_status NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  override_flag BOOLEAN NOT NULL DEFAULT false,
  override_reason TEXT,
  device_id VARCHAR(255),
  device_type VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit log table (from migration 008, updated in 011, 015, 029)
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID REFERENCES staff(id) ON DELETE SET NULL, -- Added in migration 011
  action audit_action NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID NOT NULL,
  old_value JSONB,
  new_value JSONB,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Agreements table (from migration 013)
CREATE TABLE IF NOT EXISTS agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body_text TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Agreement signatures table (from migration 013, updated in 017)
CREATE TABLE IF NOT EXISTS agreement_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id UUID NOT NULL REFERENCES agreements(id) ON DELETE RESTRICT,
  checkin_id UUID NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
  checkin_block_id UUID REFERENCES checkin_blocks(id) ON DELETE SET NULL, -- Added in migration 017
  customer_name VARCHAR(255) NOT NULL,
  membership_number VARCHAR(50),
  signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  signature_png_base64 TEXT,
  signature_strokes_json JSONB,
  agreement_text_snapshot TEXT NOT NULL,
  agreement_version VARCHAR(50) NOT NULL,
  device_id VARCHAR(255),
  device_type VARCHAR(50),
  user_agent TEXT,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Customers table (from migration 024)
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  dob DATE,
  membership_number VARCHAR(50),
  membership_card_type VARCHAR(50),
  membership_valid_until DATE,
  banned_until TIMESTAMPTZ,
  id_scan_hash VARCHAR(255), -- Hash of ID scan for lookup
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Visits table (from migration 016)
CREATE TABLE IF NOT EXISTS visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Checkin blocks table (from migration 016, updated in 017, 021)
CREATE TABLE IF NOT EXISTS checkin_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  block_type block_type NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  rental_type rental_type NOT NULL, -- Constrained to rental_type enum (migration 034)
  room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
  locker_id UUID REFERENCES lockers(id) ON DELETE SET NULL,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  waitlist_id UUID REFERENCES waitlist(id) ON DELETE SET NULL, -- Added in migration 028
  agreement_signed BOOLEAN NOT NULL DEFAULT false,
  has_tv_remote BOOLEAN NOT NULL DEFAULT false, -- Added in migration 021
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Charges table (from migration 016)
CREATE TABLE IF NOT EXISTS charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  checkin_block_id UUID REFERENCES checkin_blocks(id) ON DELETE SET NULL,
  type VARCHAR(50) NOT NULL, -- 'INITIAL', 'RENEWAL', 'FINAL2H', 'UPGRADE', etc.
  amount DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lane sessions table (from migration 023, updated in 027)
CREATE TABLE IF NOT EXISTS lane_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lane_id VARCHAR(50) NOT NULL,
  status lane_session_status NOT NULL DEFAULT 'IDLE',
  staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_display_name VARCHAR(255),
  membership_number VARCHAR(50),
  desired_rental_type rental_type,
  waitlist_desired_type rental_type,
  backup_rental_type rental_type,
  assigned_resource_id UUID, -- room_id or locker_id
  assigned_resource_type VARCHAR(20), -- 'room' or 'locker'
  price_quote_json JSONB,
  disclaimers_ack_json JSONB,
  payment_intent_id UUID REFERENCES payment_intents(id) ON DELETE SET NULL,
  checkin_mode VARCHAR(20) DEFAULT 'CHECKIN', -- Added in migration 027, updated in 035 to match SCHEMA_OVERVIEW
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Payment intents table (from migration 025)
CREATE TABLE IF NOT EXISTS payment_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lane_session_id UUID REFERENCES lane_sessions(id) ON DELETE CASCADE,
  amount DECIMAL(10, 2) NOT NULL,
  status payment_status NOT NULL DEFAULT 'DUE',
  quote_json JSONB NOT NULL,
  square_transaction_id VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ
);

-- Waitlist table (from migration 028)
CREATE TABLE IF NOT EXISTS waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  checkin_block_id UUID NOT NULL REFERENCES checkin_blocks(id) ON DELETE CASCADE,
  desired_tier rental_type NOT NULL, -- STANDARD, DOUBLE, or SPECIAL
  backup_tier rental_type NOT NULL,
  locker_or_room_assigned_initially UUID,
  room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
  status waitlist_status NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  offered_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancelled_by_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL
);

-- Checkout requests table (from migration 019)
CREATE TABLE IF NOT EXISTS checkout_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occupancy_id UUID NOT NULL, -- References checkin_blocks.id
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  key_tag_id UUID REFERENCES key_tags(id) ON DELETE SET NULL,
  kiosk_device_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_by_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  claimed_at TIMESTAMPTZ,
  claim_expires_at TIMESTAMPTZ,
  customer_checklist_json JSONB NOT NULL,
  status checkout_request_status NOT NULL DEFAULT 'SUBMITTED', -- Updated in migration 035
  late_minutes INTEGER NOT NULL DEFAULT 0,
  late_fee_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
  ban_applied BOOLEAN NOT NULL DEFAULT false,
  items_confirmed BOOLEAN NOT NULL DEFAULT false,
  fee_paid BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Late checkout events table (from migration 020)
CREATE TABLE IF NOT EXISTS late_checkout_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_request_id UUID REFERENCES checkout_requests(id) ON DELETE SET NULL,
  occupancy_id UUID NOT NULL,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  late_minutes INTEGER NOT NULL,
  fee_amount DECIMAL(10, 2) NOT NULL,
  ban_applied BOOLEAN NOT NULL DEFAULT false,
  ban_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- WebAuthn challenges table (for WebAuthn flow)
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge VARCHAR(255) UNIQUE NOT NULL,
  staff_id UUID REFERENCES staff(id) ON DELETE CASCADE,
  device_id VARCHAR(255) NOT NULL,
  purpose VARCHAR(50) NOT NULL, -- 'registration' or 'authentication'
  options_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Members indexes
CREATE INDEX IF NOT EXISTS idx_members_membership_number ON members(membership_number);
CREATE INDEX IF NOT EXISTS idx_members_active ON members(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_members_banned_until ON members(banned_until) WHERE banned_until IS NOT NULL;

-- Rooms indexes
CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);
CREATE INDEX IF NOT EXISTS idx_rooms_type ON rooms(type);
CREATE INDEX IF NOT EXISTS idx_rooms_floor ON rooms(floor);
CREATE INDEX IF NOT EXISTS idx_rooms_assigned_customer ON rooms(assigned_to_customer_id) WHERE assigned_to_customer_id IS NOT NULL;

-- Lockers indexes
CREATE INDEX IF NOT EXISTS idx_lockers_status ON lockers(status);
CREATE INDEX IF NOT EXISTS idx_lockers_assigned_customer ON lockers(assigned_to_customer_id) WHERE assigned_to_customer_id IS NOT NULL;

-- Sessions indexes
CREATE INDEX IF NOT EXISTS idx_sessions_lane ON sessions(lane) WHERE lane IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_lane_active ON sessions(lane, status) WHERE lane IS NOT NULL AND status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_sessions_visit ON sessions(visit_id) WHERE visit_id IS NOT NULL;

-- Staff indexes
CREATE INDEX IF NOT EXISTS idx_staff_active ON staff(active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_staff_role ON staff(role);
CREATE INDEX IF NOT EXISTS idx_staff_qr_token_hash ON staff(qr_token_hash) WHERE qr_token_hash IS NOT NULL;

-- Staff sessions indexes
CREATE INDEX IF NOT EXISTS idx_staff_sessions_staff_id ON staff_sessions(staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_sessions_token ON staff_sessions(session_token) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_staff_sessions_device ON staff_sessions(device_id, device_type);
CREATE INDEX IF NOT EXISTS idx_staff_sessions_active ON staff_sessions(staff_id, revoked_at) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_staff_sessions_reauth_ok ON staff_sessions(session_token, reauth_ok_until) WHERE revoked_at IS NULL AND reauth_ok_until IS NOT NULL; -- Added in migration 031

-- Cleaning events indexes
CREATE INDEX IF NOT EXISTS idx_cleaning_events_room ON cleaning_events(room_id);
CREATE INDEX IF NOT EXISTS idx_cleaning_events_staff ON cleaning_events(staff_id);
CREATE INDEX IF NOT EXISTS idx_cleaning_events_device ON cleaning_events(device_id) WHERE device_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cleaning_events_override ON cleaning_events(override_flag) WHERE override_flag = true;

-- Audit log indexes
CREATE INDEX IF NOT EXISTS idx_audit_log_staff_id ON audit_log(staff_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);

-- Agreement indexes
CREATE INDEX IF NOT EXISTS idx_agreements_active ON agreements(active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_agreement_signatures_checkin ON agreement_signatures(checkin_id);
CREATE INDEX IF NOT EXISTS idx_agreement_signatures_agreement ON agreement_signatures(agreement_id);
CREATE INDEX IF NOT EXISTS idx_agreement_signatures_signed_at ON agreement_signatures(signed_at);
CREATE INDEX IF NOT EXISTS idx_agreement_signatures_checkin_block ON agreement_signatures(checkin_block_id) WHERE checkin_block_id IS NOT NULL;

-- Visits indexes
CREATE INDEX IF NOT EXISTS idx_visits_customer ON visits(customer_id);
CREATE INDEX IF NOT EXISTS idx_visits_active ON visits(customer_id, ended_at) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_visits_started ON visits(started_at);

-- Checkin blocks indexes
CREATE INDEX IF NOT EXISTS idx_checkin_blocks_visit ON checkin_blocks(visit_id);
CREATE INDEX IF NOT EXISTS idx_checkin_blocks_type ON checkin_blocks(block_type);
CREATE INDEX IF NOT EXISTS idx_checkin_blocks_session ON checkin_blocks(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_checkin_blocks_ends_at ON checkin_blocks(ends_at) WHERE ends_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_checkin_blocks_waitlist ON checkin_blocks(waitlist_id) WHERE waitlist_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_checkin_blocks_tv_remote ON checkin_blocks(has_tv_remote) WHERE has_tv_remote = true;

-- Charges indexes
CREATE INDEX IF NOT EXISTS idx_charges_visit ON charges(visit_id);
CREATE INDEX IF NOT EXISTS idx_charges_block ON charges(checkin_block_id) WHERE checkin_block_id IS NOT NULL;

-- Lane sessions indexes
CREATE INDEX IF NOT EXISTS idx_lane_sessions_lane ON lane_sessions(lane_id);
CREATE INDEX IF NOT EXISTS idx_lane_sessions_status ON lane_sessions(status);
CREATE INDEX IF NOT EXISTS idx_lane_sessions_lane_active ON lane_sessions(lane_id, status) WHERE status IN ('ACTIVE', 'AWAITING_CUSTOMER', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE');
CREATE INDEX IF NOT EXISTS idx_lane_sessions_customer ON lane_sessions(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lane_sessions_staff ON lane_sessions(staff_id) WHERE staff_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lane_sessions_checkin_mode ON lane_sessions(checkin_mode);

-- Payment intents indexes
CREATE INDEX IF NOT EXISTS idx_payment_intents_lane_session ON payment_intents(lane_session_id);
CREATE INDEX IF NOT EXISTS idx_payment_intents_status ON payment_intents(status);
CREATE INDEX IF NOT EXISTS idx_payment_intents_due ON payment_intents(status) WHERE status = 'DUE';

-- Waitlist indexes
CREATE INDEX IF NOT EXISTS idx_waitlist_status ON waitlist(status);
CREATE INDEX IF NOT EXISTS idx_waitlist_visit ON waitlist(visit_id);
CREATE INDEX IF NOT EXISTS idx_waitlist_block ON waitlist(checkin_block_id);
CREATE INDEX IF NOT EXISTS idx_waitlist_desired_tier ON waitlist(desired_tier);
CREATE INDEX IF NOT EXISTS idx_waitlist_active ON waitlist(status, created_at) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_waitlist_offered ON waitlist(status, created_at) WHERE status = 'OFFERED';
CREATE INDEX IF NOT EXISTS idx_waitlist_created_at ON waitlist(created_at);

-- Checkout requests indexes
CREATE INDEX IF NOT EXISTS idx_checkout_requests_status ON checkout_requests(status);
CREATE INDEX IF NOT EXISTS idx_checkout_requests_customer ON checkout_requests(customer_id);
CREATE INDEX IF NOT EXISTS idx_checkout_requests_occupancy ON checkout_requests(occupancy_id);
CREATE INDEX IF NOT EXISTS idx_checkout_requests_kiosk ON checkout_requests(kiosk_device_id);
CREATE INDEX IF NOT EXISTS idx_checkout_requests_claimed ON checkout_requests(claimed_by_staff_id) WHERE claimed_by_staff_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_checkout_requests_active ON checkout_requests(status) WHERE status IN ('SUBMITTED', 'CLAIMED');
CREATE INDEX IF NOT EXISTS idx_checkout_requests_claim_expires ON checkout_requests(claim_expires_at) WHERE claim_expires_at IS NOT NULL;

-- Late checkout events indexes
CREATE INDEX IF NOT EXISTS idx_late_checkout_events_occupancy ON late_checkout_events(occupancy_id);
CREATE INDEX IF NOT EXISTS idx_late_checkout_events_customer ON late_checkout_events(customer_id);
CREATE INDEX IF NOT EXISTS idx_late_checkout_events_request ON late_checkout_events(checkout_request_id) WHERE checkout_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_late_checkout_events_created ON late_checkout_events(created_at);

