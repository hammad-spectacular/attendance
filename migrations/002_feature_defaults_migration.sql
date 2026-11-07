-- Migration: Feature Defaults for Multi-Academy Support
-- Purpose: Set default_enabled values for existing features and preserve current academy settings
-- This migration does NOT execute against live database - review and approve first
-- Run only after creating branch from production and testing

-- Update feature catalogue defaults
-- BASIC features (enabled by default for all academies, including new ones):
UPDATE tenant_features
SET default_enabled = true
WHERE key IN (
  'attendance',
  'student_management',
  'teacher_management',
  'fees',
  'coordinator_management',
  'coordinator_portal'
);

-- ADVANCED features (OFF by default for all academies, including new ones):
UPDATE tenant_features
SET default_enabled = false
WHERE key IN (
  'student_portal',
  'teacher_portal',
  'whatsapp',
  'biometric',
  'qr_attendance',
  'timetable'
);

-- Preserve existing academy settings by creating explicit grant rows
-- For any academy that currently has a feature enabled (either by default or explicit grant),
-- create an explicit tenant_grants row to preserve that behavior.
-- This ensures existing academies are not broken by the default changes.

INSERT INTO tenant_grants (school_id, feature_key, enabled, updated_by, updated_at)
SELECT DISTINCT
  o.school_code,
  tf.key,
  COALESCE(tg.enabled, tf.default_enabled),
  NULL,
  NOW()
FROM organizations o
CROSS JOIN tenant_features tf
LEFT JOIN tenant_grants tg ON tg.school_id = o.school_code AND tg.feature_key = tf.key
WHERE COALESCE(tg.enabled, tf.default_enabled) = true
ON CONFLICT (school_id, feature_key) DO UPDATE SET
  enabled = EXCLUDED.enabled,
  updated_at = NOW();

-- Note: For academies that already have explicit grant rows, this preserves their enabled state.
-- For academies with no explicit row, it uses the catalogue default (which we just updated above).
-- New academies created after this migration will use the new defaults:
--   - BASIC features: ON by default
--   - ADVANCED features: OFF by default
