-- Migration 0053: price_quotes — new formula snapshot fields
--
-- Backs the new official/notarization_through_partners pricing formula (2026-07-17 decision).
-- Adds the columns for measured facts that are referenced by name elsewhere (report, tests,
-- operator-override UI) plus one dedicated JSONB column for the full ~40-field new-formula
-- snapshot. Kept separate from the existing pricing_context_json/margin_json/breakdown_json
-- (which already have established old-model meanings) to avoid ambiguity when old- and
-- new-model quotes are read side by side in the same Jira report code path.
--
-- Deliberately NO refund_amount_kzt column: refund totals are read live from the existing
-- refund_transactions table + get_refundable_amount() RPC (migration 0018), which is already
-- an idempotent, append-only ledger (SUM of status='succeeded' rows) — storing a redundant,
-- re-derivable aggregate here would risk drifting from that source of truth. See
-- docs/ai-context/DECISIONS.md (2026-07-17, partial refund lifecycle).

ALTER TABLE public.price_quotes
  ADD COLUMN IF NOT EXISTS analysis_id                        uuid REFERENCES public.document_analysis(id),
  ADD COLUMN IF NOT EXISTS language_rate_id                    uuid REFERENCES public.pricing_language_rates(id),
  ADD COLUMN IF NOT EXISTS source_character_count_with_spaces  integer,
  ADD COLUMN IF NOT EXISTS translation_page_count_exact        numeric(12,6),
  ADD COLUMN IF NOT EXISTS manual_adjustment_kzt               numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wpo_financial_breakdown_json        jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.price_quotes.analysis_id IS
  'The SPECIFIC document_analysis revision this quote is based on. Quote creation is blocked until a completed (or manually-resolved requires_operator_review) analysis exists; never implicitly "latest for this document".';
COMMENT ON COLUMN public.price_quotes.language_rate_id IS
  'The specific pricing_language_rates row used to compute T for this quote. A later rate change never affects this quote — the rate is snapshotted here (and again inside wpo_financial_breakdown_json for full auditability) at quote-creation time.';
COMMENT ON COLUMN public.price_quotes.translation_page_count_exact IS
  'Reporting/snapshot value only (max(1, source_character_count_with_spaces/1800)) — NEVER the arithmetic source for the translation amount (T). T is computed directly from the integer character count via a centralized Decimal-based money helper; feeding this rounded page count back into T would compound a rounding error. See src/lib/pricing/money.ts.';
COMMENT ON COLUMN public.price_quotes.manual_adjustment_kzt IS
  'Pre-quote-only adjustment folded into the formula''s M term at quote-creation time (mandatory reason/actor/timestamp audited via job_audit_log — see jobs.manual_adjustment_* in migration 0054). An existing (unpaid) quote is never mutated to add an adjustment after the fact — a new quote revision is created instead. After payment, price is permanently frozen; a "manual adjustment" at that stage can only be a non-price-affecting operator note or a real refund (see refund_transactions/get_refundable_amount).';
COMMENT ON COLUMN public.price_quotes.wpo_financial_breakdown_json IS
  'Full new-formula snapshot (component amounts T/O/N/C/P/W_base/W_final, gross-up rate/amount, retail_before_rounding, rounding_step, retail_price, discount, actual_payment, partner_commission_rate/amount, channel_budget, unused_channel_reserve, external payouts, internal reserves, margin/net-result figures, reconciliation_difference). Immutable once paid_at is set — same rule as pricing_context_json/margin_json. Never mutated by a refund; refund totals are read live from refund_transactions, not stored here.';
