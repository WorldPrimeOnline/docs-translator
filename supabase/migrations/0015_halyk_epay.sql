-- Migration 0015: Halyk ePay card payment integration
-- Extends payment_transactions with Halyk-specific fields.
-- Adds payment_pending status to jobs.
-- Adds atomic finalization RPC.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Add payment_pending to jobs status constraint
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_status_check;

ALTER TABLE public.jobs ADD CONSTRAINT jobs_status_check
  CHECK (status IN (
    'payment_pending',
    'queued', 'ocr_in_progress', 'ocr_completed',
    'translation_in_progress', 'pdf_rendering',
    'completed', 'failed'
  ));

-- Price in KZT (whole tenge, integer). Set at job creation for card payment orders.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS price_kzt INTEGER;

COMMENT ON COLUMN public.jobs.price_kzt IS
  'Price in KZT (whole tenge). Set at job creation for card payment orders. NULL for subscription jobs.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Extend payment_transactions status constraint
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.payment_transactions
  DROP CONSTRAINT IF EXISTS payment_transactions_status_check;

ALTER TABLE public.payment_transactions
  ADD CONSTRAINT payment_transactions_status_check
  CHECK (status IN (
    -- Legacy TON-era values (historical rows only — do not use in new code)
    'pending', 'completed', 'expired',
    -- Halyk ePay statuses
    'payment_pending', 'paid', 'failed', 'canceled',
    'refund_pending', 'refunded', 'requires_review', 'duplicate_charge_review'
  ));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Add Halyk-specific columns to payment_transactions
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.payment_transactions
  ADD COLUMN IF NOT EXISTS payment_source         TEXT,
  ADD COLUMN IF NOT EXISTS provider_invoice_id    TEXT,
  ADD COLUMN IF NOT EXISTS provider_invoice_suffix6 TEXT,
  ADD COLUMN IF NOT EXISTS provider_status        TEXT,
  ADD COLUMN IF NOT EXISTS provider_reason        TEXT,
  ADD COLUMN IF NOT EXISTS provider_reason_code   TEXT,
  ADD COLUMN IF NOT EXISTS secret_hash_digest     TEXT,
  ADD COLUMN IF NOT EXISTS attempt_number         INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS card_mask              TEXT,
  ADD COLUMN IF NOT EXISTS card_type              TEXT,
  ADD COLUMN IF NOT EXISTS issuer                 TEXT,
  ADD COLUMN IF NOT EXISTS approval_code          TEXT,
  ADD COLUMN IF NOT EXISTS reference              TEXT,
  ADD COLUMN IF NOT EXISTS secure                 TEXT,
  -- 'test' or 'production' — prevents mixing test/prod transactions
  ADD COLUMN IF NOT EXISTS provider_environment   TEXT NOT NULL DEFAULT 'test',
  ADD COLUMN IF NOT EXISTS callback_received_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status_checked_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_at                TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failed_at              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refunded_at            TIMESTAMPTZ,
  -- Sanitised Halyk response fields (no PAN/CVC; for dispute handling)
  ADD COLUMN IF NOT EXISTS provider_payload       JSONB;

COMMENT ON COLUMN public.payment_transactions.provider_invoice_id IS
  'Numeric-only Halyk invoiceID (up to 15 digits as string). Unique per attempt.';
COMMENT ON COLUMN public.payment_transactions.provider_invoice_suffix6 IS
  'Last 6 digits of provider_invoice_id. Unique constraint (Halyk requirement).';
COMMENT ON COLUMN public.payment_transactions.secret_hash_digest IS
  'SHA-256 hex digest of the secret_hash sent to Halyk. Raw secret never stored.';
COMMENT ON COLUMN public.payment_transactions.provider_environment IS
  'test or production. Prevents test transactions appearing in production reports.';
COMMENT ON COLUMN public.payment_transactions.provider_payload IS
  'Sanitised Halyk callback/status fields (no PAN, no CVV, no raw secrets).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Constraints
-- ─────────────────────────────────────────────────────────────────────────────
-- provider_invoice_id must be globally unique
ALTER TABLE public.payment_transactions
  ADD CONSTRAINT payment_transactions_provider_invoice_id_unique
  UNIQUE (provider_invoice_id);

-- Last 6 digits of invoice must be unique (Halyk requirement)
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_transactions_invoice_suffix6
  ON public.payment_transactions (provider_invoice_suffix6)
  WHERE provider_invoice_suffix6 IS NOT NULL;

-- Amount must be positive for new payments
ALTER TABLE public.payment_transactions
  ADD CONSTRAINT payment_transactions_amount_positive
  CHECK (amount > 0);

-- Halyk payments must be in KZT
ALTER TABLE public.payment_transactions
  ADD CONSTRAINT payment_transactions_halyk_currency_kzt
  CHECK (payment_provider <> 'halyk_epay' OR currency = 'KZT');

-- provider_environment must be valid
ALTER TABLE public.payment_transactions
  ADD CONSTRAINT payment_transactions_environment_check
  CHECK (provider_environment IN ('test', 'production'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Indexes
-- ─────────────────────────────────────────────────────────────────────────────
-- For reconciliation: find pending/review transactions
CREATE INDEX IF NOT EXISTS idx_payment_transactions_pending_reconcile
  ON public.payment_transactions (status, created_at)
  WHERE status IN ('payment_pending', 'requires_review');

-- For faster status lookup by invoice
CREATE INDEX IF NOT EXISTS idx_payment_transactions_invoice_id
  ON public.payment_transactions (provider_invoice_id)
  WHERE provider_invoice_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Atomic payment finalization function
-- Called by the server (service role) after authoritative CHARGE confirmation.
-- Locks the payment row, verifies it was not already processed, updates both
-- payment_transactions and jobs atomically.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finalize_halyk_payment(
  p_invoice_id          TEXT,
  p_transaction_id      TEXT,
  p_provider_status     TEXT,
  p_provider_reason     TEXT,
  p_provider_reason_code TEXT,
  p_card_mask           TEXT,
  p_card_type           TEXT,
  p_issuer              TEXT,
  p_approval_code       TEXT,
  p_reference           TEXT,
  p_secure              TEXT,
  p_provider_payload    JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.payment_transactions%ROWTYPE;
  v_result  JSONB;
BEGIN
  -- Acquire row lock on the payment transaction
  SELECT * INTO v_payment
    FROM public.payment_transactions
    WHERE provider_invoice_id = p_invoice_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payment_not_found');
  END IF;

  -- Idempotency: if already paid, return success without re-running downstream
  IF v_payment.status = 'paid' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_paid', true,
      'payment_id', v_payment.id,
      'job_id', v_payment.job_id
    );
  END IF;

  -- Finalize payment transaction
  UPDATE public.payment_transactions SET
    status                 = 'paid',
    provider_transaction_id = p_transaction_id,
    provider_status        = p_provider_status,
    provider_reason        = p_provider_reason,
    provider_reason_code   = p_provider_reason_code,
    card_mask              = p_card_mask,
    card_type              = p_card_type,
    issuer                 = p_issuer,
    approval_code          = p_approval_code,
    reference              = p_reference,
    secure                 = p_secure,
    provider_payload       = p_provider_payload,
    paid_at                = NOW(),
    callback_received_at   = NOW(),
    updated_at             = NOW()
  WHERE id = v_payment.id;

  -- Check whether a different payment already paid this job
  IF EXISTS (
    SELECT 1 FROM public.payment_transactions
    WHERE job_id = v_payment.job_id
      AND status = 'paid'
      AND id <> v_payment.id
  ) THEN
    -- Second charge detected: mark as duplicate
    UPDATE public.payment_transactions SET
      status     = 'duplicate_charge_review',
      updated_at = NOW()
    WHERE id = v_payment.id;

    RETURN jsonb_build_object(
      'ok', true,
      'duplicate_charge', true,
      'payment_id', v_payment.id,
      'job_id', v_payment.job_id
    );
  END IF;

  -- Move job from payment_pending to queued (start processing)
  UPDATE public.jobs SET
    status         = 'queued',
    payment_source = 'card_payment'
  WHERE id = v_payment.job_id
    AND status = 'payment_pending';

  RETURN jsonb_build_object(
    'ok', true,
    'already_paid', false,
    'duplicate_charge', false,
    'payment_id', v_payment.id,
    'job_id', v_payment.job_id
  );
END;
$$;

-- Revoke execute from all public/user roles; only service_role may call this
REVOKE EXECUTE ON FUNCTION public.finalize_halyk_payment FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.finalize_halyk_payment FROM anon;
REVOKE EXECUTE ON FUNCTION public.finalize_halyk_payment FROM authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_halyk_payment TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. RLS: ensure payment_transactions INSERT is restricted
-- (service_role bypasses RLS; authenticated users should not insert directly)
-- ─────────────────────────────────────────────────────────────────────────────
-- Drop the old insert policy that allowed user-side inserts
DROP POLICY IF EXISTS "payment_transactions_insert_own" ON public.payment_transactions;

-- Re-create select policy (unchanged: users can view their own records)
DROP POLICY IF EXISTS "payment_transactions_select_own" ON public.payment_transactions;
CREATE POLICY "payment_transactions_select_own"
  ON public.payment_transactions FOR SELECT
  USING (auth.uid() = user_id);
