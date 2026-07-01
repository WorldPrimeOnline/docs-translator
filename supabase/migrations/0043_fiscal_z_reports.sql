-- Z-report (shift close) results table.
--
-- One Z-report per cashbox per business_date (UNIQUE constraint enforces idempotency).
-- Worker runs Z-report daily at the configured hour in WEBKASSA_Z_REPORT_TIMEZONE.
-- Z-report is only issued when no pending fiscal receipts remain for the same cashbox.

CREATE TABLE IF NOT EXISTS fiscal_z_reports (
  id                          UUID        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  cashbox_id                  TEXT        NOT NULL,
  business_date               DATE        NOT NULL,
  report_type                 TEXT        NOT NULL DEFAULT 'z_report',
  status                      TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'issued', 'failed', 'already_closed')),
  shift_number                INT,
  document_count              INT,
  provider_response_sanitized JSONB,
  error_code                  TEXT,
  error_message               TEXT,
  issued_at                   TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cashbox_id, business_date)
);

ALTER TABLE fiscal_z_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON fiscal_z_reports
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

CREATE INDEX IF NOT EXISTS fiscal_z_reports_cashbox_date_idx
  ON fiscal_z_reports (cashbox_id, business_date DESC);

COMMENT ON TABLE fiscal_z_reports IS
  'Z-report (shift close) results from Webkassa API. '
  'One row per cashbox per business_date. Idempotent via unique constraint.';

COMMENT ON COLUMN fiscal_z_reports.status IS
  'pending: created, not yet issued. '
  'issued: Z-report successfully created. '
  'failed: API call failed. '
  'already_closed: Webkassa error 12 (shift already closed) — treated as success.';
