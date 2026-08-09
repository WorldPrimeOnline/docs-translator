-- Migration 0068: telegram_assignments — Telegram operations integration
--
-- 2026-08-08: Translators and notary partners have no Jira license, so they cannot
-- claim/work orders directly in Jira. This table is the WPO-side link between a Jira
-- issue and the Telegram user who claimed it, replacing what Jira's native Assignee
-- field would do for a licensed user. Jira remains the sole owner of all workflow
-- transitions — this table never drives a Jira transition itself; it only records who
-- claimed what via Telegram and which message to edit when Jira's status changes.
--
-- status lifecycle (per role, one row per (jira_issue_key, role)):
--   open           -- broadcast sent, unclaimed
--   claim_pending  -- a Telegram user tapped "claim"; WPO forwarded the action to Jira
--                     Automation but has NOT yet received confirmation via the normal
--                     status_changed event. This is a reservation, not a confirmed claim.
--   claimed        -- Jira confirmed the claim (status_changed = НАЗНАЧЕН ПЕРЕВОДЧИК /
--                     НАЗНАЧЕН НОТАРИУС) — the only state that unlocks the "start" button.
--   in_progress    -- Jira confirmed work started (ПЕРЕВОД В РАБОТЕ / В РАБОТЕ У НОТАРИУСА)
--                     — the only state that unlocks the "done" button.
--   completed      -- Jira confirmed work finished (ПЕРЕВОД ЗАВЕРШЕН / ПЕРЕВОД ЗАВЕРЕН)
--                     — terminal, buttons removed from the Telegram message.
--
-- The open -> claim_pending transition is the concurrency arbitrator: it is written as
-- a single atomic UPDATE ... WHERE status = 'open' (mirroring worker/src/index.ts's
-- claimNextJob() atomic-claim pattern), so exactly one simultaneous Telegram tap wins.
-- claim_pending also has a staleness window (see application code) so a failed/lost
-- Jira Automation execution can never permanently lock an order — a later claim attempt
-- past the staleness window is allowed to atomically re-arbitrate from claim_pending,
-- not just from open.

CREATE TABLE IF NOT EXISTS public.telegram_assignments (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                uuid        NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  jira_issue_key        text        NOT NULL,
  role                  text        NOT NULL CHECK (role IN ('translator', 'notary')),
  status                text        NOT NULL DEFAULT 'open'
                                     CHECK (status IN ('open', 'claim_pending', 'claimed', 'in_progress', 'completed')),
  telegram_chat_id      bigint      NOT NULL,
  telegram_message_id   bigint      NOT NULL,
  telegram_user_id      bigint,
  telegram_display_name text,
  telegram_username     text,
  claim_pending_at      timestamptz,
  claimed_at            timestamptz,
  started_at            timestamptz,
  completed_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (jira_issue_key, role)
);

COMMENT ON TABLE public.telegram_assignments IS
  'Links a Jira order issue to the Telegram user who claimed it (translator or notary role) — replaces Jira Assignee for staff without a Jira license. Jira remains the sole owner of workflow transitions; this table only tracks Telegram-side claim/message state, driven by the normal Jira status_changed event, never by a direct transition call from WPO.';
COMMENT ON COLUMN public.telegram_assignments.status IS
  'open -> claim_pending (atomic, arbitrates simultaneous Telegram claims) -> claimed (confirmed by Jira status_changed) -> in_progress (confirmed) -> completed (confirmed, terminal). claim_pending has a staleness window in application code to recover from a lost Jira Automation execution.';
COMMENT ON COLUMN public.telegram_assignments.telegram_message_id IS
  'Telegram message_id of the broadcast in telegram_chat_id — edited in place on every confirmed status change instead of posting new messages.';

CREATE INDEX IF NOT EXISTS idx_telegram_assignments_job_id ON public.telegram_assignments (job_id);
CREATE INDEX IF NOT EXISTS idx_telegram_assignments_issue_key ON public.telegram_assignments (jira_issue_key);

CREATE TRIGGER telegram_assignments_set_updated_at
  BEFORE UPDATE ON public.telegram_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Service role only — no browser policies (same pattern as cost_reservations / order_drafts).
ALTER TABLE public.telegram_assignments ENABLE ROW LEVEL SECURITY;
