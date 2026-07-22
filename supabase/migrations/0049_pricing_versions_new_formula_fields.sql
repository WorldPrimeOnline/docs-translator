-- Migration 0049: pricing_versions — new formula scalar fields + persisted public-price snapshot
--
-- Backs the WPO-approved financial model rewrite for official/notarization_through_partners
-- pricing (2026-07-17 decision) — see docs/ai-context/DECISIONS.md. Adds the scalar rates/fees
-- the new flat formula needs beyond what pricing_versions (migration 0019) already has, plus
-- three columns that persist a computed "public minimum price" snapshot so the homepage/pricing
-- cards never need a request-time computation or cache (see 0051's seed + the
-- populate-public-pricing-snapshot.ts script, run manually before activation).
--
-- Convention (matches migration 0019 exactly): rate columns are FRACTIONS (0.03 = 3%),
-- numeric(8,4), named <thing>_rate; per-unit/flat KZT amounts are numeric(12,2), named
-- <thing>_kzt or <thing>_per_<unit>_kzt.
--
-- gross_up_rate (45.5%) is NOT stored here — it is derived in application code from
-- tax_rate + acquiring_rate + risk_reserve_rate + marketing_rate_direct + ai_it_rate +
-- owner_reserve_rate + channel_reserve_rate, so it can never drift from its components.
-- marketing_rate_direct is the EXISTING column from migration 0019 — this migration does not
-- touch it; only the new model's SEED value (migration 0051) sets it to 0.05 for the new
-- formula (the new model's marketing component is 5%, not the old default of 10%).
--
-- ai_it_rate is a NEW, distinct concept from the pre-existing ai_it_reserve_per_page_kzt
-- column: the old column is an internal-only cost reserve (never customer-facing), while
-- ai_it_rate is a gross-up percentage of actual_payment (customer-facing, grossed up like
-- every other component). Do not conflate them — see ocr_rate_per_physical_page_kzt below
-- for the same reasoning applied to the O component vs. the old per-page cost reserve.

ALTER TABLE public.pricing_versions
  ADD COLUMN IF NOT EXISTS ai_it_rate                    numeric(8,4)  NOT NULL DEFAULT 0.10,
  ADD COLUMN IF NOT EXISTS channel_reserve_rate          numeric(8,4)  NOT NULL DEFAULT 0.20,
  ADD COLUMN IF NOT EXISTS client_discount_rate          numeric(8,4)  NOT NULL DEFAULT 0.10,
  ADD COLUMN IF NOT EXISTS wpo_coordination_rate         numeric(8,4)  NOT NULL DEFAULT 0.30,
  ADD COLUMN IF NOT EXISTS ocr_rate_per_physical_page_kzt numeric(12,2) NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS courier_fee_kzt               numeric(12,2) NOT NULL DEFAULT 5000,
  ADD COLUMN IF NOT EXISTS printing_fee_kzt              numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extra_paper_copy_fee_kzt      numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rounding_step_official_kzt    numeric(12,2) NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS rounding_step_notary_kzt      numeric(12,2) NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS public_electronic_price_kzt   numeric(12,2),
  ADD COLUMN IF NOT EXISTS public_official_min_price_kzt numeric(12,2),
  ADD COLUMN IF NOT EXISTS public_notary_min_price_kzt   numeric(12,2);

COMMENT ON COLUMN public.pricing_versions.ai_it_rate IS
  'NEW-formula gross-up %: ai_it_reserve = actual_payment * ai_it_rate. Distinct from the pre-existing ai_it_reserve_per_page_kzt column (an internal-only per-page cost reserve, old formula, unrelated role) — never conflate the two.';
COMMENT ON COLUMN public.pricing_versions.channel_reserve_rate IS
  'channel_budget = retail_price(rounded) * channel_reserve_rate. Must be >= client_discount_rate + max(partners.commission_rate)*(1-client_discount_rate) — validated at config-load time in application code, not a DB constraint (the max partner rate lives in a different table).';
COMMENT ON COLUMN public.pricing_versions.client_discount_rate IS
  'Referral-channel client discount, applied to the ROUNDED retail price. Direct-channel orders never apply this.';
COMMENT ON COLUMN public.pricing_versions.wpo_coordination_rate IS
  'W_base = wpo_coordination_rate * (T + N + C). Replaces the old fixed notaryCoordinationFeeDefault (5000 KZT flat) and the old translator_reserved_cost 30%-of-translation estimate with a single unified coordination rate per the new formula.';
COMMENT ON COLUMN public.pricing_versions.ocr_rate_per_physical_page_kzt IS
  'Customer-facing O component (physical_page_count * this rate), part of component_subtotal before gross-up. Distinct from ai_it_reserve_per_page_kzt (internal-only cost, old formula) even though both are 100 KZT/page today — that is coincidental, not structural.';
COMMENT ON COLUMN public.pricing_versions.courier_fee_kzt IS
  'Flat courier fee for notarization_through_partners + delivery orders only. 5000 KZT per the 2026-07-17 approved model (NOT 2500 — that figure was an earlier draft error, corrected before this migration was applied).';
COMMENT ON COLUMN public.pricing_versions.extra_paper_copy_fee_kzt IS
  'Per-copy fee for additional notarized paper copies. Defaults to 0 (was 500 KZT/copy in the old model) pending real confirmation from the notary partner.';
COMMENT ON COLUMN public.pricing_versions.rounding_step_official_kzt IS
  'Retail price rounds UP to this step for official_with_translator_signature_and_provider_stamp orders (100 KZT).';
COMMENT ON COLUMN public.pricing_versions.rounding_step_notary_kzt IS
  'Retail price rounds UP to this step for notarization_through_partners orders (500 KZT).';
COMMENT ON COLUMN public.pricing_versions.public_electronic_price_kzt IS
  'Persisted "from" price shown on public marketing pages for the electronic tier. NULL until scripts/staging/populate-public-pricing-snapshot.ts has been run against this version row. A version must never be activated (status=active) while this is NULL — see the transactional activation script''s guard.';
COMMENT ON COLUMN public.pricing_versions.public_official_min_price_kzt IS
  'Persisted "from" price for the official tier — computed via calculatePrice() against the cheapest active pricing_language_rates row for this version, by the population script. Never computed at request time.';
COMMENT ON COLUMN public.pricing_versions.public_notary_min_price_kzt IS
  'Persisted "from" price for the notarization_through_partners tier — same computation method as public_official_min_price_kzt.';
