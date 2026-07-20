-- Migration 0056: pricing_versions — translator_payout_rate (gap found during calculator rewrite)
--
-- The 2026-07-17 approved model explicitly lists "выплата переводчику: 30% от переводческой
-- стоимости" alongside the other configurable rates (OCR, WPO coordination, gross-up
-- components) with the instruction "все значения должны быть конфигурируемыми. Никаких magic
-- numbers внутри calculator.ts." Migration 0049 added every other new scalar rate but missed
-- this one — found while implementing calculator.ts's translator payout calculation
-- (translatorPayoutKzt = T * translator_payout_rate). Additive, same convention as 0049.
--
-- Legacy/electronic pricing (calculateElectronicPrice) does not read this column at all — it
-- is used only by the new official/notary formula (calculateOfficialNotaryPrice).
--
-- Idempotent / safe to re-run: ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS before
-- ADD CONSTRAINT, and the closing UPDATE only sets a known literal value (no destructive
-- read-then-write).

ALTER TABLE public.pricing_versions
  ADD COLUMN IF NOT EXISTS translator_payout_rate numeric(8,4) NOT NULL DEFAULT 0.3000;

ALTER TABLE public.pricing_versions DROP CONSTRAINT IF EXISTS pricing_versions_translator_payout_rate_check;
ALTER TABLE public.pricing_versions ADD CONSTRAINT pricing_versions_translator_payout_rate_check
  CHECK (translator_payout_rate >= 0 AND translator_payout_rate <= 1);

COMMENT ON COLUMN public.pricing_versions.translator_payout_rate IS
  'translator_payout = translation_amount(T) * translator_payout_rate. External payout, cost_reservations cost_type=translator_payout. 0.3000 (30%) per the 2026-07-17 approved model. Not read by the legacy electronic formula.';

-- Explicitly set for the new-model draft row (migration 0051) — harmless no-op if it already
-- matches; never touches any other pricing_versions row (electronic/legacy rows are untouched).
UPDATE public.pricing_versions
SET translator_payout_rate = 0.3000
WHERE code = '2026-Q3-KZ-NEWMODEL';
