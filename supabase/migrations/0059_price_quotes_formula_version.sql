-- Migration 0059: price_quotes.formula_version — snapshot the formula version at quote time
--
-- price_quotes.wpo_financial_breakdown_json already stores the entire NewModelBreakdown
-- (migration 0053), but nothing recorded WHICH formula_version that breakdown was computed
-- under. pricing_versions.metadata is a mutable jsonb column — if it's ever edited after the
-- fact (e.g. correcting a typo in its 'note' field), an already-quoted (or already-paid) order
-- must still show exactly what formula_version it was actually priced under, not whatever the
-- version's metadata says today. Populated by src/lib/pricing/service.ts's saveQuote() from the
-- PricingVersion object it already has in hand at save time — never re-derived later.

ALTER TABLE public.price_quotes
  ADD COLUMN IF NOT EXISTS formula_version text;

COMMENT ON COLUMN public.price_quotes.formula_version IS
  'Snapshot of pricing_versions.metadata.formula_version at the moment this quote was saved (see saveQuote() in src/lib/pricing/service.ts). NULL for quotes saved before this column existed, or for pricing_versions rows with no formula_version in their metadata. Never re-derived from the live pricing_versions row — that could drift after the fact.';
