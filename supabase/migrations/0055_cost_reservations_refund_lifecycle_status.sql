-- Migration 0055: extend cost_reservations.status for the refund lifecycle
--
-- Backs the new-model quote refund/cancellation lifecycle (2026-07-17 decision): a full
-- refund releases unused internal reserves and cancels not-yet-paid external payouts;
-- already-`paid` reservations are untouched. Applies only to new-model quotes (detected via
-- price_quotes.wpo_financial_breakdown_json / pricing_versions.metadata->>'formula_version' =
-- 'new_2026_07' — old-model quotes keep today's pre-existing behavior, unchanged, not
-- retrofitted). Follows the exact DROP CONSTRAINT / ADD CONSTRAINT pattern already used for
-- jobs.status in migration 0041_jobs_refunded_status.sql. All existing cost_reservations rows
-- retain their current status — no data modification.

ALTER TABLE public.cost_reservations DROP CONSTRAINT IF EXISTS cost_reservations_status_check;

ALTER TABLE public.cost_reservations ADD CONSTRAINT cost_reservations_status_check
  CHECK (status IN ('reserved', 'committed', 'paid', 'canceled', 'adjusted', 'released', 'refunded'));

COMMENT ON COLUMN public.cost_reservations.status IS
  'reserved -> committed (on payment) -> paid (on actual payout). released: an internal reserve no longer needed after a refund (new-model quotes only). canceled: a not-yet-paid external payout whose obligation no longer exists (full refund, new-model quotes only) — see docs/ai-context/DECISIONS.md, 2026-07-17. refunded: reserved for a reservation-level refund marker if ever needed; not written by the initial implementation, which uses released/canceled instead.';

-- New cost_type values introduced by the new formula (courier_cost, printing_cost) require
-- no migration — cost_type has never had a CHECK constraint (confirmed: migration 0022 defines
-- it as unconstrained text). WPO's own coordination fee, its urgency surcharge, and
-- manual_adjustment_kzt are revenue/price changes, not costs, and must NEVER get a
-- cost_reservations row — see docs/ai-context/DECISIONS.md for the full 12-value cost_type
-- list (7 external payouts + 5 internal reserves) the new formula is allowed to create.

CREATE INDEX IF NOT EXISTS idx_cost_reservations_status_refund_lifecycle
  ON public.cost_reservations (status, updated_at)
  WHERE status IN ('released', 'refunded');
