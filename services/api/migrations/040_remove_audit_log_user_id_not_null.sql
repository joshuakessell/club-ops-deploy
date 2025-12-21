-- Migration 040: Remove NOT NULL constraint from user_id in audit_log
-- Allows inserts to work when only staff_id is provided (as per schema.sql)
-- 
-- Note: user_id and user_role are kept for backward compatibility per migration 011,
-- but the NOT NULL constraint prevents new inserts that only use staff_id.
-- This migration makes user_id nullable to match the current codebase behavior.

BEGIN;

-- Drop NOT NULL constraint from user_id
ALTER TABLE audit_log 
ALTER COLUMN user_id DROP NOT NULL;

-- Also make user_role nullable for consistency
ALTER TABLE audit_log 
ALTER COLUMN user_role DROP NOT NULL;

COMMIT;

