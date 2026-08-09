-- Migration 0069: telegram_assignments.job_id nullable — Telegram Operations is Jira-driven
--
-- 2026-08-09 domain correction: Telegram Operations must fully support Jira issues that
-- have no corresponding WPO job — e.g. a Jira issue created manually (normal fields
-- populated, wpo-production label added) purely to test the Jira -> Telegram ->
-- claim/start/done -> Jira workflow end-to-end, with no jobs/documents/price_quotes row
-- ever created in Supabase. jira_issue_key + role (the existing UNIQUE constraint, kept
-- as-is) is the actual operational identity of a Telegram assignment; job_id is optional
-- enrichment — a linkage to a real WPO job when one exists, used only for job_audit_log
-- correlation and the page-count/payout lines in the broadcast message. Resolution logic
-- (src/app/api/telegram/jira-event/route.ts's resolveJobId()) now stores NULL instead of
-- refusing to broadcast when no real job can be found.
--
-- Additive/backward-compatible: DROP NOT NULL only, no data changes. Every existing row
-- keeps its real job_id; the FK to jobs(id) is unaffected (a nullable FK simply isn't
-- checked when NULL — standard behavior, ON DELETE CASCADE only fires for a real link).

ALTER TABLE public.telegram_assignments ALTER COLUMN job_id DROP NOT NULL;

COMMENT ON COLUMN public.telegram_assignments.job_id IS
  'Optional linkage to a real WPO job (jobs.id) when one exists — resolved via jobs.jira_issue_key first, then a validated customfield_10073 cross-reference (see resolveJobId()). NULL for Jira-only operational issues with no corresponding WPO job (e.g. manually created test issues tagged wpo-production). jira_issue_key + role, not job_id, is the operational identity of a Telegram assignment — see migration 0068.';
