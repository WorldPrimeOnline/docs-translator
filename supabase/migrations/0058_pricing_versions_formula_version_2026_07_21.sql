-- Migration 0058: pricing_versions — bump the draft new-model row's metadata.formula_version
-- to reflect the 2026-07-21 formula corrections
--
-- Real-world testing of the 2026-07-17 formula (via tools/pricing-cli) surfaced three errors
-- that had to be fixed before this draft model can ever be connected to checkout:
--   1. Billable translation pages: was max(1, characters/1800), ignoring physical page count
--      entirely. Now: characterPages = charactersWithSpaces / 1800 (unrounded);
--      billableTranslationPages = max(1, reliablePhysicalPageCount, characterPages) — whichever
--      basis wins determines how translation is billed (physical pages × rate, or
--      characters × rate / 1800). See src/lib/pricing/calculator.ts and
--      src/lib/pricing/types.ts's TranslationPageBasis.
--   2. Delivery/courier: deliveryRequired and fulfillmentMethod could silently disagree (a
--      manifest setting only deliveryRequired=true still produced fulfillmentMethod='pickup'
--      because SAFE_DEFAULTS pre-filled 'pickup' before the derivation ran), so the courier fee
--      sometimes never entered the calculation despite the report showing "Доставка". Fixed at
--      the root: tools/pricing-cli/lib/config.ts no longer defaults fulfillmentMethod at all;
--      it is always either explicit or derived from deliveryRequired. calculatePrice() now also
--      throws PRICING_CONFIG_INVALID if the two ever contradict.
--   3. Urgency: the same_day multiplier (×1.5 after_noon, ×2 after_18) was applied only to the
--      WPO coordination fee, not the whole order — a same_day order barely changed price at all.
--      Now: the full standard order (T+O+N+C+P+W+M, grossed up, rounded) = standardRetail is
--      computed first with no urgency in the picture; retailKzt = standardRetail ×
--      urgencyMultiplier is applied afterward, on top of the WHOLE retail. External payouts
--      (translator/notary/courier) are never urgency-multiplied. Referral discount/partner
--      commission are computed from retailKzt (i.e. AFTER urgency), never standardRetail.
--
-- This migration ONLY updates metadata on the still-draft '2026-Q3-KZ-NEWMODEL' row (status
-- untouched, never activated by this migration) so the stored formula_version stays honest
-- about which formula the row's numbers were validated against. It does not change any rate
-- column — those were already correct; only the calculator's interpretation of them changed.
-- Safe to re-run: jsonb_build_object with a literal WHERE clause is idempotent.

UPDATE public.pricing_versions
SET metadata = metadata || jsonb_build_object(
  'formula_version', 'new_2026_07_21',
  'note', 'Prepared, NOT activated. 2026-07-21: billable-page basis (physical vs character count), delivery/courier root-cause fix, and whole-order urgency multiplier corrected per real-world tools/pricing-cli testing — see migration 0058. Operator must still run populate-public-pricing-snapshot.ts, then the transactional activation script, both manually, on staging only.'
)
WHERE code = '2026-Q3-KZ-NEWMODEL'
  AND status = 'draft';
