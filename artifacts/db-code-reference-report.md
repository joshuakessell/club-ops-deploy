# Backend DB Reference Report (Extended Scan)

## Scope & Method
- Scanned TS/JS across repo (apps, packages, services, scripts, tools).
- Included SQL from `services/api/migrations/**` (including _archive).
- Excluded: `db/schema.sql`, `node_modules/**`, build output, and artifacts.
- **Definitely used** = names found in SQL passed to `.query(...)`, `.sql(...)`, tagged `sql` templates, or migration SQL files.
- **Possibly used** = names that appear in code text outside those SQL contexts.

## Summary
- Tables in schema: 33
- Enums in schema: 15
- SQL snippets detected (definite): 327

## Write-only Tables (written but never read)
- employee_shifts
- register_sessions
- telemetry_events
- time_off_requests
- timeclock_sessions

## Columns Never Selected/Filtered (write-only in SQL)
- agreement_signatures.agreement_id
- agreement_signatures.agreement_text_snapshot
- agreement_signatures.agreement_version
- agreement_signatures.checkin_block_id
- agreement_signatures.customer_name
- agreement_signatures.ip_address
- agreement_signatures.membership_number
- agreement_signatures.signature_png_base64
- agreement_signatures.signed_at
- agreement_signatures.user_agent
- charges.amount
- charges.checkin_block_id
- charges.payment_intent_id
- charges.type
- checkin_blocks.agreement_signed
- checkin_blocks.agreement_signed_at
- checkin_blocks.block_type
- checkin_blocks.ends_at
- checkin_blocks.has_tv_remote
- checkin_blocks.locker_id
- checkin_blocks.room_id
- checkin_blocks.session_id
- checkin_blocks.starts_at
- checkin_blocks.waitlist_id
- checkout_requests.claimed_by_staff_id
- checkout_requests.completed_at
- checkout_requests.customer_checklist_json
- checkout_requests.fee_paid
- checkout_requests.items_confirmed
- checkout_requests.kiosk_device_id
- checkout_requests.late_fee_amount
- checkout_requests.late_minutes
- checkout_requests.occupancy_id
- checkout_requests.status
- cleaning_batch_rooms.override_flag
- cleaning_batch_rooms.override_reason
- cleaning_batch_rooms.room_id
- cleaning_batch_rooms.status_from
- cleaning_batch_rooms.status_to
- cleaning_batches.completed_at
- cleaning_batches.room_count
- cleaning_batches.updated_at
- customers.notes
- customers.past_due_balance
- customers.primary_language
- devices.display_name
- devices.enabled
- inventory_reservations.expires_at
- inventory_reservations.release_reason
- inventory_reservations.resource_id
- inventory_reservations.resource_type
- key_tags.tag_type
- lane_sessions.assigned_resource_id
- lane_sessions.assigned_resource_type
- lane_sessions.backup_rental_type
- lane_sessions.customer_display_name
- lane_sessions.desired_rental_type
- lane_sessions.disclaimers_ack_json
- lane_sessions.kiosk_acknowledged_at
- lane_sessions.lane_id
- lane_sessions.membership_choice
- lane_sessions.membership_purchase_intent
- lane_sessions.membership_purchase_requested_at
- lane_sessions.payment_intent_id
- lane_sessions.price_quote_json
- lane_sessions.staff_id
- lane_sessions.status
- lane_sessions.waitlist_desired_type
- late_checkout_events.ban_applied
- late_checkout_events.checkout_request_id
- late_checkout_events.fee_amount
- late_checkout_events.late_minutes
- lockers.status
- payment_intents.amount
- payment_intents.paid_at
- payment_intents.quote_json
- payment_intents.square_transaction_id
- payment_intents.status
- payment_intents.updated_at
- register_sessions.signed_out_at
- staff.pin_hash
- staff_sessions.device_id
- staff_sessions.device_type
- staff_sessions.expires_at
- staff_sessions.session_token
- time_off_requests.decided_at
- time_off_requests.decided_by
- time_off_requests.decision_notes
- time_off_requests.status
- time_off_requests.updated_at
- timeclock_sessions.clock_in_at
- timeclock_sessions.notes
- timeclock_sessions.source
- visits.started_at
- waitlist.backup_tier
- waitlist.checkin_block_id
- waitlist.completed_at
- waitlist.desired_tier
- waitlist.last_offered_at
- waitlist.offer_attempts
- waitlist.offer_expires_at
- waitlist.offered_at
- waitlist.room_id
- waitlist.updated_at
- waitlist.visit_id

## Enum Values Never Referenced (no code match)
- None detected

## Domain: customers
### Tables
- Definitely used: agreement_signatures, charges, checkin_blocks, checkout_requests, customers, late_checkout_events, payment_intents, visits, waitlist
- Possibly used: agreements
- Never referenced: None

### Columns by Table
#### agreement_signatures
- Definitely used (SQL): agreement_id, customer_name, membership_number, signed_at, signature_png_base64, agreement_text_snapshot, agreement_version, user_agent, ip_address, checkin_block_id
- Possibly used: id, signature_strokes_json, device_id, device_type, created_at
- Never referenced: None

#### agreements
- Definitely used (SQL): None
- Possibly used: id, version, title, body_text, active, created_at
- Never referenced: None

#### charges
- Definitely used (SQL): visit_id, checkin_block_id, type, amount, payment_intent_id
- Possibly used: id, created_at
- Never referenced: None

#### checkin_blocks
- Definitely used (SQL): id, visit_id, block_type, starts_at, ends_at, room_id, locker_id, session_id, agreement_signed, agreement_signed_at, created_at, updated_at, has_tv_remote, waitlist_id, rental_type
- Possibly used: agreement_pdf
- Never referenced: None

#### checkout_requests
- Definitely used (SQL): id, occupancy_id, kiosk_device_id, created_at, claimed_by_staff_id, customer_checklist_json, late_minutes, late_fee_amount, items_confirmed, fee_paid, completed_at, updated_at, customer_id, status
- Possibly used: key_tag_id, claimed_at, claim_expires_at, ban_applied
- Never referenced: None

#### customers
- Definitely used (SQL): id, name, dob, membership_number, membership_card_type, membership_valid_until, banned_until, id_scan_hash, id_scan_value, primary_language, notes, past_due_balance, created_at, updated_at
- Possibly used: None
- Never referenced: None

#### late_checkout_events
- Definitely used (SQL): id, occupancy_id, checkout_request_id, late_minutes, fee_amount, ban_applied, created_at, customer_id
- Possibly used: None
- Never referenced: None

#### payment_intents
- Definitely used (SQL): id, amount, status, quote_json, square_transaction_id, updated_at, paid_at
- Possibly used: lane_session_id, created_at
- Never referenced: None

#### visits
- Definitely used (SQL): id, started_at, ended_at, created_at, updated_at, customer_id
- Possibly used: None
- Never referenced: None

#### waitlist
- Definitely used (SQL): id, visit_id, checkin_block_id, desired_tier, backup_tier, room_id, status, updated_at, offered_at, offer_expires_at, last_offered_at, offer_attempts, completed_at, cancelled_at, cancelled_by_staff_id
- Possibly used: locker_or_room_assigned_initially, created_at
- Never referenced: None

### Enums
#### block_type (definitely)
- Definitely used (SQL): INITIAL, RENEWAL, FINAL2H
- Possibly used: None
- Never referenced: None

#### checkout_request_status (definitely)
- Definitely used (SQL): SUBMITTED, CLAIMED, VERIFIED, CANCELLED
- Possibly used: None
- Never referenced: None

#### payment_status (definitely)
- Definitely used (SQL): DUE, PAID, CANCELLED, REFUNDED
- Possibly used: None
- Never referenced: None

#### rental_type (definitely)
- Definitely used (SQL): LOCKER, STANDARD, DOUBLE, SPECIAL, GYM_LOCKER
- Possibly used: None
- Never referenced: None

#### waitlist_status (definitely)
- Definitely used (SQL): ACTIVE, OFFERED, COMPLETED, CANCELLED, EXPIRED
- Possibly used: None
- Never referenced: None

## Domain: staff
### Tables
- Definitely used: employee_shifts, staff, staff_sessions, time_off_requests, timeclock_sessions
- Possibly used: employee_documents, staff_webauthn_credentials
- Never referenced: None

### Columns by Table
#### employee_documents
- Definitely used (SQL): None
- Possibly used: id, employee_id, doc_type, filename, mime_type, storage_key, uploaded_by, uploaded_at, notes, sha256_hash
- Never referenced: None

#### employee_shifts
- Definitely used (SQL): id
- Possibly used: employee_id, starts_at, ends_at, shift_code, role, status, notes, created_by, updated_by, created_at, updated_at
- Never referenced: None

#### staff
- Definitely used (SQL): id, name, role, pin_hash, active
- Possibly used: qr_token_hash, created_at, updated_at
- Never referenced: None

#### staff_sessions
- Definitely used (SQL): staff_id, device_id, device_type, session_token, expires_at
- Possibly used: id, created_at, revoked_at, reauth_ok_until
- Never referenced: None

#### staff_webauthn_credentials
- Definitely used (SQL): None
- Possibly used: id, staff_id, device_id, credential_id, public_key, sign_count, transports, created_at, last_used_at, revoked_at
- Never referenced: None

#### time_off_requests
- Definitely used (SQL): id, status, decided_by, decided_at, decision_notes, updated_at
- Possibly used: employee_id, day, reason, created_at
- Never referenced: None

#### timeclock_sessions
- Definitely used (SQL): id, employee_id, shift_id, clock_in_at, clock_out_at, source, notes
- Possibly used: created_by, created_at
- Never referenced: None

### Enums
#### shift_status (definitely)
- Definitely used (SQL): SCHEDULED, UPDATED, CANCELED
- Possibly used: None
- Never referenced: None

#### staff_role (definitely)
- Definitely used (SQL): STAFF, ADMIN
- Possibly used: None
- Never referenced: None

#### time_off_request_status (definitely)
- Definitely used (SQL): PENDING, APPROVED, DENIED
- Possibly used: None
- Never referenced: None

## Domain: sessions
### Tables
- Definitely used: devices, lane_sessions, register_sessions
- Possibly used: webauthn_challenges
- Never referenced: None

### Columns by Table
#### devices
- Definitely used (SQL): device_id, display_name, enabled
- Possibly used: created_at
- Never referenced: None

#### lane_sessions
- Definitely used (SQL): id, lane_id, status, staff_id, customer_display_name, membership_number, desired_rental_type, waitlist_desired_type, backup_rental_type, assigned_resource_id, assigned_resource_type, price_quote_json, disclaimers_ack_json, payment_intent_id, membership_purchase_intent, membership_purchase_requested_at, membership_choice, kiosk_acknowledged_at, created_at, updated_at, checkin_mode, customer_id, proposed_rental_type, proposed_by, selection_confirmed, selection_confirmed_by, selection_locked_at
- Possibly used: renewal_hours
- Never referenced: None

#### register_sessions
- Definitely used (SQL): id, signed_out_at
- Possibly used: employee_id, device_id, register_number, last_heartbeat, created_at
- Never referenced: None

#### webauthn_challenges
- Definitely used (SQL): None
- Possibly used: id, challenge, staff_id, device_id, type, expires_at, created_at
- Never referenced: None

### Enums
#### lane_session_status (definitely)
- Definitely used (SQL): IDLE, ACTIVE, AWAITING_CUSTOMER, AWAITING_ASSIGNMENT, AWAITING_PAYMENT, AWAITING_SIGNATURE, COMPLETED, CANCELLED
- Possibly used: None
- Never referenced: None

## Domain: inventory
### Tables
- Definitely used: cleaning_batch_rooms, cleaning_batches, inventory_reservations, key_tags, lockers, rooms
- Possibly used: cleaning_events
- Never referenced: None

### Columns by Table
#### cleaning_batch_rooms
- Definitely used (SQL): batch_id, room_id, status_from, status_to, override_flag, override_reason
- Possibly used: id, created_at
- Never referenced: transition_time

#### cleaning_batches
- Definitely used (SQL): id, staff_id, completed_at, room_count, updated_at
- Possibly used: started_at, created_at
- Never referenced: None

#### cleaning_events
- Definitely used (SQL): None
- Possibly used: id, room_id, staff_id, started_at, completed_at, from_status, to_status, override_flag, override_reason, device_id, created_at
- Never referenced: None

#### inventory_reservations
- Definitely used (SQL): resource_type, resource_id, kind, waitlist_id, expires_at, released_at, release_reason
- Possibly used: id, lane_session_id, created_at
- Never referenced: None

#### key_tags
- Definitely used (SQL): id, room_id, locker_id, tag_type, tag_code, is_active, updated_at
- Possibly used: created_at
- Never referenced: None

#### lockers
- Definitely used (SQL): id, number, status, created_at, updated_at, assigned_to_customer_id
- Possibly used: None
- Never referenced: None

#### rooms
- Definitely used (SQL): id, number, type, status, floor, last_status_change, override_flag, created_at, updated_at, assigned_to_customer_id
- Possibly used: version
- Never referenced: None

### Enums
#### inventory_reservation_kind (definitely)
- Definitely used (SQL): LANE_SELECTION, UPGRADE_HOLD
- Possibly used: None
- Never referenced: None

#### inventory_resource_type (definitely)
- Definitely used (SQL): room, locker
- Possibly used: None
- Never referenced: None

#### key_tag_type (definitely)
- Definitely used (SQL): QR, NFC
- Possibly used: None
- Never referenced: None

#### room_status (definitely)
- Definitely used (SQL): DIRTY, CLEANING, CLEAN, OCCUPIED
- Possibly used: None
- Never referenced: None

#### room_type (definitely)
- Definitely used (SQL): STANDARD, DELUXE, VIP, LOCKER, DOUBLE, SPECIAL
- Possibly used: None
- Never referenced: None

## Domain: telemetry
### Tables
- Definitely used: telemetry_events
- Possibly used: telemetry_spans, telemetry_traces
- Never referenced: None

### Columns by Table
#### telemetry_events
- Definitely used (SQL): id, created_at, app, level, kind, route, message, stack, request_id, session_id, device_id, lane, method, status, url, meta
- Possibly used: None
- Never referenced: None

#### telemetry_spans
- Definitely used (SQL): None
- Possibly used: id, trace_id, app, device_id, session_id, span_type, name, level, started_at, ended_at, duration_ms, route, method, status, url, message, stack, request_headers, response_headers, request_body, response_body, request_key, incident_id, incident_reason, meta
- Never referenced: None

#### telemetry_traces
- Definitely used (SQL): None
- Possibly used: trace_id, app, device_id, session_id, started_at, last_seen_at, incident_open, incident_last_at, meta
- Never referenced: None

## Domain: audit
### Tables
- Definitely used: audit_log
- Possibly used: None
- Never referenced: None

### Columns by Table
#### audit_log
- Definitely used (SQL): user_id, user_role, action, entity_type, entity_id, new_value, override_reason, staff_id
- Possibly used: id, old_value, ip_address, user_agent, created_at, metadata
- Never referenced: None

### Enums
#### audit_action (definitely)
- Definitely used (SQL): CREATE, UPDATE, DELETE, STATUS_CHANGE, ASSIGN, RELEASE, OVERRIDE, CHECK_IN, CHECK_OUT, UPGRADE_DISCLAIMER, STAFF_WEBAUTHN_ENROLLED, STAFF_LOGIN_WEBAUTHN, STAFF_LOGIN_PIN, STAFF_LOGOUT, STAFF_WEBAUTHN_REVOKED, STAFF_PIN_RESET, STAFF_REAUTH_REQUIRED, STAFF_CREATED, STAFF_UPDATED, STAFF_ACTIVATED, STAFF_DEACTIVATED, REGISTER_SIGN_IN, REGISTER_SIGN_OUT, REGISTER_FORCE_SIGN_OUT, WAITLIST_CREATED, WAITLIST_CANCELLED, WAITLIST_OFFERED, WAITLIST_COMPLETED, UPGRADE_STARTED, UPGRADE_PAID, UPGRADE_COMPLETED, FINAL_EXTENSION_STARTED, FINAL_EXTENSION_PAID, FINAL_EXTENSION_COMPLETED, STAFF_REAUTH_PIN, STAFF_REAUTH_WEBAUTHN, ROOM_STATUS_CHANGE, SHIFT_UPDATED, TIMECLOCK_ADJUSTED, TIMECLOCK_CLOSED, DOCUMENT_UPLOADED, TIME_OFF_REQUESTED, TIME_OFF_APPROVED, TIME_OFF_DENIED
- Possibly used: None
- Never referenced: None

## Domain: system
### Tables
- Definitely used: None
- Possibly used: schema_migrations
- Never referenced: None

### Columns by Table
#### schema_migrations
- Definitely used (SQL): None
- Possibly used: id, name, executed_at
- Never referenced: None

## High-Confidence Unused Candidates (static scan)
| Kind | Name | Reason |
| --- | --- | --- |
| column | `cleaning_batch_rooms.transition_time` | No code references |