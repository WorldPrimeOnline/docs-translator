-- Migration 0023: Extend payment_transactions and refund_transactions
-- Adds quote linkage, amount source tracking, and refund policy fields.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Extend payment_transactions
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.payment_transactions
  ADD COLUMN IF NOT EXISTS quote_id               uuid REFERENCES public.price_quotes(id),
  ADD COLUMN IF NOT EXISTS price_locked_at        timestamptz,
  ADD COLUMN IF NOT EXISTS amount_source          text CHECK (amount_source IN ('quote','manual_admin','legacy_test')),
  ADD COLUMN IF NOT EXISTS pricing_snapshot_json  jsonb DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.payment_transactions.quote_id IS
  'FK to price_quotes. When set, payment amount must equal price_quotes.amount_kzt.';
COMMENT ON COLUMN public.payment_transactions.amount_source IS
  'quote = sourced from price_quotes (production path); legacy_test = old fixed price; manual_admin = operator override.';
COMMENT ON COLUMN public.payment_transactions.pricing_snapshot_json IS
  'Snapshot of quote context at payment initiation for audit/dispute purposes.';

CREATE INDEX IF NOT EXISTS idx_payment_transactions_quote_id
  ON public.payment_transactions (quote_id)
  WHERE quote_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Extend refund_transactions
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.refund_transactions
  ADD COLUMN IF NOT EXISTS quote_id                         uuid REFERENCES public.price_quotes(id),
  ADD COLUMN IF NOT EXISTS refund_policy_case               text,
  ADD COLUMN IF NOT EXISTS remaining_refundable_before_kzt  numeric(12,2),
  ADD COLUMN IF NOT EXISTS remaining_refundable_after_kzt   numeric(12,2),
  ADD COLUMN IF NOT EXISTS approval_status                  text CHECK (approval_status IN ('not_required','pending','approved','rejected')),
  ADD COLUMN IF NOT EXISTS approved_by                      uuid,
  ADD COLUMN IF NOT EXISTS approved_at                      timestamptz;

COMMENT ON COLUMN public.refund_transactions.refund_policy_case IS
  'Policy case from refund-policy engine: paid_before_processing | processing_started | translator_assigned | notary_started | delivered | duplicate_charge | exception_only';
COMMENT ON COLUMN public.refund_transactions.approval_status IS
  'not_required: auto-refund allowed; pending: awaiting operator; approved/rejected: operator decision.';
