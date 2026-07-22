-- Migration 0063: job_source_files, job_result_files
--
-- 2026-07-31 decision: multi-file orders no longer require strict "one source -> one
-- final file". Each customer-uploaded file gets a stable, upload-order sequence (1-based)
-- that survives through Drive naming, per-source AI drafts, and translator/notary
-- grouping. See docs/ai-context/DECISIONS.md for the full design writeup.
--
-- job_source_files: one row per ORIGINAL uploaded file (before any merge). Populated at
-- convertDraftToOrder() time, from order_drafts.file_keys[0].sourceUploadIds — never at
-- draft/upload time itself (no job exists yet then). sequence is assigned strictly by
-- client upload order, never by filename/Drive createdTime/API order.
CREATE TABLE IF NOT EXISTS public.job_source_files (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  sequence              integer NOT NULL CHECK (sequence >= 1),
  original_filename     text NOT NULL,
  r2_key                text NOT NULL,
  content_sha256        text NOT NULL,
  mime_type             text NOT NULL,
  physical_page_count   integer,
  -- Nullable only for the legacy pre-0063-draft synthesized fallback row (see
  -- insertJobSourceFiles' strict/non-strict split) — every row created by a real upload
  -- flow always populates this. The worker's OCR step reads THIS key, never r2_key
  -- directly, since r2_key holds the original bytes (jpg/png/docx/pdf) for Drive
  -- display/dedup, and OCR (extractTextFromPdf) only accepts a PDF buffer. Populated by
  -- the same convertToPdf() call the web app already runs per-source before merging —
  -- no PDF-conversion logic is duplicated into the worker.
  converted_pdf_r2_key  text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, sequence)
);

COMMENT ON TABLE public.job_source_files IS
  'One row per original customer-uploaded file (pre-merge), in stable upload order. r2_key is a PERMANENT per-source object (never the temp raw-upload key, which is deleted after this row is created) — subject to the same 30-day document retention policy as everything else, not indefinite storage.';
COMMENT ON COLUMN public.job_source_files.sequence IS
  '1-based, assigned strictly by client upload order at draft/upload time. Never derived from filename, Drive createdTime, or any API listing order.';

CREATE INDEX IF NOT EXISTS idx_job_source_files_job_id ON public.job_source_files (job_id, sequence);

ALTER TABLE public.job_source_files ENABLE ROW LEVEL SECURITY;
-- Service-role only — no policies, matching document_analysis/order_drafts/cost_reservations.

-- job_result_files: one row per PRODUCED artifact at any pipeline stage, for one or more
-- source sequences (many-to-one). Only translator/notary-uploaded artifacts read back
-- from Drive are candidates for stage in ('translator_result','signature_stamp','notary',
-- 'final') — those rows are created/updated ONLY after a successful Drive read-back sync
-- (never expose a Drive link directly; r2_key is always the re-hosted copy the customer's
-- download route actually serves from).
--
-- 2026-08-01 correction: idempotency requirements added before any worker/Drive-sync code
-- is written, so AI-draft creation and Drive read-back are upsert-safe from day one —
-- status/updated_at/last_error track sync state per row, and the two unique indexes below
-- are the actual conflict targets an ON CONFLICT upsert uses (never a blind INSERT).
CREATE TABLE IF NOT EXISTS public.job_result_files (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id            uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  stage             text NOT NULL CHECK (stage IN (
                      'ai_draft',
                      'electronic_final_pdf',
                      'electronic_final_docx',
                      'electronic_final_html',
                      'translator_result',
                      'signature_stamp',
                      'notary',
                      'final'
                    )),
  source_sequences  integer[] NOT NULL CHECK (array_length(source_sequences, 1) > 0),
  drive_file_id     text,
  filename          text NOT NULL,
  r2_key            text,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed')),
  last_error        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- The upsert conflict target: the same logical artifact slot (this stage, covering
  -- exactly these source sequences, for this job) must UPDATE in place — e.g. staff
  -- replaces a file in Drive with a corrected version, or a retry re-renders the same
  -- AI draft — never insert a second row for the same slot.
  UNIQUE (job_id, stage, source_sequences)
);

COMMENT ON TABLE public.job_result_files IS
  'One row per produced artifact at any stage, mapping to one or more job_source_files.sequence values (many-to-one grouping — e.g. 10 source photos -> 1 signed PDF covering source_sequences [1..10]). r2_key is null until a Drive-read-back artifact has been durably re-hosted in R2; the customer download route never serves drive_file_id/a Drive link directly. Never insert directly — always upsert on (job_id, stage, source_sequences) so retries/re-syncs update the existing row instead of duplicating it.';
COMMENT ON COLUMN public.job_result_files.stage IS
  'ai_draft: automatic worker output, official/notary only, NEVER the customer-facing final. electronic_final_*: the automatic worker output IS the final deliverable for electronic jobs (never labeled ai_draft). translator_result/signature_stamp/notary/final: human-produced artifacts synced back from Drive after the corresponding Jira status is reached.';
COMMENT ON COLUMN public.job_result_files.source_sequences IS
  'Structured cross-check for the numeric prefix/range parsed from the Drive filename (e.g. "004-010_Part2.pdf" -> [4,5,6,7,8,9,10]) — the filename is authoritative for customer-facing ordering; this column is the sync job''s parsed record of the same fact, used for the download route''s ordering/grouping without re-parsing filenames. Full-coverage/no-overlap validation against job_source_files happens in application code (worker), not a DB constraint, since it is a cross-table invariant.';
COMMENT ON COLUMN public.job_result_files.status IS
  'pending: row created but the artifact is not yet confirmed durable (e.g. a Drive sync that has not completed). ready: artifact confirmed present at r2_key — the ONLY status the customer download route and job-completion logic may act on. failed: last sync/render attempt failed; see last_error. A customer must never be given a file, and an order must never complete, from a row that is not status=''ready''.';
COMMENT ON COLUMN public.job_result_files.last_error IS
  'Most recent sync/render failure reason for this row, for the retry/reconciler and ops visibility. Cleared (set NULL) on the next successful upsert.';

CREATE INDEX IF NOT EXISTS idx_job_result_files_job_id ON public.job_result_files (job_id, stage);
CREATE INDEX IF NOT EXISTS idx_job_result_files_pending_failed ON public.job_result_files (status, updated_at) WHERE status IN ('pending', 'failed');

-- A given Drive file must back at most one job_result_files row — prevents the sync job
-- from ever creating two rows for the same Drive artifact (e.g. a re-run that fails to
-- match the (job_id, stage, source_sequences) upsert target for some other reason).
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_result_files_drive_file_id
  ON public.job_result_files (job_id, drive_file_id) WHERE drive_file_id IS NOT NULL;

-- A given R2 object must back at most one job_result_files row — prevents two rows from
-- ever claiming to be the same physical file.
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_result_files_r2_key
  ON public.job_result_files (r2_key) WHERE r2_key IS NOT NULL;

ALTER TABLE public.job_result_files ENABLE ROW LEVEL SECURITY;
-- Service-role only — no policies, matching document_analysis/order_drafts/cost_reservations.
