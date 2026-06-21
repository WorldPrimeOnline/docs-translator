-- Migration 0017: Fiscal receipts table
-- Tracks fiscalization state for every card payment and refund.
-- Fiscal failure must never block a successful payment — the job stays queued.
-- One sale receipt per payment_transaction (enforced by unique constraint).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Create fiscal_receipts table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fiscal_receipts (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Core references
  job_id                      UUID NOT NULL REFERENCES public.jobs(id),
  document_id                 UUID NOT NULL REFERENCES public.documents(id),
  payment_transaction_id      UUID NOT NULL REFERENCES public.payment_transactions(id),

  -- Provider metadata
  provider                    TEXT NOT NULL DEFAULT 'manual',
  provider_environment        TEXT NOT NULL DEFAULT 'test'
                              CHECK (provider_environment IN ('test', 'production')),
  provider_receipt_id         TEXT,
  provider_shift_id           TEXT,
  provider_cashbox_id         TEXT,
  fiscal_sign                 TEXT,
  fiscal_url                  TEXT,

  -- Financial details
  amount_kzt                  INTEGER NOT NULL CHECK (amount_kzt > 0),
  currency                    TEXT NOT NULL DEFAULT 'KZT' CHECK (currency = 'KZT'),
  operation_type              TEXT NOT NULL DEFAULT 'sale'
                              CHECK (operation_type IN ('sale', 'refund', 'correction')),

  -- Lifecycle status
  -- pending_manual: no provider configured; operator must issue receipt manually
  -- pending:        provider configured; receipt creation queued
  -- issued:         provider confirmed receipt
  -- failed:         provider returned error; may be retried
  -- retry_required: transient error; eligible for retry
  -- canceled:       manually voided by operator
  status                      TEXT NOT NULL DEFAULT 'pending_manual'
                              CHECK (status IN (
                                'pending_manual', 'pending', 'issued',
                                'failed', 'retry_required', 'canceled'
                              )),

  -- Customer contact (for receipt delivery)
  customer_email              TEXT,
  customer_phone              TEXT,

  -- Sanitised payloads (no card data)
  receipt_payload_sanitized   JSONB,
  provider_response_sanitized JSONB,

  -- Error tracking
  error_code                  TEXT,
  error_message               TEXT,
  retry_count                 INTEGER NOT NULL DEFAULT 0,

  -- Timestamps
  issued_at                   TIMESTAMPTZ,
  failed_at                   TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.fiscal_receipts IS
  'Tracks fiscal receipt state for every card payment. One sale receipt per payment_transaction.';
COMMENT ON COLUMN public.fiscal_receipts.status IS
  'pending_manual: no provider active, operator must issue manually. pending/issued/failed: provider states.';
COMMENT ON COLUMN public.fiscal_receipts.provider IS
  'Fiscal provider adapter name. "manual" = no integration; operator issues receipt via OFD cabinet.';
COMMENT ON COLUMN public.fiscal_receipts.receipt_payload_sanitized IS
  'Request sent to fiscal provider. Must not contain card data (PAN, CVV).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Idempotency: one sale receipt per payment transaction
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_fiscal_receipts_payment_sale
  ON public.fiscal_receipts (payment_transaction_id)
  WHERE operation_type = 'sale';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Indexes for reconciliation
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_fiscal_receipts_status
  ON public.fiscal_receipts (status, created_at);

CREATE INDEX IF NOT EXISTS idx_fiscal_receipts_job_id
  ON public.fiscal_receipts (job_id);

CREATE INDEX IF NOT EXISTS idx_fiscal_receipts_payment_transaction_id
  ON public.fiscal_receipts (payment_transaction_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RLS: clients cannot write to fiscal_receipts
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.fiscal_receipts ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS. No authenticated-user write policy.
-- Read access: users can view their own fiscal receipts (for receipt link display).
CREATE POLICY "fiscal_receipts_select_own"
  ON public.fiscal_receipts FOR SELECT
  USING (
    job_id IN (
      SELECT j.id FROM public.jobs j
      JOIN public.documents d ON d.id = j.document_id
      WHERE d.user_id = auth.uid()
    )
  );
