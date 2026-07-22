-- Migration 0051: seed the new pricing_versions row + 14 RU->X language rates
--
-- Prepares (does NOT activate) the pricing_versions row for the new official/notary formula
-- (2026-07-17 decision). status='draft' deliberately — this migration must never flip any
-- quote-creation behavior by itself. The operator activates this version manually, on staging,
-- only after: (1) all calculator/service tests pass against this row by explicit code (never
-- requiring it to be active), and (2) scripts/staging/populate-public-pricing-snapshot.ts has
-- populated public_electronic_price_kzt/public_official_min_price_kzt/public_notary_min_price_kzt
-- on this row (the transactional activation script refuses to activate otherwise).
--
-- Corrected values (do not use earlier draft figures that circulated during planning):
--   courier_fee_kzt = 5000.00   (NOT 2500 — corrected before this file was written)
--   marketing_rate_direct = 0.05 (NOT the column's own DEFAULT of 0.10 from migration 0019 —
--     the new formula's marketing component is 5%; using the default 10% would make the total
--     gross-up rate 50.5% instead of the approved 45.5%. This is a SEED VALUE correction only,
--     not a schema change — the column itself is unchanged from migration 0019.)
--   owner_reserve_rate = 0.00   (new formula; migration 0019's default is 0.07, unrelated to
--     this version)
--
-- mrp_value stays in migration 0019's "stored in thousands of KZT" convention (unchanged) —
-- 3.69 here means 3,690 KZT... but the approved model's worked examples use the notary fee
-- 4,325 KZT * 0.53 = 2,292.25 for an individual applicant, i.e. mrp_value = 4.325 (thousands).
-- Use 4.325, not 3.69, to match the approved model's exact notary-fee worked examples.

INSERT INTO public.pricing_versions (
  code, status, currency,
  mrp_value,
  tax_rate, acquiring_rate, risk_reserve_rate, owner_reserve_rate,
  marketing_rate_direct, partner_commission_rate, target_profit_rate,
  ai_it_reserve_per_page_kzt,
  ai_it_rate, channel_reserve_rate, client_discount_rate, wpo_coordination_rate,
  ocr_rate_per_physical_page_kzt, courier_fee_kzt, printing_fee_kzt, extra_paper_copy_fee_kzt,
  rounding_step_official_kzt, rounding_step_notary_kzt,
  metadata
) VALUES (
  '2026-Q3-KZ-NEWMODEL', 'draft', 'KZT',
  4.325,
  0.03, 0.025, 0.05, 0.00,
  0.05, 0.10, 0.25,
  100.00,
  0.10, 0.20, 0.10, 0.30,
  100.00, 5000.00, 0.00, 0.00,
  100.00, 500.00,
  jsonb_build_object(
    'formula_version', 'new_2026_07',
    'note', 'Prepared, NOT activated. Operator must run populate-public-pricing-snapshot.ts, then the transactional activation script, both manually, on staging only.'
  )
)
ON CONFLICT (code) DO NOTHING;

-- 14 RU -> X language rates for the new version, per the WPO-approved rate card (2026-07-17).
-- source_language/target_language use the same ISO-639-1-style codes already used elsewhere
-- in this codebase for documents.source_language/target_language (e.g. 'kk' for Kazakh, per
-- src/lib/pricing/config.ts's KZ code list). All active=true, requires_operator_review=false
-- — these are confirmed, business-approved rates, not placeholders.
INSERT INTO public.pricing_language_rates
  (pricing_version_id, source_language, target_language, rate_kzt_per_translation_page, active, requires_operator_review)
SELECT v.id, 'ru', pair.target_language, pair.rate_kzt, true, false
FROM public.pricing_versions v,
  (VALUES
    ('kk', 2000.00),  -- Kazakh
    ('uz', 3500.00),  -- Uzbek
    ('ky', 4000.00),  -- Kyrgyz
    ('uk', 3500.00),  -- Ukrainian
    ('be', 5000.00),  -- Belarusian
    ('en', 3000.00),  -- English
    ('de', 5000.00),  -- German
    ('fr', 4000.00),  -- French
    ('it', 4000.00),  -- Italian
    ('zh', 5000.00),  -- Chinese
    ('ko', 7000.00),  -- Korean
    ('tr', 4000.00),  -- Turkish
    ('th', 10000.00), -- Thai
    ('ar', 6000.00)   -- Arabic
  ) AS pair(target_language, rate_kzt)
WHERE v.code = '2026-Q3-KZ-NEWMODEL'
ON CONFLICT (pricing_version_id, source_language, target_language) DO NOTHING;
