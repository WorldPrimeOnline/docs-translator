-- Official translation workflow: workflow_status on jobs + artifact columns on translations
-- Idempotent (IF NOT EXISTS) — safe to run on an already-migrated database.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS workflow_status TEXT DEFAULT 'completed';

ALTER TABLE public.translations
  ADD COLUMN IF NOT EXISTS translated_docx_key TEXT,
  ADD COLUMN IF NOT EXISTS translated_preview_pdf_key TEXT,
  ADD COLUMN IF NOT EXISTS qa_report JSONB;

CREATE INDEX IF NOT EXISTS jobs_workflow_status_idx
  ON public.jobs (workflow_status);
