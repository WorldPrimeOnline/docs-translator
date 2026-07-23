-- Migration 0066: metadata-preserving retention purge markers
--
-- 2026-07-24 fix: the previous 30-day cleanup cron (src/app/api/cron/cleanup/route.ts)
-- deleted the ENTIRE `documents` row (intending a CASCADE to jobs/translations/
-- ocr_results). In practice this already silently failed for any order with a
-- fiscal_receipts or refund_transactions row: those tables reference jobs/documents/
-- payment_transactions with NO `ON DELETE` clause (default NO ACTION/RESTRICT in
-- Postgres — confirmed by reading every migration touching these tables; no ALTER
-- TABLE anywhere added an explicit ON DELETE), so cascading the documents delete
-- through jobs into a fiscalized job's row was always rejected by the FK constraint.
-- The cron's own code only recorded that failure in a response `errors[]` array and
-- moved on — it never surfaced anywhere. Worse: the R2 object deletes (original file,
-- translated PDF) ran BEFORE that failing row-delete attempt and are NOT transactional
-- with it, so for every paid/fiscalized order past 30 days, the R2 files were already
-- being deleted while the documents/jobs/translations rows silently survived with now-
-- dead R2 keys — a live, previously-unnoticed bug (broken downloads, no expiry message).
--
-- New model: never delete documents/jobs/price_quotes/price_quote_items/
-- payment_transactions/fiscal_receipts/refund_transactions/cost_reservations rows at
-- retention time. Only ever delete R2 objects (source/result files) and the
-- job_source_files/job_result_files rows that reference them (removing the customer/
-- staff-supplied original filenames along with the dead references), then mark the
-- document as purged. These two nullable timestamp columns are the sole new state:
-- purely additive, no FK/cascade change, safe to apply and safe to roll back (drop
-- the columns) without any data loss.

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS files_purged_at timestamptz,
  ADD COLUMN IF NOT EXISTS drive_purged_at timestamptz;

COMMENT ON COLUMN public.documents.files_purged_at IS
  'Set once the 30-day retention cleanup has deleted this document''s R2 objects (original + translated/result files) and removed its job_source_files/job_result_files rows. NULL until then. This is the sole authoritative signal for "retention period expired" — never inferred purely from created_at + 30 days, since the daily cron may run later than exactly 30 days, or be paused. documents/jobs/price_quotes/payment_transactions/fiscal_receipts/refund_transactions rows are NEVER deleted by retention cleanup; only this marker + the underlying files are affected.';
COMMENT ON COLUMN public.documents.drive_purged_at IS
  'Set once the associated Jira/Drive order folder has been trashed by retention cleanup (best-effort, independent of files_purged_at — a Drive failure must never block or be blocked by the R2/DB purge). NULL until then, or permanently NULL for jobs with no google_drive_folder_id (Electronic orders never create one).';
