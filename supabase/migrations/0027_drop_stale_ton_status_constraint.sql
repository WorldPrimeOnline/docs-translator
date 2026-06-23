-- Migration 0027: Drop stale ton_payments_status_check constraint
--
-- When migration 0008 renamed ton_payments → payment_transactions, PostgreSQL
-- kept the original constraint name. Migration 0015 then dropped
-- "payment_transactions_status_check" (IF EXISTS — silent no-op because the
-- constraint was still named "ton_payments_status_check") and added a new
-- "payment_transactions_status_check" with Halyk statuses.
--
-- Result on production: two status constraints coexist:
--   ton_payments_status_check       → only ('pending','completed','expired')
--   payment_transactions_status_check → full Halyk set incl. 'payment_pending'
--
-- INSERT with status='payment_pending' passes the new constraint but violates
-- the stale one → error 23514.
--
-- Fix: drop the stale artifact. The correct constraint (payment_transactions_status_check)
-- already exists and covers all valid statuses. No data is changed.

ALTER TABLE public.payment_transactions
  DROP CONSTRAINT IF EXISTS ton_payments_status_check;
