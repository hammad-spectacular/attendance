-- Student Fee Management schema.
-- Additive only: does not alter existing fee, voucher, student, or payment
-- records. Run only against the verified development database.
-- Roll back only before fee data has been entered, by dropping these new
-- tables in reverse dependency order. Never run this file from app startup.

BEGIN;

-- Fee configuration items. Three levels mirror the spec:
--   school  -> default fees for the whole academy (class_id/student_id NULL)
--   class   -> overrides the school rate for the same fee name in one class
--   student -> per-student rate override, discount, exemption or extra charge
CREATE TABLE fee_items (
  id BIGSERIAL PRIMARY KEY,
  tenant_id VARCHAR(10) NOT NULL REFERENCES organizations(school_code) ON DELETE RESTRICT,
  branch_id INTEGER REFERENCES branches(id) ON DELETE RESTRICT,
  level VARCHAR(10) NOT NULL CHECK (level IN ('school', 'class', 'student')),
  class_id INTEGER REFERENCES classes(id) ON DELETE RESTRICT,
  student_id INTEGER REFERENCES students(id) ON DELETE RESTRICT,
  name VARCHAR(150) NOT NULL,
  category VARCHAR(60) NOT NULL DEFAULT 'other',
  amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  frequency VARCHAR(16) NOT NULL DEFAULT 'monthly'
    CHECK (frequency IN ('one_time', 'monthly', 'quarterly', 'annually', 'per_term')),
  billing_mode VARCHAR(10) NOT NULL DEFAULT 'full'
    CHECK (billing_mode IN ('full', 'prorated')),
  effective_from DATE NOT NULL,
  effective_to DATE,
  due_day SMALLINT NOT NULL DEFAULT 10 CHECK (due_day BETWEEN 1 AND 31),
  discount_percent NUMERIC(5,2) CHECK (discount_percent IS NULL OR (discount_percent >= 0 AND discount_percent <= 100)),
  discount_amount NUMERIC(12,2) CHECK (discount_amount IS NULL OR discount_amount >= 0),
  exempt BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (level <> 'class'   OR class_id   IS NOT NULL),
  CHECK (level <> 'student' OR student_id IS NOT NULL),
  CHECK (level =  'school'  OR (class_id IS NULL AND student_id IS NULL)
      OR  (level = 'class'  AND student_id IS NULL)
      OR  (level = 'student' AND class_id IS NULL)),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  UNIQUE (id, tenant_id)
);
CREATE INDEX fee_items_tenant_level_idx ON fee_items(tenant_id, level, is_active);
CREATE INDEX fee_items_tenant_class_idx ON fee_items(tenant_id, class_id);
CREATE INDEX fee_items_tenant_student_idx ON fee_items(tenant_id, student_id);

-- Actual bills owed by a student. One row per fee item per billing period.
-- original_amount / discount_amount / final_amount snapshot the rate at
-- generation time so later config edits never rewrite history.
CREATE TABLE student_fee_obligations (
  id BIGSERIAL PRIMARY KEY,
  tenant_id VARCHAR(10) NOT NULL REFERENCES organizations(school_code) ON DELETE RESTRICT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id INTEGER REFERENCES classes(id) ON DELETE RESTRICT,
  branch_id INTEGER REFERENCES branches(id) ON DELETE RESTRICT,
  fee_item_id BIGINT,
  fee_name VARCHAR(150) NOT NULL,
  category VARCHAR(60) NOT NULL DEFAULT 'other',
  frequency VARCHAR(16) NOT NULL,
  applied_level VARCHAR(10) NOT NULL,
  original_amount NUMERIC(12,2) NOT NULL CHECK (original_amount >= 0),
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  final_amount NUMERIC(12,2) NOT NULL CHECK (final_amount >= 0),
  billing_period_start DATE,
  billing_period_end DATE,
  period_label VARCHAR(40),
  due_date DATE,
  status VARCHAR(16) NOT NULL DEFAULT 'unpaid'
    CHECK (status IN ('unpaid', 'partially_paid', 'paid', 'overdue', 'exempt', 'waived', 'cancelled')),
  source VARCHAR(20) NOT NULL DEFAULT 'manual'
    CHECK (source IN ('registration', 'reconciliation', 'manual', 'class_change', 'backfill')),
  idempotency_key VARCHAR(160) NOT NULL,
  notes TEXT,
  created_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (fee_item_id, tenant_id) REFERENCES fee_items(id, tenant_id) ON DELETE SET NULL,
  UNIQUE (id, tenant_id),
  UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX student_fee_obligations_student_idx
  ON student_fee_obligations(tenant_id, student_id, status);
CREATE INDEX student_fee_obligations_class_idx
  ON student_fee_obligations(tenant_id, class_id, status);
CREATE INDEX student_fee_obligations_due_idx
  ON student_fee_obligations(tenant_id, due_date);
CREATE INDEX student_fee_obligations_period_idx
  ON student_fee_obligations(tenant_id, billing_period_start);

-- Money received against obligations. Several rows can share one receipt_no
-- when a single payment is split across a student's obligations; every row is
-- a separate allocation so partial payments and history stay exact.
CREATE TABLE student_fee_payments (
  id BIGSERIAL PRIMARY KEY,
  tenant_id VARCHAR(10) NOT NULL REFERENCES organizations(school_code) ON DELETE RESTRICT,
  receipt_no VARCHAR(40) NOT NULL,
  batch_id VARCHAR(40) NOT NULL,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  obligation_id BIGINT NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_date DATE NOT NULL,
  payment_method VARCHAR(40) NOT NULL DEFAULT 'cash',
  received_by INTEGER,
  received_by_name VARCHAR(150),
  notes TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'reversed')),
  reversed_at TIMESTAMPTZ,
  reversed_by VARCHAR(150),
  idempotency_key VARCHAR(160),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (obligation_id, tenant_id) REFERENCES student_fee_obligations(id, tenant_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX student_fee_payments_obligation_idx
  ON student_fee_payments(tenant_id, obligation_id, status);
CREATE INDEX student_fee_payments_student_idx
  ON student_fee_payments(tenant_id, student_id, payment_date DESC);
CREATE INDEX student_fee_payments_receipt_idx
  ON student_fee_payments(tenant_id, receipt_no);

COMMIT;
