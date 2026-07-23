-- Migration 0064: new DRAFT pricing_versions row with progressive WPO coordination
-- (WO-98, 2026-08-04) — official/notary translation-portion coordination only.
--
-- PREPARED, NOT APPLIED. The user applies this manually on staging via Supabase
-- migrations, then reviews, then decides whether/when to activate it (see
-- scripts/staging/activate-progressive-coordination-version.ts, also prepared, not run).
--
-- What this does:
--   1. Clones every rate/config column from the current active '2026-Q3-KZ-NEWMODEL'
--      row (id f5d6a080-01ad-46a0-abd8-704c809382c6) into a NEW row, status='draft',
--      code '2026-Q3-KZ-NEWMODEL-COORD-TIERS'. The active row itself is never touched —
--      no UPDATE statement in this migration touches an existing row.
--   2. Adds coordinationVolumeTiers / notaryCoordinationRate / courierCoordinationRate to
--      the new row's metadata (existing JSONB column — no new table, no new column).
--      Tiers: 0-5 pages @ 30%, 5-10 pages @ 25%, 10+ pages @ 20% (translation portion
--      only); notary and courier coordination stay at 30% (unchanged from today).
--   3. Clones every pricing_language_rates row from the active version to the new
--      version_id, so the new version prices every currently-supported language pair
--      identically to the active version the moment it might be activated — without
--      this step every quote against the new (still-draft) version would fall into
--      operator_review for "no active language rate found".
--
-- What this does NOT do:
--   - Does not touch, deactivate, or archive the active '2026-Q3-KZ-NEWMODEL' row.
--   - Does not activate the new row (status='draft' — see
--     src/lib/pricing/service.ts's getActivePricingVersion(), which only ever selects
--     status='active'; a 'draft' row is completely inert until a human runs an
--     activation script).
--   - Does not change ENABLE_NEW_OFFICIAL_PRICING/ENABLE_NEW_NOTARY_PRICING — those
--     flags are unrelated to which pricing_versions row is active.
--
-- Rollback: `DELETE FROM public.pricing_versions WHERE code =
-- '2026-Q3-KZ-NEWMODEL-COORD-TIERS';` (cascades to its cloned pricing_language_rates
-- rows via ON DELETE CASCADE) — safe at any time before activation, since nothing else
-- can reference a 'draft' row (price_quotes.pricing_version_id only ever gets set to
-- whichever version was ACTIVE at quote time).

with new_version as (
  insert into public.pricing_versions (
    code, status, currency, internal_fx_rate, mrp_value,
    tax_rate, acquiring_rate, risk_reserve_rate, owner_reserve_rate,
    marketing_rate_direct, partner_commission_rate, target_profit_rate,
    ai_it_reserve_per_page_kzt, valid_from, valid_to, metadata,
    ai_it_rate, channel_reserve_rate, client_discount_rate, wpo_coordination_rate,
    translator_payout_rate, ocr_rate_per_physical_page_kzt, courier_fee_kzt,
    printing_fee_kzt, extra_paper_copy_fee_kzt, rounding_step_official_kzt,
    rounding_step_notary_kzt, public_electronic_price_kzt,
    public_official_min_price_kzt, public_notary_min_price_kzt
  )
  select
    '2026-Q3-KZ-NEWMODEL-COORD-TIERS', 'draft', v.currency, v.internal_fx_rate, v.mrp_value,
    v.tax_rate, v.acquiring_rate, v.risk_reserve_rate, v.owner_reserve_rate,
    v.marketing_rate_direct, v.partner_commission_rate, v.target_profit_rate,
    v.ai_it_reserve_per_page_kzt, now(), null,
    v.metadata
      || jsonb_build_object(
        'note', 'WO-98 progressive WPO coordination (2026-08-04) — DRAFT, not activated. Translation-portion coordination is tiered by billableTranslationPages: 0-5 pages @ 30%, 5-10 @ 25%, 10+ @ 20%. Notary/courier coordination unchanged at 30%. Everything else (T/O/N/C/P, payouts, gross-up 45.5%, channel reserve 20%, client discount 10%, partner commission 10%, rounding, urgency) is byte-identical to 2026-Q3-KZ-NEWMODEL. Operator must run the activation script manually after staging E2E sign-off, exactly like the base version required.',
        'coordinationVolumeTiers', jsonb_build_array(
          jsonb_build_object('fromPage', 0, 'upToPage', 5, 'rate', 0.30),
          jsonb_build_object('fromPage', 5, 'upToPage', 10, 'rate', 0.25),
          jsonb_build_object('fromPage', 10, 'upToPage', null, 'rate', 0.20)
        ),
        'notaryCoordinationRate', 0.30,
        'courierCoordinationRate', 0.30
      ),
    v.ai_it_rate, v.channel_reserve_rate, v.client_discount_rate, v.wpo_coordination_rate,
    v.translator_payout_rate, v.ocr_rate_per_physical_page_kzt, v.courier_fee_kzt,
    v.printing_fee_kzt, v.extra_paper_copy_fee_kzt, v.rounding_step_official_kzt,
    v.rounding_step_notary_kzt, v.public_electronic_price_kzt,
    v.public_official_min_price_kzt, v.public_notary_min_price_kzt
  from public.pricing_versions v
  where v.code = '2026-Q3-KZ-NEWMODEL'
  returning id
)
insert into public.pricing_language_rates (
  pricing_version_id, source_language, target_language,
  rate_kzt_per_translation_page, active, requires_operator_review
)
select
  new_version.id, r.source_language, r.target_language,
  r.rate_kzt_per_translation_page, r.active, r.requires_operator_review
from public.pricing_language_rates r, new_version
where r.pricing_version_id = (select id from public.pricing_versions where code = '2026-Q3-KZ-NEWMODEL');
