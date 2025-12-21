-- Migration 039: Add ROOM_STATUS_CHANGE to audit_action enum
-- Aligns database with db/schema.sql (canonical schema)
-- 
-- Note: The enum already has STATUS_CHANGE from migration 008.
-- ROOM_STATUS_CHANGE is a more specific value that should be used for room status transitions.
-- This migration adds the new value. Existing code using STATUS_CHANGE should be updated
-- to use ROOM_STATUS_CHANGE for room status changes.
--
-- Note: Following the pattern from migrations 015 and 032, using IF NOT EXISTS
-- (PostgreSQL 9.1+ supports this for ALTER TYPE ADD VALUE)
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'ROOM_STATUS_CHANGE';

