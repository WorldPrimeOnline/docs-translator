-- Migration 0045: allow 'skipped_no_operations' status on fiscal_z_reports.
-- Webkassa only opens a shift when a sale/refund is fiscalized. Sending
-- zreport/create on days with no qualifying operations returns Code 12
-- ("Смена уже закрыта") for 15+ consecutive days on cashbox SWK00529346.
-- The worker now pre-checks for qualifying operations and records this
-- status instead of calling zreport/create when there's nothing to close.

ALTER TABLE fiscal_z_reports
  DROP CONSTRAINT IF EXISTS fiscal_z_reports_status_check;

ALTER TABLE fiscal_z_reports
  ADD CONSTRAINT fiscal_z_reports_status_check
  CHECK (status IN ('pending', 'issued', 'failed', 'already_closed', 'skipped_no_operations'));

COMMENT ON COLUMN fiscal_z_reports.status IS
  'pending: created, not yet issued. '
  'issued: Z-report successfully created. '
  'failed: API call failed. '
  'already_closed: Webkassa error 12 (shift already closed) — treated as success. '
  'skipped_no_operations: no qualifying sale/refund fiscal_receipts since the last '
  'successful Z-report — zreport/create was not called.';
