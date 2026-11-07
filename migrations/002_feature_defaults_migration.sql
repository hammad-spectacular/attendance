-- ============================================================================
-- MIGRATION: Feature defaults for existing academies
--
-- This migration preserves current feature settings for existing academies
-- while setting up the correct defaults for new academies.
--
-- BASIC features (enabled by default for all academies):
-- - attendance
-- - student_management
-- - teacher_management
-- - fees
-- - coordinator_management
-- - coordinator_portal
--
-- ADVANCED features (off by default, superadmin can enable per academy):
-- - student_portal
-- - teacher_portal
-- - whatsapp
-- - biometric
-- - qr_attendance
-- - timetable
-- ============================================================================

-- Ensure tenant_features has the new features
INSERT INTO tenant_features (key, label, description, default_enabled, sort_order) VALUES
  ('qr_attendance', 'QR Attendance', 'QR-based staff check-in and attendance tracking', false, 95),
  ('timetable', 'Timetable', 'Automated timetable generator', false, 100)
ON CONFLICT (key) DO NOTHING;

-- For existing academies:
-- If they already have an explicit tenant_grants row, keep it (preserve their choice)
-- If they don't have a row for a feature, set it based on current usage:
-- - If they have teacher_attendance records, enable qr_attendance
-- - If they have tt2_timetables records, enable timetable
-- - Otherwise, use the default_enabled from tenant_features

-- Enable qr_attendance for academies that have used it
INSERT INTO tenant_grants (school_id, feature_key, enabled, updated_at)
SELECT DISTINCT teacher_attendance.tenant_id, 'qr_attendance', true, NOW()
FROM teacher_attendance
LEFT JOIN tenant_grants tg ON tg.school_id = teacher_attendance.tenant_id AND tg.feature_key = 'qr_attendance'
WHERE tg.enabled IS NULL
ON CONFLICT (school_id, feature_key) DO NOTHING;

-- Enable timetable for academies that have used it
INSERT INTO tenant_grants (school_id, feature_key, enabled, updated_at)
SELECT DISTINCT tt2_timetables.tenant_id, 'timetable', true, NOW()
FROM tt2_timetables
LEFT JOIN tenant_grants tg ON tg.school_id = tt2_timetables.tenant_id AND tg.feature_key = 'timetable'
WHERE tg.enabled IS NULL
ON CONFLICT (school_id, feature_key) DO NOTHING;

-- Ensure all academies have rows for basic features (enabled=true)
INSERT INTO tenant_grants (school_id, feature_key, enabled, updated_at)
SELECT o.school_code, tf.key, tf.default_enabled, NOW()
FROM organizations o
CROSS JOIN tenant_features tf
WHERE tf.default_enabled = true
LEFT JOIN tenant_grants tg ON tg.school_id = o.school_code AND tg.feature_key = tf.key
WHERE tg.enabled IS NULL
ON CONFLICT (school_id, feature_key) DO NOTHING;

-- Ensure all academies have rows for advanced features (use default_enabled=false)
INSERT INTO tenant_grants (school_id, feature_key, enabled, updated_at)
SELECT o.school_code, tf.key, tf.default_enabled, NOW()
FROM organizations o
CROSS JOIN tenant_features tf
WHERE tf.default_enabled = false
LEFT JOIN tenant_grants tg ON tg.school_id = o.school_code AND tg.feature_key = tf.key
WHERE tg.enabled IS NULL
ON CONFLICT (school_id, feature_key) DO NOTHING;
