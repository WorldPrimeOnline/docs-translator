-- Migration 0008: Remove crypto/TON naming from payment schema
-- Safe renames — no data is dropped.
-- Run AFTER ensuring no in-flight TON jobs exist (drain the queue first).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Rename ton_payments → payment_transactions
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.ton_payments RENAME TO payment_transactions;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Rename crypto-specific columns to generic names
-- ─────────────────────────────────────────────────────────────────────────────
-- amount_nanoton: raw amount in the original payment unit (nano-TON historically,
-- will be KZT tiyn for card payments going forward)
ALTER TABLE public.payment_transactions
  RENAME COLUMN amount_nanoton TO amount_raw;

-- amount_usd: keep as-is (historical USD equivalent at time of payment)

-- ton_price_usd → exchange_rate_usd: the exchange rate used at payment time
ALTER TABLE public.payment_transactions
  RENAME COLUMN ton_price_usd TO exchange_rate_usd;

-- tx_hash → provider_transaction_id: generic transaction reference
ALTER TABLE public.payment_transactions
  RENAME COLUMN tx_hash TO provider_transaction_id;

-- wallet_address: TON-specific, preserved as legacy field for historical records
ALTER TABLE public.payment_transactions
  RENAME COLUMN wallet_address TO legacy_wallet_address;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Add generic payment metadata columns
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.payment_transactions
  ADD COLUMN IF NOT EXISTS currency_code TEXT NOT NULL DEFAULT 'KZT',
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'halyk_epay';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Rebuild RLS policies with new names
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
-- 5. Rebuild indexes with new names
-- ─────────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS idx_ton_payments_job_id;
DROP INDEX IF EXISTS idx_ton_payments_user_id;

CREATE INDEX IF NOT EXISTS idx_payment_transactions_job_id
  ON public.payment_transactions (job_id);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_user_id
  ON public.payment_transactions (user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Update subscriptions: rename crypto-specific columns
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.subscriptions
  RENAME COLUMN amount_nanoton TO amount_raw;

ALTER TABLE public.subscriptions
  RENAME COLUMN ton_price_usd TO exchange_rate_usd;

ALTER TABLE public.subscriptions
  RENAME COLUMN tx_hash TO provider_transaction_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Extend payment_source constraint to include 'card_payment'
-- ─────────────────────────────────────────────────────────────────────────────
-- Keep 'ton_payment' in the allowed values so existing rows are not invalidated.
-- After all historical records are migrated, 'ton_payment' can be removed.
ALTER TABLE public.jobs
  DROP CONSTRAINT IF EXISTS jobs_payment_source_check;

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_payment_source_check
  CHECK (payment_source IN ('card_payment', 'subscription', 'ton_payment'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Drop wallet_links table (no API routes use it; crypto-wallet specific)
-- ─────────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS public.wallet_links;
