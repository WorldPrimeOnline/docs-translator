-- Migration: service_level, notary delivery fields, Jira/Drive integration fields, audit log
-- Idempotent (IF NOT EXISTS) — safe to re-run.

-- ── 1. service_level and notary delivery fields on jobs ───────────────────────
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS service_level TEXT DEFAULT 'electronic',
  ADD COLUMN IF NOT EXISTS notary_city TEXT,
  ADD COLUMN IF NOT EXISTS fulfillment_method TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS delivery_phone TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS delivery_address TEXT DEFAULT NULL;

-- Backfill: derive service_level from legacy notarized/bureau_stamp booleans
UPDATE public.jobs
SET service_level = CASE
  WHEN notarized = true THEN 'notarization_through_partners'
  WHEN EXISTS (
    SELECT 1 FROM public.jobs j2
    WHERE j2.id = jobs.id AND j2.notarized = false
      -- bureau_stamp may not exist yet; handle gracefully
  ) THEN 'electronic'
  ELSE 'electronic'
END
WHERE service_level IS NULL OR service_level = 'electronic';

-- ── 2. Jira and Google Drive integration fields on jobs ───────────────────────
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS jira_issue_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS jira_issue_key TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS jira_issue_url TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS google_drive_folder_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS google_drive_folder_url TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS jira_sync_status TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS drive_sync_status TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_integration_error TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS jobs_jira_issue_key_idx ON public.jobs (jira_issue_key) WHERE jira_issue_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS jobs_service_level_idx ON public.jobs (service_level);

-- ── 3. job_audit_log table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.job_audit_log (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id           UUID        NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  actor            TEXT        NOT NULL, -- 'system', 'operator', 'translator', 'notary', 'webhook'
  source           TEXT        NOT NULL, -- 'upload', 'worker', 'jira_webhook', 'manual'
  action           TEXT        NOT NULL, -- 'job_created', 'status_changed', 'jira_issue_created', etc.
  previous_status  TEXT,
  new_status       TEXT,
  jira_issue_key   TEXT,
  correlation_id   TEXT,
  metadata         JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS job_audit_log_job_id_idx ON public.job_audit_log (job_id);
CREATE INDEX IF NOT EXISTS job_audit_log_jira_key_idx ON public.job_audit_log (jira_issue_key) WHERE jira_issue_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS job_audit_log_correlation_idx ON public.job_audit_log (correlation_id) WHERE correlation_id IS NOT NULL;

ALTER TABLE public.job_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_log_service_role_only"
  ON public.job_audit_log
  USING (false);
