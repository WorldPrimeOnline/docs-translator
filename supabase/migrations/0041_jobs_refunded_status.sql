-- Migration 0041: Add refunded and canceled to jobs.status constraint
-- Required for refund reconciliation: when Halyk confirms a refund for a paid job,
-- we must be able to set jobs.status = 'refunded' without violating the constraint.
-- Also adds 'canceled' for operator-canceled orders.

-- Drop and recreate the status constraint to include the new values.
-- All existing jobs retain their current status — no data modification.
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_status_check;

ALTER TABLE public.jobs ADD CONSTRAINT jobs_status_check
  CHECK (status IN (
    'payment_pending',
    'queued', 'ocr_in_progress', 'ocr_completed',
    'translation_in_progress', 'pdf_rendering',
    'completed', 'failed',
    'refunded', 'canceled'
  ));

COMMENT ON COLUMN public.jobs.status IS
  'Processing lifecycle status. refunded: payment was refunded after successful charge. canceled: order was canceled before processing.';

-- Index to find refunded jobs for dashboard queries
CREATE INDEX IF NOT EXISTS idx_jobs_status_refunded
  ON public.jobs (status, created_at)
  WHERE status IN ('refunded', 'canceled');
