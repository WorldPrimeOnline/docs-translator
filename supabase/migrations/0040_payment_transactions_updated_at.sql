-- Migration 0040: Add updated_at to payment_transactions
-- This column was missing from the original schema (payment_transactions was
-- renamed from ton_payments which only had created_at).
-- The finalize_halyk_payment RPC and all update paths reference updated_at.
-- Missing column caused Payment 2 finalization to fail in production (2026-06-30).
-- Safe: IF NOT EXISTS is idempotent; existing rows get NULL which is fine for history.

ALTER TABLE public.payment_transactions
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

COMMENT ON COLUMN public.payment_transactions.updated_at IS
  'Timestamp of the most recent status update. NULL for historical rows created before this migration.';

-- Backfill: set updated_at = created_at for historical rows to avoid NULL confusion
UPDATE public.payment_transactions
   SET updated_at = created_at
 WHERE updated_at IS NULL;

-- Index for refund reconciliation: find recently-paid transactions efficiently
CREATE INDEX IF NOT EXISTS idx_payment_transactions_paid_refund_check
  ON public.payment_transactions (paid_at, refunded_at, payment_provider)
  WHERE status = 'paid' AND refunded_at IS NULL;
