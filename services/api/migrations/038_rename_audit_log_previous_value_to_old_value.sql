-- Migration 038: Rename previous_value to old_value in audit_log table
-- Aligns database with db/schema.sql (canonical schema)

BEGIN;

-- Rename column from previous_value to old_value
ALTER TABLE audit_log 
RENAME COLUMN previous_value TO old_value;

COMMIT;

