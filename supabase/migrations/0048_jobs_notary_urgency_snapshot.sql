-- Migration 0048: jobs notary urgency snapshot
--
-- Root cause (WO-77, job 023955c9-5d88-43c6-bf34-0be2a4912a86, 2026-07-15): the
-- customer's notary urgency choice ("same_day") and its resolved pricing window
-- (multiplier, cutoff, surcharge — src/lib/pricing/calculator.ts,
-- getNotaryCutoffWindow()) are computed once, at quote time, and stored only in
-- price_quotes.pricing_context_json.notaryCutoff (JSONB). jobs never received a
-- copy, so the worker's Jira issue creation (worker/src/lib/integrations.ts) had
-- no urgency data to show — the main Jira issue and the Price Breakdown Story
-- both looked identical to a "standard" order even when same_day was selected
-- and correctly priced (multiplier 1.0, 0 KZT surcharge before the 12:00 Almaty
-- cutoff — the pricing itself was never wrong, only its visibility downstream).
--
-- This is an IMMUTABLE snapshot, copied verbatim from the pricing result at
-- order-creation time (src/lib/documents/upload-card-shared.ts,
-- src/lib/order-drafts/service.ts) — never recomputed later against current
-- time. Recomputing after the fact would silently change historical pricing
-- context for an already-quoted/paid order.
--
-- Nullable, no default: existing jobs and non-notarized jobs (electronic,
-- official_with_translator_signature_and_provider_stamp) genuinely have no
-- notary urgency concept. Application code must fall back to
-- price_quotes.pricing_context_json.notaryCutoff for legacy notarized jobs
-- predating this column, and must never fabricate a value for NULL.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS notary_urgency_level TEXT,
  ADD COLUMN IF NOT EXISTS notary_urgency_window TEXT,
  ADD COLUMN IF NOT EXISTS notary_urgency_multiplier NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS notary_urgency_cutoff_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notary_urgency_fee_kzt NUMERIC(12,2);

COMMENT ON COLUMN public.jobs.notary_urgency_level IS
  'standard | same_day — customer-selected notary urgency (NotaryUrgencyLevel), copied verbatim from the pricing result at quote time. NULL for non-notarized orders and for jobs created before this column existed (fall back to price_quotes.pricing_context_json.notaryCutoff).';

COMMENT ON COLUMN public.jobs.notary_urgency_window IS
  'standard | before_noon | after_noon | after_18 — the resolved Asia/Almaty cutoff window (NotaryCutoffSnapshot.effectiveWindow) at the moment the quote was computed. Never recompute against current time.';

COMMENT ON COLUMN public.jobs.notary_urgency_multiplier IS
  'Urgency coefficient applied to the notary coordination fee (1.0, 1.5, or 2.0), snapshotted from NotaryCutoffSnapshot.multiplier at quote time.';

COMMENT ON COLUMN public.jobs.notary_urgency_cutoff_at IS
  'ISO timestamp of the window boundary (12:00 or 18:00 Almaty) that was in effect when the quote was computed (NotaryCutoffSnapshot.cutoffAt). NULL for the standard window.';

COMMENT ON COLUMN public.jobs.notary_urgency_fee_kzt IS
  'Actual notary_urgency_fee line item amount in KZT, including 0 when same_day was selected but resolved to multiplier 1.0 (no surcharge) — 0 is a valid, meaningful value here, not "not recorded".';
