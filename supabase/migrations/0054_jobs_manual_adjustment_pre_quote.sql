-- Migration 0054: jobs — pre-quote manual adjustment fields
--
-- Backs the single, unambiguous manual_adjustment_kzt mechanism (2026-07-17 decision):
-- amount/reason/actor/timestamp captured on jobs BEFORE quote creation, feeding directly into
-- the new formula's M term. There is exactly ONE legitimate stage where a manual adjustment
-- affects price — before the quote exists — so there is no "stage" enum here (an earlier
-- planning draft included a manual_adjustment_stage CHECK(pre_quote|post_quote) column; it was
-- removed because "post_quote" implied a legitimate way to mutate an existing quote's price,
-- which is forbidden: an unpaid quote needing an adjustment is expired and replaced with a new
-- quote revision instead, and a paid quote's price is never mutated at all — see
-- docs/ai-context/DECISIONS.md, 2026-07-17).
--
-- Full audit trail reuses the existing job_audit_log table / writeIntegrationAuditLog pattern
-- (worker/src/lib/integrations.ts) — no new audit table needed.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS manual_adjustment_kzt    numeric(12,2),
  ADD COLUMN IF NOT EXISTS manual_adjustment_reason text,
  ADD COLUMN IF NOT EXISTS manual_adjustment_actor  text,
  ADD COLUMN IF NOT EXISTS manual_adjustment_at     timestamptz;

COMMENT ON COLUMN public.jobs.manual_adjustment_kzt IS
  'Pre-quote-only adjustment, folded into the new formula''s M term at quote-creation time. NULL/0 means no adjustment. Application code must enforce that manual_adjustment_reason is non-empty whenever this is non-null/non-zero (not a DB NOT NULL, to avoid a partial-migration ordering trap).';
COMMENT ON COLUMN public.jobs.manual_adjustment_reason IS
  'Mandatory (application-enforced) whenever manual_adjustment_kzt is set. Never a price change without a recorded reason.';
COMMENT ON COLUMN public.jobs.manual_adjustment_actor IS
  'Operator identifier (staff_profiles.id or email) who entered the adjustment — for audit, mirroring refund_transactions.operator_id''s convention.';
