import type { ServiceLevel, UrgencyLevel, ScanQuality, LayoutComplexity, VisualMarksComplexity, ApplicantType, DeliveryZone } from './types';

export type LanguageGroup =
  | 'ru_kz'
  | 'ru_en_uz'
  | 'ru_tr'
  | 'ru_de_fr'
  | 'ru_es_it'
  | 'ru_zh_ar'
  | 'ru_ko'
  | 'ru_ja_th'
  | 'kz_en'
  | 'kz_uz'
  | 'kz_tr'
  | 'kz_de_fr'
  | 'kz_es_it'
  | 'kz_zh_ar'
  | 'kz_ko'
  | 'kz_ja_th'
  | 'other';

// ─── LEGACY (electronic-only as of the 2026-07-17 formula rewrite) ────────────────────────────
// BASE_MINIMUM_KZT/BASE_MINIMUM_KZT_SOURCE, EXTRA_WORD_RATE_KZT, ADDITIONAL_PAGE_RATE_KZT,
// URGENCY_COEFFICIENT, SCAN_QUALITY_SURCHARGE, LAYOUT_COMPLEXITY_CONFIG, VISUAL_MARKS_FEE_KZT,
// PRESENTATION_SLIDE_FEE_KZT, and MARGIN_FLOOR_CONFIG below are used ONLY by the electronic
// pricing path (calculateElectronicPrice in calculator.ts) going forward. The new flat formula
// for official_with_translator_signature_and_provider_stamp/notarization_through_partners (see
// calculateOfficialNotaryPrice) does not read any of these — it uses pricing_language_rates +
// the new scalar fields on pricing_versions instead (migration 0049/0050). Kept here, unchanged,
// because electronic's calculation must remain byte-identical to before this rewrite — do not
// remove or repurpose any of these for the new formula. A test in calculator.test.ts proves the
// new official/notary path never reads BASE_MINIMUM_KZT.<group>.official/
// .notarization_through_partners specifically.
//
// Source rates: electronic and official tiers only. Notarization is NOT a separate translation
// base tier — a notarized order's translation/service layer is priced identically to official;
// notary_official_fee, notary_coordination_fee, printing_binding_fee, and delivery_fee are
// separate add-ons layered on top by the calculator (see calculator.ts §7-8, §17-19). Keeping
// only electronic/official here and deriving notarization_through_partners below (rather than
// hardcoding a third, independently-maintained figure) makes it structurally impossible for the
// two to drift apart. See docs/ai-context/DECISIONS.md (2026-07-04, notarized base minimum fix).
const BASE_MINIMUM_KZT_SOURCE: Record<LanguageGroup, { electronic: number; official: number }> = {
  ru_kz:    { electronic: 1000, official: 5500 },
  ru_en_uz: { electronic: 1000, official: 6500 },
  ru_tr:    { electronic: 1000, official: 7500 },
  ru_de_fr: { electronic: 1000, official: 8000 },
  ru_es_it: { electronic: 1000, official: 8500 },
  ru_zh_ar: { electronic: 1000, official: 9500 },
  ru_ko:    { electronic: 1000, official: 10500 },
  ru_ja_th: { electronic: 1000, official: 11500 },
  kz_en:    { electronic: 1000, official: 7500 },
  kz_uz:    { electronic: 1000, official: 7000 },
  kz_tr:    { electronic: 1000, official: 8500 },
  kz_de_fr: { electronic: 1000, official: 9500 },
  kz_es_it: { electronic: 1000, official: 10000 },
  kz_zh_ar: { electronic: 1000, official: 11000 },
  kz_ko:    { electronic: 1000, official: 12500 },
  kz_ja_th: { electronic: 1000, official: 13500 },
  other:    { electronic: 1000, official: 7500 },
};

export const BASE_MINIMUM_KZT: Record<LanguageGroup, Record<ServiceLevel, number>> = Object.fromEntries(
  (Object.entries(BASE_MINIMUM_KZT_SOURCE) as [LanguageGroup, { electronic: number; official: number }][]).map(
    ([group, rates]) => [
      group,
      {
        electronic: rates.electronic,
        official_with_translator_signature_and_provider_stamp: rates.official,
        notarization_through_partners: rates.official,
      },
    ],
  ),
) as Record<LanguageGroup, Record<ServiceLevel, number>>;

export const EXTRA_WORD_RATE_KZT: Record<LanguageGroup, Record<'electronic' | 'official', number>> = {
  ru_kz:    { electronic: 5,  official: 18 },
  ru_en_uz: { electronic: 5,  official: 22 },
  ru_tr:    { electronic: 6,  official: 26 },
  ru_de_fr: { electronic: 7,  official: 28 },
  ru_es_it: { electronic: 7,  official: 30 },
  ru_zh_ar: { electronic: 8,  official: 33 },
  ru_ko:    { electronic: 10, official: 40 },
  ru_ja_th: { electronic: 10, official: 42 },
  kz_en:    { electronic: 5,  official: 22 },
  kz_uz:    { electronic: 5,  official: 20 },
  kz_tr:    { electronic: 6,  official: 28 },
  kz_de_fr: { electronic: 7,  official: 32 },
  kz_es_it: { electronic: 7,  official: 35 },
  kz_zh_ar: { electronic: 8,  official: 38 },
  kz_ko:    { electronic: 10, official: 42 },
  kz_ja_th: { electronic: 10, official: 45 },
  other:    { electronic: 6,  official: 25 },
};

export const ADDITIONAL_PAGE_RATE_KZT: Record<'electronic' | 'official', Record<'simple' | 'complex', number>> = {
  electronic: { simple: 500,  complex: 1000 },
  official:   { simple: 1000, complex: 1500 },
};

export const DOCUMENT_TYPE_COEFFICIENT: Record<string, number> = {
  passport_id:        1.00,
  driver_license:     1.00,
  police_clearance:   1.05,
  visa_documents:     1.10,
  certificate:        1.10,
  birth_certificate:  1.10,
  marriage_certificate: 1.10,
  bank_statement:     1.20,
  diploma:            1.20,
  diploma_transcript: 1.30,
  employment_document: 1.30,
  contract:           1.40,
  medical_document:   1.50,
  presentation:       1.60,
  other:              1.10,
};

export const URGENCY_COEFFICIENT: Record<UrgencyLevel, number | 'operator_review'> = {
  standard:             1.00,
  within_24h:           1.30,
  six_to_twelve_hours:  1.60,
  two_to_four_hours:    2.00,
  night_or_weekend:     1.50,
};

// Scan quality surcharge — multiplied against translation portion
export const SCAN_QUALITY_SURCHARGE: Record<ScanQuality, number | 'operator_review'> = {
  normal:      0,
  poor_scan:   0.15,
  handwritten: 'operator_review',
};

// Layout complexity — fixed fee per page or multiplier on translation portion
export type LayoutComplexityConfig =
  | { type: 'fixed_per_page'; feePerPage: number }
  | { type: 'translation_portion_multiplier'; multiplier: number }
  | { type: 'operator_review' };

export const LAYOUT_COMPLEXITY_CONFIG: Record<LayoutComplexity, LayoutComplexityConfig> = {
  standard:       { type: 'fixed_per_page', feePerPage: 0 },
  tables:         { type: 'fixed_per_page', feePerPage: 1000 },
  complex_tables: { type: 'fixed_per_page', feePerPage: 2000 },
  complex_layout: { type: 'translation_portion_multiplier', multiplier: 0.25 },
};

/** Per-slide fee for presentation documents (per additional slide beyond the 1st). */
export const PRESENTATION_SLIDE_FEE_KZT: Record<'electronic' | 'official' | 'notarized', number> = {
  electronic: 500,
  official:   1000,
  notarized:  1000,
};

// Visual marks surcharge — flat fee added to subtotal
export const VISUAL_MARKS_FEE_KZT: Record<VisualMarksComplexity, number> = {
  normal:      0,
  many_stamps: 1000,
};

// Delivery zone fee — overrides the legacy NOTARY_CONFIG.deliveryFeeAlmatyStandard
export const DELIVERY_ZONE_FEE_KZT: Record<DeliveryZone, number | 'operator_review'> = {
  almaty_standard: 2500,
  remote_area:     'operator_review',
  other_city:      'operator_review',
  urgent_delivery: 'operator_review',
};

// Notary MRP coefficient by applicant type — overrides NOTARY_CONFIG mrpCoefficient_individual
export const NOTARY_APPLICANT_MRP_COEFFICIENT: Record<ApplicantType, number | 'operator_review'> = {
  individual:   0.53,
  legal_entity: 1.10,
  unknown:      'operator_review',
};

export const EXTRA_PAPER_COPY_FEE_KZT = 500;

// TODO: mrpCoefficient_*, printingBindingFee, deliveryFeeAlmatyStandard require confirmation
// from notary partner before production launch.
export const NOTARY_CONFIG = {
  mrpCoefficient_individual:    0.53,
  mrpCoefficient_legal_entity:  1.10,
  // WPO's own fixed commercial fee for handling/coordinating the notary process — a business
  // decision, NOT inferred from MRP and NOT the same as notary_official_fee (the official
  // notary tariff, MRP-based, paid to the notary). See docs/ai-context/DECISIONS.md (2026-07-03).
  notaryCoordinationFeeDefault: 5000,
  // The REAL internal cost of coordinating with the notary — 0 today (not configured/known).
  // NOT the same as notaryCoordinationFeeDefault above (that's the client-facing WPO revenue).
  // Change this only when there is an actual, confirmed internal cost to book.
  notaryCoordinationInternalCostKzt: 0,
  printingBindingFee:           500,
  deliveryFeeAlmatyStandard:    2500,
  // Fallback MRP tariff in KZT (NOT thousands) — used only when pricing_versions.mrp_value is
  // null. Current 2026 MRP ≈ 4,325 KZT. `version.mrpValue` (from pricing_versions.mrp_value)
  // keeps its existing "value stored in thousands of KZT" convention and is NOT affected by
  // this fallback — updating the live figure requires a data update to that DB column
  // (not a schema migration), which is outside the scope of a code change.
  mrpValueFallbackKzt: 4325,
};

export const PRICE_ROUNDING_INCREMENT = 100;

// ─── Margin floor (commercial floor) — LEGACY, electronic-only as of 2026-07-17 ────────────────
// Automatic pricing floor: if estimated margin after internal costs/reserves
// falls below targetMarginRate, the calculator raises the final price via a
// margin_floor_adjustment line item. This never blocks checkout — it only
// adjusts the price before the quote is shown/saved. See docs/ai-context/DECISIONS.md.
// The official_with_translator_signature_and_provider_stamp/notarization_through_partners
// entries below are read only by pre-2026-07-17 quotes replayed for audit — the new formula
// removes the margin-floor mechanism from the customer price entirely (see
// docs/ai-context/DECISIONS.md, 2026-07-17). Only the `electronic` entries are read going forward.
export const MARGIN_FLOOR_CONFIG = {
  enableMarginFloor: true,
  // Same target for all service levels today; kept as a per-level map so an
  // override (e.g. a lower floor for electronic) doesn't require a code change.
  targetMarginRate: {
    electronic: 0.50,
    official_with_translator_signature_and_provider_stamp: 0.50,
    notarization_through_partners: 0.50,
  } as Record<ServiceLevel, number>,
  // Rounding increment applied only when the margin floor bumps the price
  // above the normal PRICE_ROUNDING_INCREMENT-rounded amount.
  roundingKzt: {
    electronic: 100,
    official_with_translator_signature_and_provider_stamp: 100,
    notarization_through_partners: 500,
  } as Record<ServiceLevel, number>,
};

export const NOTARY_URGENCY_CONFIG = {
  standard:             { multiplier: 1.0 },
  same_day_before_noon: { multiplier: 1.0, cutoffHour: 12 },
  same_day_after_noon:  { multiplier: 1.5, cutoffHour: 18 },
  same_day_after_18:    { multiplier: 2.0, windowHours: 2 },
} as const;

// ─── New flat formula (2026-07-17 rewrite) — official/notary only ─────────────────────────────
// All scalar rates/fees for the new formula live on pricing_versions (migration 0049) and
// pricing_language_rates (migration 0050) — DB-editable, versioned, never a magic number in
// calculator.ts. These two constants are the only new pure-config values, since 1800 chars/page
// and a 1-page minimum are structural facts about the formula itself, not a business rate that
// changes per pricing version.
export const TRANSLATION_PAGE_CHAR_DIVISOR = 1800;
export const MIN_TRANSLATION_PAGES = 1;

// ─── Language resolution ───────────────────────────────────────────────────────

const RU = ['ru', 'russian'];
const KZ = ['kk', 'kz', 'kazakh'];
const EN = ['en', 'english'];
const UZ = ['uz', 'uzbek'];
const TR = ['tr', 'turkish'];
const DE = ['de', 'german'];
const FR = ['fr', 'french'];
const ES = ['es', 'spanish'];
const IT = ['it', 'italian'];
const ZH = ['zh', 'chinese', 'zh-hans', 'zh-hant'];
const AR = ['ar', 'arabic'];
const KO = ['ko', 'korean'];
const JA = ['ja', 'japanese'];
const TH = ['th', 'thai'];

const has = (list: string[], l: string) => list.includes(l);

// Every language code the pricing engine recognizes. A pair outside the 16 named
// groups still gets an automatic quote via the 'other' bucket as long as both sides
// are recognized codes — only a genuinely unrecognized code (e.g. 'auto', empty,
// a typo) should block on operator review, since we can't safely price what we can't
// identify as a language.
const KNOWN_CODES = [...RU, ...KZ, ...EN, ...UZ, ...TR, ...DE, ...FR, ...ES, ...IT, ...ZH, ...AR, ...KO, ...JA, ...TH];
const isKnownCode = (l: string) => KNOWN_CODES.includes(l);

export function resolveLanguageGroup(
  sourceLang: string,
  targetLang: string,
): { group: LanguageGroup; requiresReview: boolean } {
  const src = sourceLang.toLowerCase();
  const tgt = targetLang.toLowerCase();

  // RU ↔ KZ
  if ((has(RU, src) && has(KZ, tgt)) || (has(KZ, src) && has(RU, tgt))) {
    return { group: 'ru_kz', requiresReview: false };
  }

  // RU pairs
  if (has(RU, src) || has(RU, tgt)) {
    const other = has(RU, src) ? tgt : src;
    if (has(EN, other) || has(UZ, other)) return { group: 'ru_en_uz',  requiresReview: false };
    if (has(TR, other))                   return { group: 'ru_tr',     requiresReview: false };
    if (has(DE, other) || has(FR, other)) return { group: 'ru_de_fr',  requiresReview: false };
    if (has(ES, other) || has(IT, other)) return { group: 'ru_es_it',  requiresReview: false };
    if (has(ZH, other) || has(AR, other)) return { group: 'ru_zh_ar',  requiresReview: false };
    if (has(KO, other))                   return { group: 'ru_ko',     requiresReview: false };
    if (has(JA, other) || has(TH, other)) return { group: 'ru_ja_th',  requiresReview: false };
    return { group: 'other', requiresReview: !isKnownCode(other) };
  }

  // KZ pairs
  if (has(KZ, src) || has(KZ, tgt)) {
    const other = has(KZ, src) ? tgt : src;
    if (has(EN, other))                   return { group: 'kz_en',    requiresReview: false };
    if (has(UZ, other))                   return { group: 'kz_uz',    requiresReview: false };
    if (has(TR, other))                   return { group: 'kz_tr',    requiresReview: false };
    if (has(DE, other) || has(FR, other)) return { group: 'kz_de_fr', requiresReview: false };
    if (has(ES, other) || has(IT, other)) return { group: 'kz_es_it', requiresReview: false };
    if (has(ZH, other) || has(AR, other)) return { group: 'kz_zh_ar', requiresReview: false };
    if (has(KO, other))                   return { group: 'kz_ko',    requiresReview: false };
    if (has(JA, other) || has(TH, other)) return { group: 'kz_ja_th', requiresReview: false };
    return { group: 'other', requiresReview: !isKnownCode(other) };
  }

  // Neither side is RU or KZ (e.g. en↔de, zh↔ja) — still price via 'other' as long as
  // both codes are recognized languages.
  return { group: 'other', requiresReview: !(isKnownCode(src) && isKnownCode(tgt)) };
}
