-- Migration 0016: Fix jobs.payment_source CHECK constraint
--
-- Context: Migration 0008 added 'card_payment' to jobs_payment_source_check,
-- but the staging DB still enforces only ('ton_payment', 'subscription')
-- causing insert failures for card payment jobs.
--
-- This migration is idempotent: DROP IF EXISTS + unconditional ADD.
-- Existing rows are unaffected (they only contain 'subscription' or NULL).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Fix payment_source constraint
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.jobs
  DROP CONSTRAINT IF EXISTS jobs_payment_source_check;

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_payment_source_check
  CHECK (
    payment_source IS NULL
    OR payment_source IN ('subscription', 'card_payment')
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Ensure payment_pending is in the status constraint
--    (added by 0015, but re-applied here as a safety net in case 0015's
--     status block was not committed on this DB instance)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.jobs
  DROP CONSTRAINT IF EXISTS jobs_status_check;

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_status_check
  CHECK (status IN (
    'payment_pending',
    'queued',
    'ocr_in_progress',
    'ocr_completed',
    'translation_in_progress',
    'pdf_rendering',
    'completed',
    'failed'
  ));
