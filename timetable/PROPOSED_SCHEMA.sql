-- ============================================================================
--  PROPOSED TIMETABLE SCHEMA FOR THE EYE
--
--  STATUS: PROPOSAL ONLY — THIS FILE HAS NOT BEEN EXECUTED ANYWHERE.
--  Review it before it runs anywhere, and point it at a DEVELOPMENT database.
--
--  Design rules followed:
--    * Additive only: new tables, new indexes, one new feature-catalogue row.
--      No existing table is altered; no existing column is dropped or renamed.
--    * Every table carries tenant_id VARCHAR(10) (the school_code) exactly like
--      classes / teachers / attendance / homework already do, and every query
--      filters on it — that is how tenant isolation is enforced here.
--    * branch_id is nullable on timetables, mirroring classes.branch_id: a school
--      without branches keeps everything school-wide; coordinators stay confined
--      to their branch through the existing branchFilter()/requireWritableBranch().
--    * All schedules are configuration, not constants: working days, period
--      labels, kinds (teaching/break/lunch), times and preferences live in JSONB,
--      so two schools never share the same timetable shape.
--    * Nothing here is a paid service or external dependency.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Subjects (per school)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subjects (
  id            SERIAL PRIMARY KEY,
  tenant_id     VARCHAR(10) NOT NULL,
  code          VARCHAR(20) NOT NULL,
  name          VARCHAR(120) NOT NULL,
  difficult     BOOLEAN NOT NULL DEFAULT false,   -- feeds the "no two hard subjects back to back" preference
  created_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, code)
);
CREATE INDEX IF NOT EXISTS idx_subjects_tenant ON subjects(tenant_id);

-- ---------------------------------------------------------------------------
-- 2. Which teachers are qualified to teach which subjects
--    (many teachers per subject, one teacher across many subjects)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teacher_subjects (
  id            SERIAL PRIMARY KEY,
  tenant_id     VARCHAR(10) NOT NULL,
  teacher_id    INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  subject_id    INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, teacher_id, subject_id)
);
CREATE INDEX IF NOT EXISTS idx_teacher_subjects_teacher ON teacher_subjects(tenant_id, teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_subjects_subject ON teacher_subjects(tenant_id, subject_id);

-- ---------------------------------------------------------------------------
-- 3. Schedule configuration: working days, periods, breaks, preferences
--    One row per school (is_default marks the active one).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS timetable_configs (
  id            SERIAL PRIMARY KEY,
  tenant_id     VARCHAR(10) NOT NULL,
  name          VARCHAR(120) NOT NULL DEFAULT 'Default schedule',
  is_default    BOOLEAN NOT NULL DEFAULT true,
  -- ["Monday", "Tuesday", ...]
  days          JSONB NOT NULL,
  -- [{ label:"P1", kind:"teaching"|"break"|"lunch", start:"08:00", end:"08:40" }, ...]
  periods       JSONB NOT NULL,
  -- { maxSameSubjectPerDay:1, avoidConsecutiveDifficult:true, ... }
  preferences   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by    INTEGER,
  created_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_timetable_configs_tenant ON timetable_configs(tenant_id);

-- ---------------------------------------------------------------------------
-- 4. Rooms / laboratories (optional — a school that does not enable rooms
--    simply never writes rows here and requirements keep room_id NULL)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS timetable_rooms (
  id            SERIAL PRIMARY KEY,
  tenant_id     VARCHAR(10) NOT NULL,
  name          VARCHAR(120) NOT NULL,
  kind          VARCHAR(30) NOT NULL DEFAULT 'classroom',  -- classroom | laboratory | ...
  -- [{ day:"Monday", period:"P1" }, ...] periods the room cannot be used
  unavailable   JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_timetable_rooms_tenant ON timetable_rooms(tenant_id);

-- ---------------------------------------------------------------------------
-- 5. Teacher availability and workload limits
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS timetable_teacher_availability (
  id            SERIAL PRIMARY KEY,
  tenant_id     VARCHAR(10) NOT NULL,
  teacher_id    INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  day_index     INTEGER NOT NULL CHECK (day_index >= 0),
  period_index  INTEGER NOT NULL CHECK (period_index >= 0),
  available     BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (tenant_id, teacher_id, day_index, period_index)
);
CREATE INDEX IF NOT EXISTS idx_timetable_availability_teacher
  ON timetable_teacher_availability(tenant_id, teacher_id);

CREATE TABLE IF NOT EXISTS timetable_teacher_limits (
  tenant_id     VARCHAR(10) NOT NULL,
  teacher_id    INTEGER PRIMARY KEY REFERENCES teachers(id) ON DELETE CASCADE,
  max_per_day   INTEGER CHECK (max_per_day IS NULL OR max_per_day > 0),
  max_per_week  INTEGER CHECK (max_per_week IS NULL OR max_per_week > 0),
  updated_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- 6. Weekly requirements: how many periods of which subject a class needs,
--    optionally pinned to a room
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS timetable_class_subjects (
  id               SERIAL PRIMARY KEY,
  tenant_id        VARCHAR(10) NOT NULL,
  config_id        INTEGER NOT NULL REFERENCES timetable_configs(id) ON DELETE CASCADE,
  class_id         INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id       INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  periods_per_week INTEGER NOT NULL CHECK (periods_per_week > 0),
  room_id          INTEGER REFERENCES timetable_rooms(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, config_id, class_id, subject_id)
);
CREATE INDEX IF NOT EXISTS idx_timetable_cs_config
  ON timetable_class_subjects(tenant_id, config_id);

-- ---------------------------------------------------------------------------
-- 7. Which teachers may teach which class/subject (many-to-many, so the same
--    subject can be shared by several teachers for the same class)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS timetable_teacher_assignments (
  id                  SERIAL PRIMARY KEY,
  tenant_id           VARCHAR(10) NOT NULL,
  class_subject_id    INTEGER NOT NULL
                        REFERENCES timetable_class_subjects(id) ON DELETE CASCADE,
  teacher_id          INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, class_subject_id, teacher_id)
);
CREATE INDEX IF NOT EXISTS idx_timetable_ta_teacher
  ON timetable_teacher_assignments(tenant_id, teacher_id);

-- ---------------------------------------------------------------------------
-- 8. The timetable itself: one row per published/drafted week
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS timetables (
  id            SERIAL PRIMARY KEY,
  tenant_id     VARCHAR(10) NOT NULL,
  branch_id     INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  config_id     INTEGER REFERENCES timetable_configs(id) ON DELETE SET NULL,
  name          VARCHAR(160) NOT NULL,
  status        VARCHAR(16) NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'published')),
  created_by    INTEGER,
  published_by  INTEGER,
  published_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_timetables_tenant ON timetables(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_timetables_branch ON timetables(tenant_id, branch_id);

-- ---------------------------------------------------------------------------
-- 9. Timetable cells. day_index / period_index point at the config's arrays.
--    Two partial unique indexes make H1/H2/H8 a database-level guarantee, so a
--    bug anywhere in the app still cannot store a double booking.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS timetable_entries (
  id            SERIAL PRIMARY KEY,
  tenant_id     VARCHAR(10) NOT NULL,
  timetable_id  INTEGER NOT NULL REFERENCES timetables(id) ON DELETE CASCADE,
  class_id      INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id    INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  teacher_id    INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  room_id       INTEGER REFERENCES timetable_rooms(id) ON DELETE SET NULL,
  day_index     INTEGER NOT NULL CHECK (day_index >= 0),
  period_index  INTEGER NOT NULL CHECK (period_index >= 0),
  locked        BOOLEAN NOT NULL DEFAULT false,   -- preserved across regeneration
  created_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (timetable_id, class_id, day_index, period_index)   -- H2: one lesson per class per slot
);

-- H1: one class per teacher per slot
CREATE UNIQUE INDEX IF NOT EXISTS idx_timetable_entries_teacher_slot
  ON timetable_entries(timetable_id, teacher_id, day_index, period_index);

-- H8: one class per room per slot (rooms only)
CREATE UNIQUE INDEX IF NOT EXISTS idx_timetable_entries_room_slot
  ON timetable_entries(timetable_id, room_id, day_index, period_index)
  WHERE room_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_timetable_entries_timetable
  ON timetable_entries(timetable_id);
CREATE INDEX IF NOT EXISTS idx_timetable_entries_tenant
  ON timetable_entries(tenant_id, class_id);

-- ---------------------------------------------------------------------------
-- 10. Feature flag: switch the module on per school, exactly like 'fees'.
--     default_enabled stays false so no school sees a half-built tab until the
--     Super Admin grants it.
-- ---------------------------------------------------------------------------
INSERT INTO tenant_features (key, label, description, default_enabled, sort_order)
VALUES ('timetable', 'Timetable',
        'Class timetables: manual editing and automatic generation', false, 95)
ON CONFLICT (key) DO NOTHING;
