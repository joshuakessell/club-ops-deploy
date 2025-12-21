-- Migration 041: Add metadata column to audit_log table
-- Aligns database with db/schema.sql (canonical schema)
--
-- Note: The original migration 008 created override_reason TEXT, but schema.sql shows
-- metadata JSONB. The metadata column is a more flexible JSONB field that can store
-- override information and other metadata. This migration adds the metadata column.
-- The override_reason column remains for backward compatibility but new code should use metadata.

BEGIN;

-- Add metadata JSONB column
ALTER TABLE audit_log 
ADD COLUMN IF NOT EXISTS metadata JSONB;

COMMIT;

