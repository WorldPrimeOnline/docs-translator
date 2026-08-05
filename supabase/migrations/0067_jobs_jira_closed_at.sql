-- Migration 0067: jobs.jira_closed_at — authoritative "Jira closed this order" marker
--
-- 2026-08-05 WO-112 fix: Jira status "Закрыто" means the order is fully done for
-- EVERY service level, regardless of physical delivery/pickup progress — but there
-- was no dedicated event/signal for this. Jira Automation had nothing to send except
-- TRANSLATOR_COMPLETED (the wrong event, semantically "translator finished", not
-- "operator closed the whole order"), which the monotonic workflow_status guard
-- correctly rejected as a backward transition once workflow_status had already
-- advanced past it (e.g. notarized, rank 5, receiving a translator_completed-shaped
-- rank-3 target) — the guard was not the bug; the missing terminal signal was.
--
-- jobs.status cannot serve this purpose: it already reaches 'completed' as soon as
-- the AI OCR/translation pipeline finishes, long before any human review/notary/
-- delivery step even starts — completely unrelated to "Jira closed the order".
-- workflow_status cannot be overwritten either — the whole point is to mark the
-- order done from WHATEVER workflow_status it is currently at (notarized,
-- translator_approved, ...) without disturbing that value, since it's still the
-- correct historical record of how far the physical/human workflow actually got.
--
-- jira_closed_at is therefore a new, independent, nullable timestamp — same pattern
-- as documents.files_purged_at (migration 0066): purely additive, no FK/cascade
-- change, safe to apply and safe to roll back (drop the column) without data loss.
-- NULL until the ORDER_CLOSED webhook event sets it; once set, it is the sole
-- authoritative "closed" signal getCustomerOrderState() reads (see
-- src/lib/translation-workflow/customer-order-state.ts) to force 100%/"Готово"/
-- history placement regardless of service level or workflow_status.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS jira_closed_at timestamptz;

COMMENT ON COLUMN public.jobs.jira_closed_at IS
  'Set once Jira Automation sends eventType=ORDER_CLOSED (Jira status "Закрыто") — see syncOrderClosed(), src/lib/integrations/workflow.ts. The sole authoritative "order fully closed" signal for the customer dashboard, independent of jobs.status (already ''completed'' from the AI pipeline finishing, unrelated) and workflow_status (never overwritten by this event — preserved as the historical record of the physical/human workflow). NULL until Jira explicitly closes the order.';
