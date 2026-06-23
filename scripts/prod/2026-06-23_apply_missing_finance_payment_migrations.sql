-- =============================================================================
-- PRODUCTION MIGRATION BUNDLE — 2026-06-23
-- Missing migrations 0017 → 0026 for wpotranslations.org production Supabase
-- =============================================================================
--
-- INCIDENT: POST /api/payments/halyk/initiate → 500
--   [halyk/initiate] failed to create payment_transaction  (missing 0023 columns)
--   [fiscal-reconcile] Could not find table 'public.fiscal_receipts'  (missing 0017)
--   [fiscal-reconcile] Could not find table 'public.refund_transactions'  (missing 0018)
--   [upload-card] PRICING_NOT_CONFIGURED  (missing 0019)
--
-- SAFETY RULES applied to this bundle:
--   • CREATE TABLE IF NOT EXISTS — safe to re-run
--   • ALTER TABLE ADD COLUMN IF NOT EXISTS — safe to re-run
--   • CREATE INDEX IF NOT EXISTS — safe to re-run
--   • CREATE OR REPLACE FUNCTION — safe to re-run
--   • INSERT ... ON CONFLICT DO NOTHING — safe to re-run
--   • DROP POLICY IF EXISTS before each CREATE POLICY — safe to re-run
--   • No DROP TABLE, TRUNCATE, DELETE, or ALTER COLUMN TYPE
--
-- HOW TO APPLY:
--   1. Open Supabase Dashboard → SQL Editor (production project)
--   2. Paste this entire file
--   3. Run — review output for any ERRORs before marking done
--   4. After success: run STEP 2 (schema audit) below to verify
--   5. Reload schema cache: NOTIFY pgrst, 'reload schema';
--   6. Trigger Railway worker restart (Railway dashboard → Redeploy)
--   7. Trigger Vercel production redeploy if needed
--
-- =============================================================================
-- STEP 1: SCHEMA AUDIT — run this first to see current production state
-- =============================================================================
-- (Uncomment and run separately before applying migrations)
--
-- SELECT
--   to_regclass('public.fiscal_receipts')      AS fiscal_receipts,
--   to_regclass('public.refund_transactions')  AS refund_transactions,
--   to_regclass('public.pricing_versions')     AS pricing_versions,
--   to_regclass('public.price_quotes')         AS price_quotes,
--   to_regclass('public.price_quote_items')    AS price_quote_items,
--   to_regclass('public.cost_reservations')    AS cost_reservations,
--   to_regclass('public.payment_transactions') AS payment_transactions,
--   to_regclass('public.jobs')                 AS jobs;
--
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'payment_transactions'
-- ORDER BY ordinal_position;
--
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'jobs'
--   AND column_name IN (
--     'customer_comment','finance_jira_issue_id','finance_jira_issue_key',
--     'finance_jira_issue_url','finance_jira_sync_status',
--     'finance_jira_last_error','finance_jira_synced_at','price_kzt'
--   );
--
-- SELECT count(*) FROM public.pricing_versions WHERE status = 'active';
-- =============================================================================

BEGIN;

-- =============================================================================
-- 0017: fiscal_receipts
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.fiscal_receipts (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                      UUID NOT NULL REFERENCES public.jobs(id),
  document_id                 UUID NOT NULL REFERENCES public.documents(id),
  payment_transaction_id      UUID NOT NULL REFERENCES public.payment_transactions(id),
  provider                    TEXT NOT NULL DEFAULT 'manual',
  provider_environment        TEXT NOT NULL DEFAULT 'test'
                              CHECK (provider_environment IN ('test', 'production')),
  provider_receipt_id         TEXT,
  provider_shift_id           TEXT,
  provider_cashbox_id         TEXT,
  fiscal_sign                 TEXT,
  fiscal_url                  TEXT,
  amount_kzt                  INTEGER NOT NULL CHECK (amount_kzt > 0),
  currency                    TEXT NOT NULL DEFAULT 'KZT' CHECK (currency = 'KZT'),
  operation_type              TEXT NOT NULL DEFAULT 'sale'
                              CHECK (operation_type IN ('sale', 'refund', 'correction')),
  status                      TEXT NOT NULL DEFAULT 'pending_manual'
                              CHECK (status IN (
                                'pending_manual', 'blocked_by_config', 'pending', 'issued',
                                'failed', 'retry_required', 'canceled'
                              )),
  customer_email              TEXT,
  customer_phone              TEXT,
  receipt_payload_sanitized   JSONB,
  provider_response_sanitized JSONB,
  error_code                  TEXT,
  error_message               TEXT,
  retry_count                 INTEGER NOT NULL DEFAULT 0,
  issued_at                   TIMESTAMPTZ,
  failed_at                   TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fiscal_receipts_payment_sale
  ON public.fiscal_receipts (payment_transaction_id)
  WHERE operation_type = 'sale';

CREATE INDEX IF NOT EXISTS idx_fiscal_receipts_status
  ON public.fiscal_receipts (status, created_at);

CREATE INDEX IF NOT EXISTS idx_fiscal_receipts_job_id
  ON public.fiscal_receipts (job_id);

CREATE INDEX IF NOT EXISTS idx_fiscal_receipts_payment_transaction_id
  ON public.fiscal_receipts (payment_transaction_id);

ALTER TABLE public.fiscal_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fiscal_receipts_select_own" ON public.fiscal_receipts;
CREATE POLICY "fiscal_receipts_select_own"
  ON public.fiscal_receipts FOR SELECT
  USING (
    job_id IN (
      SELECT j.id FROM public.jobs j
      JOIN public.documents d ON d.id = j.document_id
      WHERE d.user_id = auth.uid()
    )
  );

-- =============================================================================
-- 0018: refund_transactions + get_refundable_amount RPC
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.refund_transactions (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                      UUID NOT NULL REFERENCES public.jobs(id),
  payment_transaction_id      UUID NOT NULL REFERENCES public.payment_transactions(id),
  provider                    TEXT NOT NULL DEFAULT 'halyk_epay',
  provider_environment        TEXT NOT NULL DEFAULT 'test'
                              CHECK (provider_environment IN ('test', 'production')),
  provider_refund_id          TEXT,
  provider_transaction_id     TEXT,
  refund_amount_kzt           INTEGER NOT NULL CHECK (refund_amount_kzt > 0),
  currency                    TEXT NOT NULL DEFAULT 'KZT' CHECK (currency = 'KZT'),
  status                      TEXT NOT NULL DEFAULT 'pending_manual'
                              CHECK (status IN (
                                'requested', 'pending', 'succeeded', 'failed',
                                'requires_review', 'pending_manual', 'canceled'
                              )),
  reason                      TEXT NOT NULL,
  operator_id                 TEXT,
  idempotency_key             TEXT NOT NULL UNIQUE,
  fiscal_refund_receipt_id    UUID REFERENCES public.fiscal_receipts(id),
  provider_response_sanitized JSONB,
  error_code                  TEXT,
  error_message               TEXT,
  requested_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at                TIMESTAMPTZ,
  failed_at                   TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refund_transactions_payment_id
  ON public.refund_transactions (payment_transaction_id);

CREATE INDEX IF NOT EXISTS idx_refund_transactions_status
  ON public.refund_transactions (status, created_at);

CREATE INDEX IF NOT EXISTS idx_refund_transactions_job_id
  ON public.refund_transactions (job_id);

CREATE OR REPLACE FUNCTION public.get_refundable_amount(
  p_payment_transaction_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paid_amount     INTEGER;
  v_refunded_amount INTEGER;
BEGIN
  SELECT COALESCE(amount::INTEGER, 0)
    INTO v_paid_amount
    FROM public.payment_transactions
    WHERE id = p_payment_transaction_id
      AND status = 'paid';

  IF NOT FOUND OR v_paid_amount = 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'payment_not_paid',
      'total_paid', 0,
      'total_refunded', 0,
      'refundable', 0
    );
  END IF;

  SELECT COALESCE(SUM(refund_amount_kzt), 0)
    INTO v_refunded_amount
    FROM public.refund_transactions
    WHERE payment_transaction_id = p_payment_transaction_id
      AND status = 'succeeded';

  RETURN jsonb_build_object(
    'ok', true,
    'total_paid', v_paid_amount,
    'total_refunded', v_refunded_amount,
    'refundable', GREATEST(0, v_paid_amount - v_refunded_amount)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_refundable_amount FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_refundable_amount FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_refundable_amount FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_refundable_amount TO service_role;

ALTER TABLE public.refund_transactions ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 0019: pricing_versions + initial seed
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.pricing_versions (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                        text NOT NULL UNIQUE,
  status                      text NOT NULL CHECK (status IN ('draft','active','archived')),
  currency                    text NOT NULL DEFAULT 'KZT',
  internal_fx_rate            numeric(12,4),
  mrp_value                   numeric(12,2),
  tax_rate                    numeric(8,4) NOT NULL DEFAULT 0.03,
  acquiring_rate              numeric(8,4) NOT NULL DEFAULT 0.025,
  risk_reserve_rate           numeric(8,4) NOT NULL DEFAULT 0.05,
  owner_reserve_rate          numeric(8,4) NOT NULL DEFAULT 0.07,
  marketing_rate_direct       numeric(8,4) NOT NULL DEFAULT 0.10,
  partner_commission_rate     numeric(8,4) NOT NULL DEFAULT 0.10,
  target_profit_rate          numeric(8,4) NOT NULL DEFAULT 0.25,
  ai_it_reserve_per_page_kzt  numeric(12,2) NOT NULL DEFAULT 100,
  valid_from                  timestamptz NOT NULL DEFAULT now(),
  valid_to                    timestamptz,
  metadata                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pricing_versions_active
  ON public.pricing_versions (status, valid_from)
  WHERE status = 'active';

ALTER TABLE public.pricing_versions ENABLE ROW LEVEL SECURITY;

INSERT INTO public.pricing_versions (
  code, status, currency,
  internal_fx_rate, mrp_value,
  tax_rate, acquiring_rate, risk_reserve_rate, owner_reserve_rate,
  marketing_rate_direct, partner_commission_rate, target_profit_rate,
  ai_it_reserve_per_page_kzt, valid_from, metadata
) VALUES (
  '2026-Q3-KZ-MVP', 'active', 'KZT',
  510.0000, 3.69,
  0.03, 0.025, 0.05, 0.07,
  0.10, 0.10, 0.25,
  100.00, now(),
  jsonb_build_object(
    'note', 'Initial MVP pricing version. All rates are preliminary estimates.',
    'confirmations_required', jsonb_build_array(
      'Accountant to confirm tax/VAT rate (currently 3% placeholder)',
      'Accountant to confirm acquiring rate with Halyk Bank contract',
      'Notary to confirm MRP value and coefficient before notarized production orders',
      'Legal to confirm refund policy cases',
      'Translators to confirm purchase prices before official/notarized launch'
    )
  )
) ON CONFLICT (code) DO NOTHING;

-- =============================================================================
-- 0020: price_quotes
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.price_quotes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  document_id           uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  user_id               uuid REFERENCES public.users(id) ON DELETE SET NULL,
  pricing_version_id    uuid REFERENCES public.pricing_versions(id),
  status                text NOT NULL CHECK (status IN (
    'draft','quoted','expired','payment_pending','paid',
    'canceled','refunded','requires_operator_review'
  )),
  amount_kzt            numeric(12,2) NOT NULL CHECK (amount_kzt >= 0),
  currency              text NOT NULL DEFAULT 'KZT',
  quoted_at             timestamptz NOT NULL DEFAULT now(),
  expires_at            timestamptz NOT NULL,
  accepted_at           timestamptz,
  price_locked_at       timestamptz,
  paid_at               timestamptz,
  source_word_count     integer,
  physical_page_count   integer,
  included_word_count   integer NOT NULL DEFAULT 250,
  included_page_count   integer NOT NULL DEFAULT 1,
  source_language       text,
  target_language       text,
  language_pair         text,
  document_type         text,
  service_level         text,
  urgency_level         text NOT NULL DEFAULT 'standard',
  fulfillment_method    text,
  notary_city           text,
  delivery_required     boolean NOT NULL DEFAULT false,
  partner_id            uuid,
  sales_channel         text NOT NULL DEFAULT 'direct',
  pricing_context_json  jsonb NOT NULL DEFAULT '{}'::jsonb,
  breakdown_json        jsonb NOT NULL DEFAULT '{}'::jsonb,
  internal_cost_json    jsonb NOT NULL DEFAULT '{}'::jsonb,
  margin_json           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_quotes_job_id       ON public.price_quotes (job_id);
CREATE INDEX IF NOT EXISTS idx_price_quotes_document_id  ON public.price_quotes (document_id);
CREATE INDEX IF NOT EXISTS idx_price_quotes_user_id      ON public.price_quotes (user_id);
CREATE INDEX IF NOT EXISTS idx_price_quotes_status       ON public.price_quotes (status, expires_at);
CREATE INDEX IF NOT EXISTS idx_price_quotes_pricing_version ON public.price_quotes (pricing_version_id);

ALTER TABLE public.price_quotes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "price_quotes_select_own" ON public.price_quotes;
CREATE POLICY "price_quotes_select_own"
  ON public.price_quotes FOR SELECT
  USING (auth.uid() = user_id);

-- =============================================================================
-- 0021: price_quote_items
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.price_quote_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id          uuid NOT NULL REFERENCES public.price_quotes(id) ON DELETE CASCADE,
  item_type         text NOT NULL,
  label             text NOT NULL,
  quantity          numeric(12,3) NOT NULL DEFAULT 1,
  unit_price_kzt    numeric(12,2),
  amount_kzt        numeric(12,2) NOT NULL,
  is_client_visible boolean NOT NULL DEFAULT true,
  is_cost           boolean NOT NULL DEFAULT false,
  sort_order        integer NOT NULL DEFAULT 0,
  metadata_json     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_quote_items_quote_id
  ON public.price_quote_items (quote_id, sort_order);

ALTER TABLE public.price_quote_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "price_quote_items_select_via_quote" ON public.price_quote_items;
CREATE POLICY "price_quote_items_select_via_quote"
  ON public.price_quote_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.price_quotes q
      WHERE q.id = quote_id AND q.user_id = auth.uid()
    )
  );

-- =============================================================================
-- 0022: cost_reservations
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.cost_reservations (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id                uuid REFERENCES public.price_quotes(id) ON DELETE CASCADE,
  job_id                  uuid REFERENCES public.jobs(id) ON DELETE CASCADE,
  payment_transaction_id  uuid REFERENCES public.payment_transactions(id) ON DELETE SET NULL,
  cost_type               text NOT NULL,
  amount_kzt              numeric(12,2) NOT NULL CHECK (amount_kzt >= 0),
  status                  text NOT NULL CHECK (status IN ('reserved','committed','paid','canceled','adjusted')),
  payable_to_type         text,
  payable_to_id           uuid,
  notes                   text,
  metadata_json           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cost_reservations_quote_id  ON public.cost_reservations (quote_id);
CREATE INDEX IF NOT EXISTS idx_cost_reservations_job_id    ON public.cost_reservations (job_id);
CREATE INDEX IF NOT EXISTS idx_cost_reservations_status    ON public.cost_reservations (status, cost_type);

ALTER TABLE public.cost_reservations ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 0023: extend payment_transactions + refund_transactions with quote linkage
-- =============================================================================

ALTER TABLE public.payment_transactions
  ADD COLUMN IF NOT EXISTS quote_id              uuid REFERENCES public.price_quotes(id),
  ADD COLUMN IF NOT EXISTS price_locked_at       timestamptz,
  ADD COLUMN IF NOT EXISTS amount_source         text CHECK (amount_source IN ('quote','manual_admin','legacy_test')),
  ADD COLUMN IF NOT EXISTS pricing_snapshot_json jsonb DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_payment_transactions_quote_id
  ON public.payment_transactions (quote_id)
  WHERE quote_id IS NOT NULL;

ALTER TABLE public.refund_transactions
  ADD COLUMN IF NOT EXISTS quote_id                         uuid REFERENCES public.price_quotes(id),
  ADD COLUMN IF NOT EXISTS refund_policy_case               text,
  ADD COLUMN IF NOT EXISTS remaining_refundable_before_kzt  numeric(12,2),
  ADD COLUMN IF NOT EXISTS remaining_refundable_after_kzt   numeric(12,2),
  ADD COLUMN IF NOT EXISTS approval_status                  text CHECK (approval_status IN ('not_required','pending','approved','rejected')),
  ADD COLUMN IF NOT EXISTS approved_by                      uuid,
  ADD COLUMN IF NOT EXISTS approved_at                      timestamptz;

-- =============================================================================
-- 0024: jobs.customer_comment
-- =============================================================================

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS customer_comment text;

-- =============================================================================
-- 0025: jobs finance/jira columns
-- =============================================================================

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS finance_jira_issue_id    text,
  ADD COLUMN IF NOT EXISTS finance_jira_issue_key   text,
  ADD COLUMN IF NOT EXISTS finance_jira_issue_url   text,
  ADD COLUMN IF NOT EXISTS finance_jira_sync_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS finance_jira_last_error  text,
  ADD COLUMN IF NOT EXISTS finance_jira_synced_at   timestamptz;

CREATE INDEX IF NOT EXISTS jobs_finance_jira_key_idx
  ON public.jobs (finance_jira_issue_key)
  WHERE finance_jira_issue_key IS NOT NULL;

-- =============================================================================
-- 0026: create_subscription_job RPC
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_subscription_job(
  p_document_id           UUID,
  p_user_id               UUID,
  p_filename              TEXT,
  p_original_file_size    BIGINT,
  p_file_key              TEXT,
  p_source_language       TEXT,
  p_target_language       TEXT,
  p_document_type         TEXT,
  p_ip_address            TEXT,
  p_subscription_id       UUID,
  p_documents_limit       INT,
  p_priority              INT,
  p_notarized             BOOLEAN,
  p_service_level         TEXT,
  p_notary_city           TEXT,
  p_fulfillment_method    TEXT,
  p_delivery_phone        TEXT,
  p_delivery_address      TEXT,
  p_actor                 TEXT,
  p_audit_metadata        JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_used INT;
  v_job_id       UUID;
BEGIN
  SELECT documents_used INTO v_current_used
  FROM public.subscriptions
  WHERE id = p_subscription_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'subscription_not_found');
  END IF;

  IF v_current_used >= p_documents_limit THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'over_quota');
  END IF;

  INSERT INTO public.documents (
    id, user_id, filename, original_file_size, file_key,
    source_language, target_language, document_type, status, ip_address
  ) VALUES (
    p_document_id, p_user_id, p_filename, p_original_file_size, p_file_key,
    p_source_language, p_target_language, p_document_type, 'processing', p_ip_address
  );

  UPDATE public.subscriptions
  SET documents_used = documents_used + 1, updated_at = now()
  WHERE id = p_subscription_id;

  INSERT INTO public.jobs (
    document_id, status, progress_percent, priority, payment_source,
    notarized, service_level, notary_city, fulfillment_method, delivery_phone, delivery_address
  ) VALUES (
    p_document_id, 'queued', 0, p_priority, 'subscription',
    p_notarized, p_service_level, p_notary_city, p_fulfillment_method, p_delivery_phone, p_delivery_address
  )
  RETURNING id INTO v_job_id;

  INSERT INTO public.job_audit_log (job_id, actor, source, action, new_status, metadata)
  VALUES (v_job_id, p_actor, 'upload', 'job_created', 'queued', p_audit_metadata);

  RETURN jsonb_build_object(
    'ok', true,
    'document_id', p_document_id::TEXT,
    'job_id', v_job_id::TEXT
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_subscription_job FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_subscription_job FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_subscription_job FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_subscription_job TO service_role;

COMMIT;

-- =============================================================================
-- POST-MIGRATION: reload PostgREST schema cache
-- Run this separately AFTER the COMMIT above succeeds:
-- =============================================================================
-- NOTIFY pgrst, 'reload schema';
-- =============================================================================
-- STEP 2: VERIFY — run after commit to confirm all objects exist
-- =============================================================================
-- SELECT
--   to_regclass('public.fiscal_receipts')      AS fiscal_receipts,
--   to_regclass('public.refund_transactions')  AS refund_transactions,
--   to_regclass('public.pricing_versions')     AS pricing_versions,
--   to_regclass('public.price_quotes')         AS price_quotes,
--   to_regclass('public.price_quote_items')    AS price_quote_items,
--   to_regclass('public.cost_reservations')    AS cost_reservations;
--
-- SELECT count(*) AS active_pricing_versions
-- FROM public.pricing_versions WHERE status = 'active';
--
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'payment_transactions'
--   AND column_name IN ('quote_id','price_locked_at','amount_source','pricing_snapshot_json');
--
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'jobs'
--   AND column_name IN ('customer_comment','finance_jira_issue_key');
--
-- SELECT proname FROM pg_proc
-- WHERE proname IN ('get_refundable_amount','create_subscription_job');
