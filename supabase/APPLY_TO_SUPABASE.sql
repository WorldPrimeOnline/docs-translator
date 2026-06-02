-- ═══════════════════════════════════════════════════════════════════════════════
-- WPO Translations — Consolidated Payment Schema Migration
-- Apply via: Supabase Dashboard → SQL Editor → paste & run
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS SCRIPT DOES
-- ─────────────────────
-- 1. Renames ton_payments → payment_transactions
-- 2. Drops all crypto/TON-specific columns (amount_nanoton, ton_price_usd,
--    wallet_address) from payment_transactions
-- 3. Renames amount_usd → amount, tx_hash → provider_transaction_id
-- 4. Adds currency, payment_provider columns
-- 5. Updates subscriptions table: same column renames + drops
-- 6. Updates jobs.payment_source constraint: removes 'ton_payment', adds 'card_payment'
-- 7. Drops wallet_links table (unused, crypto-specific)
-- 8. Adds ip_address to documents and payment_transactions
--
-- ASSUMPTION — PLEASE VERIFY BEFORE RUNNING
-- ─────────────────────────────────────────────────────────────────────────────
-- This script drops columns. Those dropped columns are UNRECOVERABLE.
-- The script assumes all three tables below are empty or contain data
-- that you do not need to preserve (TON payment API routes were removed).
--
-- Run these three queries FIRST in a separate SQL Editor tab to verify:
--
--   SELECT COUNT(*) AS ton_payments_rows   FROM public.ton_payments;
--   SELECT COUNT(*) AS wallet_links_rows   FROM public.wallet_links;
--   SELECT COUNT(*) AS ton_jobs            FROM public.jobs WHERE payment_source = 'ton_payment';
--
-- Expected safe values: all three return 0.
-- If ton_payments has rows, export them first (Table Editor → Export CSV).
--
-- BACKUP RECOMMENDATION
-- ─────────────────────
-- Before running, export these tables from Supabase Table Editor → Export:
--   • ton_payments   (may be empty)
--   • subscriptions  (may have real rows — column renames only, no drops of live data)
--   • jobs           (column constraint update only)
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- SAFETY GUARD
-- Aborts the whole transaction if tables have unexpected data.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  ton_rows   BIGINT;
  wallet_rows BIGINT;
  ton_jobs   BIGINT;
BEGIN
  SELECT COUNT(*) INTO ton_rows   FROM public.ton_payments;
  SELECT COUNT(*) INTO wallet_rows FROM public.wallet_links;
  SELECT COUNT(*) INTO ton_jobs   FROM public.jobs WHERE payment_source = 'ton_payment';

  IF ton_rows > 0 THEN
    RAISE EXCEPTION
      'ABORT: ton_payments contains % row(s). Export this data before running the migration.',
      ton_rows;
  END IF;

  IF wallet_rows > 0 THEN
    RAISE EXCEPTION
      'ABORT: wallet_links contains % row(s). Review before dropping the table.',
      wallet_rows;
  END IF;

  IF ton_jobs > 0 THEN
    RAISE EXCEPTION
      'ABORT: jobs table has % row(s) with payment_source = ''ton_payment''. '
      'Resolve these jobs before removing ton_payment from the constraint.',
      ton_jobs;
  END IF;

  RAISE NOTICE 'Safety checks passed — proceeding with migration.';
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1: Rename table ton_payments → payment_transactions
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.ton_payments RENAME TO payment_transactions;


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2: Drop crypto/TON-specific columns (destructive — verified empty above)
-- ─────────────────────────────────────────────────────────────────────────────

-- amount_nanoton: nano-TON unit, meaningless for card payments
ALTER TABLE public.payment_transactions DROP COLUMN IF EXISTS amount_nanoton;

-- ton_price_usd: TON/USD exchange rate, not needed for KZT card payments
ALTER TABLE public.payment_transactions DROP COLUMN IF EXISTS ton_price_usd;

-- wallet_address: TON crypto wallet, no use case for card payments
ALTER TABLE public.payment_transactions DROP COLUMN IF EXISTS wallet_address;


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3: Rename columns to neutral names
-- ─────────────────────────────────────────────────────────────────────────────

-- amount_usd → amount  (primary payment amount in the transaction currency)
ALTER TABLE public.payment_transactions RENAME COLUMN amount_usd TO amount;

-- tx_hash → provider_transaction_id  (generic reference to the provider's transaction)
ALTER TABLE public.payment_transactions RENAME COLUMN tx_hash TO provider_transaction_id;


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 4: Add new generic columns
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.payment_transactions
  ADD COLUMN IF NOT EXISTS currency         TEXT NOT NULL DEFAULT 'KZT',
  ADD COLUMN IF NOT EXISTS payment_provider TEXT NOT NULL DEFAULT 'halyk_epay';


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 5: Rebuild RLS policies under new table name
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "ton_payments_select_own" ON public.payment_transactions;
DROP POLICY IF EXISTS "ton_payments_insert_own" ON public.payment_transactions;

CREATE POLICY "payment_transactions_select_own"
  ON public.payment_transactions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "payment_transactions_insert_own"
  ON public.payment_transactions FOR INSERT
  WITH CHECK (auth.uid() = user_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 6: Rebuild indexes under new names
-- ─────────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS public.idx_ton_payments_job_id;
DROP INDEX IF EXISTS public.idx_ton_payments_user_id;

CREATE INDEX IF NOT EXISTS idx_payment_transactions_job_id
  ON public.payment_transactions (job_id);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_user_id
  ON public.payment_transactions (user_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 7: Drop wallet_links table (unused, crypto-wallet specific)
-- ─────────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS public.wallet_links;


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 8: Update subscriptions table
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop crypto-specific columns
ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS amount_nanoton;
ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS ton_price_usd;

-- Rename remaining columns to neutral names
ALTER TABLE public.subscriptions RENAME COLUMN amount_usd TO amount;
ALTER TABLE public.subscriptions RENAME COLUMN tx_hash    TO provider_transaction_id;


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 9: Update payment_source constraint on jobs table
-- Removes 'ton_payment'; adds 'card_payment'.
-- Safe only if the guard above confirmed zero ton_payment rows.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_payment_source_check;

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_payment_source_check
  CHECK (payment_source IN ('card_payment', 'subscription'));


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 10: Add ip_address columns for fraud prevention and chargeback evidence
-- Disclosed in Privacy Policy and Personal Data Consent.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS ip_address TEXT;

ALTER TABLE public.payment_transactions
  ADD COLUMN IF NOT EXISTS ip_address TEXT;

COMMENT ON COLUMN public.documents.ip_address IS
  'Client IP at upload time — fraud prevention and dispute/chargeback handling only. Not exposed to users.';

COMMENT ON COLUMN public.payment_transactions.ip_address IS
  'Client IP at payment creation — fraud prevention and dispute/chargeback handling only. Not exposed to users.';


COMMIT;


-- ═══════════════════════════════════════════════════════════════════════════════
-- VERIFICATION QUERIES — run after the migration completes
-- Paste these in a new SQL Editor tab (do not include in the main migration run).
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. payment_transactions table exists
SELECT 'payment_transactions exists' AS check,
  EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'payment_transactions'
  ) AS result;

-- 2. ton_payments table is gone
SELECT 'ton_payments removed' AS check,
  NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'ton_payments'
  ) AS result;

-- 3. wallet_links table is gone
SELECT 'wallet_links removed' AS check,
  NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'wallet_links'
  ) AS result;

-- 4. documents.ip_address exists
SELECT 'documents.ip_address exists' AS check,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'documents' AND column_name = 'ip_address'
  ) AS result;

-- 5. payment_transactions.ip_address exists
SELECT 'payment_transactions.ip_address exists' AS check,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payment_transactions' AND column_name = 'ip_address'
  ) AS result;

-- 6. No crypto/TON column names remain anywhere in public schema
SELECT 'No crypto column names remain' AS check,
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name IN (
        'amount_nanoton', 'ton_price_usd', 'tx_hash',
        'wallet_address', 'legacy_wallet_address', 'amount_usd'
      )
  ) AS result;

-- 7. payment_transactions final column list (eyeball check)
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'payment_transactions'
ORDER BY ordinal_position;

-- 8. subscriptions final column list (eyeball check)
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'subscriptions'
ORDER BY ordinal_position;

-- 9. jobs.payment_source constraint — must show only card_payment and subscription
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.jobs'::regclass AND contype = 'c';
