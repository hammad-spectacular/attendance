-- ============================================================================
-- CLEANUP: Remove unused tables from PROPOSED_SCHEMA.sql
--
-- These tables were created but are not used by the tt2 system.
-- The tt2 system uses a document-based approach with tt2_timetables table.
-- ============================================================================
--
-- IMPORTANT: This migration should be tested on a Neon branch copy first.
-- Review the tables being dropped before running on the live database.
-- ============================================================================

-- Drop unused timetable tables (from PROPOSED_SCHEMA.sql)
-- These were created for a normalized schema that was never integrated.

DROP TABLE IF EXISTS timetable_entries CASCADE;
DROP TABLE IF EXISTS timetable_teacher_assignments CASCADE;
DROP TABLE IF EXISTS timetable_class_subjects CASCADE;
DROP TABLE IF EXISTS timetable_teacher_limits CASCADE;
DROP TABLE IF EXISTS timetable_teacher_availability CASCADE;
DROP TABLE IF EXISTS timetable_rooms CASCADE;
DROP TABLE IF EXISTS timetable_configs CASCADE;
DROP TABLE IF EXISTS teacher_subjects CASCADE;
DROP TABLE IF EXISTS subjects CASCADE;
DROP TABLE IF EXISTS timetables CASCADE;

-- Remove the timetable feature flag that was added
DELETE FROM tenant_features WHERE key = 'timetable';

-- Note: The tt2_timetables table (used by the current system) is NOT dropped.
-- Only the unused tables from PROPOSED_SCHEMA.sql are removed.
