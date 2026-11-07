-- Migration: Add tenant_id to teacher_attendance_manual_changes
-- Purpose: Complete tenant isolation for manual changes history
-- This migration does NOT execute against live database - review and approve first

-- Add tenant_id column
ALTER TABLE teacher_attendance_manual_changes
ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(10) REFERENCES organizations(school_code) ON DELETE CASCADE;

-- Backfill existing rows from teacher_attendance
UPDATE teacher_attendance_manual_changes mc
SET tenant_id = ta.tenant_id
FROM teacher_attendance ta
WHERE mc.attendance_id = ta.id
AND mc.tenant_id IS NULL;

-- Make the column NOT NULL after backfill
ALTER TABLE teacher_attendance_manual_changes
ALTER COLUMN tenant_id SET NOT NULL;

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_manual_changes_tenant ON teacher_attendance_manual_changes(tenant_id);

-- Note: This completes tenant isolation for the manual changes table.
-- Future queries should filter by tenant_id directly instead of joining through teacher_attendance.
