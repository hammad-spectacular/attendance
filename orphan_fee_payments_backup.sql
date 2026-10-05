-- Backup of orphaned fee_payments rows removed on 2026-09-26T10:18:28.606Z
-- These referenced students that no longer exist, so they were invisible in the
-- fee list while still suppressing the reported totals.
BEGIN;

INSERT INTO fee_payments (id, tenant_id, student_id, month, amount_due, amount_paid, status, payment_date, payment_method, notes)
VALUES
  (6, 'ALIR', '23', '2025-09', 6000.00, 6000.00, 'paid', 'Thu Sep 25 2025 00:00:00 GMT+0500 (Pakistan Standard Time)', 'cash', 'Test payment'),
  (7, 'ALIR', '23', '2025-10', 6000.00, 6000.00, 'paid', 'Thu Sep 25 2025 00:00:00 GMT+0500 (Pakistan Standard Time)', 'cash', 'Test partial payment'),
  (8, 'ALIR', '23', '2025-11', 6000.00, 3000.00, 'partial', NULL, NULL, NULL),
  (9, 'ALIR', '23', '2025-12', 6000.00, 6000.00, 'paid', NULL, NULL, NULL),
  (10, 'ALIR', '33', '2025-10', 6000.00, 3000.00, 'partial', 'Fri Sep 25 2026 00:00:00 GMT+0500 (Pakistan Standard Time)', 'cash', 'Test payment from user workflow'),
  (11, 'ALIR', '33', '2026-09', 6000.00, 6000.00, 'paid', 'Fri Sep 25 2026 00:00:00 GMT+0500 (Pakistan Standard Time)', 'cash', 'Quick mark paid')
;

COMMIT;
