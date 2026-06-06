-- Add official workflow fields to jobs
-- Run this migration in Supabase SQL editor before deploying worker with official translation pipeline.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS workflow_status TEXT DEFAULT 'completed';

-- Add artifact keys to translations
ALTER TABLE translations ADD COLUMN IF NOT EXISTS translated_docx_key TEXT;
ALTER TABLE translations ADD COLUMN IF NOT EXISTS translated_preview_pdf_key TEXT;
ALTER TABLE translations ADD COLUMN IF NOT EXISTS qa_report JSONB;

-- Index for workflow_status queries (optional, for future admin queries)
CREATE INDEX IF NOT EXISTS jobs_workflow_status_idx ON jobs (workflow_status);
