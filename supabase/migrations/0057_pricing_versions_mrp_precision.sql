-- Migration 0057: pricing_versions — widen mrp_value precision (numeric(12,2) -> numeric(12,3))
--
-- Found during checkpoint 2 read-only verification (2026-07-17): mrp_value is stored "in
-- thousands of KZT" (e.g. 4.325 means 4,325 KZT — see src/lib/pricing/config.ts's
-- mrpValueFallbackKzt comment and calculator.ts's `mrpKzt = version.mrpValue * 1000`). The
-- column's original numeric(12,2) scale cannot hold the third decimal digit the approved
-- model's exact notary-fee worked examples require: migration 0051 attempted to seed 4.325 but
-- Postgres silently rounded it to 4.33 on insert (numeric(p,s) truncates/rounds to its declared
-- scale), which would make the notary official fee compute against 4,330 KZT instead of 4,325
-- KZT (individual applicant fee 2,294.90 instead of the approved 2,292.25).
--
-- This migration widens the column (ALTER COLUMN TYPE, preserving existing values via USING —
-- every current value, e.g. old rows at 3.69 or 4.33, is preserved exactly, just represented
-- with one more decimal digit of scale; nothing is recomputed or rounded further by this
-- migration itself) and corrects the DEFAULT and the new-model draft row's stored value to the
-- exact approved figure. It does not touch `status` on any row and does not touch any existing
-- price_quotes row (those already have their own frozen pricing_context_json snapshot from
-- whatever mrp_value was in effect at quote time — this migration only affects future
-- calculations that read pricing_versions.mrp_value live, i.e. the not-yet-activated draft
-- version). Safe to re-run: ALTER COLUMN TYPE/DEFAULT are idempotent (re-applying with the same
-- target type/default is a no-op), and the closing UPDATE only sets a known literal.

ALTER TABLE public.pricing_versions
  ALTER COLUMN mrp_value TYPE numeric(12,3)
  USING mrp_value::numeric(12,3);

-- Only if the column has a DEFAULT today (migration 0019 did not set one — mrp_value is
-- nullable with no default — but this is included in case that changes later, per the
-- requested logic; a no-op if there is currently no default to redefine).
ALTER TABLE public.pricing_versions
  ALTER COLUMN mrp_value SET DEFAULT 4.325;

COMMENT ON COLUMN public.pricing_versions.mrp_value IS
  'Notary MRP tariff, stored IN THOUSANDS OF KZT (e.g. 4.325 = 4,325 KZT) — see src/lib/pricing/config.ts NOTARY_CONFIG.mrpValueFallbackKzt and calculator.ts''s `mrpKzt = version.mrpValue * 1000`. Widened from numeric(12,2) to numeric(12,3) in migration 0057 (2026-07-17) so this snapshot-precision figure is not silently rounded on insert.';

-- Correct the new-model draft row specifically (never activated by this migration — status is
-- untouched). Does not affect any other pricing_versions row or any existing price_quotes row.
UPDATE public.pricing_versions
SET mrp_value = 4.325
WHERE code = '2026-Q3-KZ-NEWMODEL'
  AND status = 'draft';
