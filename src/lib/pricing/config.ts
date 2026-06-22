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

export const BASE_MINIMUM_KZT: Record<LanguageGroup, Record<ServiceLevel, number>> = {
  ru_kz:    { electronic: 2500, official_with_translator_signature_and_provider_stamp: 5500,  notarization_through_partners: 11000 },
  ru_en_uz: { electronic: 2500, official_with_translator_signature_and_provider_stamp: 6500,  notarization_through_partners: 12000 },
  ru_tr:    { electronic: 3000, official_with_translator_signature_and_provider_stamp: 7500,  notarization_through_partners: 13000 },
  ru_de_fr: { electronic: 3000, official_with_translator_signature_and_provider_stamp: 8000,  notarization_through_partners: 13500 },
  ru_es_it: { electronic: 3500, official_with_translator_signature_and_provider_stamp: 8500,  notarization_through_partners: 14000 },
  ru_zh_ar: { electronic: 3500, official_with_translator_signature_and_provider_stamp: 9500,  notarization_through_partners: 15000 },
  ru_ko:    { electronic: 4000, official_with_translator_signature_and_provider_stamp: 10500, notarization_through_partners: 16000 },
  ru_ja_th: { electronic: 4000, official_with_translator_signature_and_provider_stamp: 11500, notarization_through_partners: 17000 },
  kz_en:    { electronic: 3000, official_with_translator_signature_and_provider_stamp: 7500,  notarization_through_partners: 13000 },
  kz_uz:    { electronic: 3000, official_with_translator_signature_and_provider_stamp: 7000,  notarization_through_partners: 12500 },
  kz_tr:    { electronic: 3500, official_with_translator_signature_and_provider_stamp: 8500,  notarization_through_partners: 14000 },
  kz_de_fr: { electronic: 3500, official_with_translator_signature_and_provider_stamp: 9500,  notarization_through_partners: 15000 },
  kz_es_it: { electronic: 4000, official_with_translator_signature_and_provider_stamp: 10000, notarization_through_partners: 15500 },
  kz_zh_ar: { electronic: 4000, official_with_translator_signature_and_provider_stamp: 11000, notarization_through_partners: 16500 },
  kz_ko:    { electronic: 4500, official_with_translator_signature_and_provider_stamp: 12500, notarization_through_partners: 18000 },
  kz_ja_th: { electronic: 4500, official_with_translator_signature_and_provider_stamp: 13500, notarization_through_partners: 19000 },
  other:    { electronic: 3000, official_with_translator_signature_and_provider_stamp: 7500,  notarization_through_partners: 13000 },
};

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
  presentation:   { type: 'operator_review' },
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

// TODO: All NOTARY_CONFIG values require confirmation from notary partner before production launch.
export const NOTARY_CONFIG = {
  mrpCoefficient_individual:    0.53,
  mrpCoefficient_legal_entity:  1.10,
  notaryCoordinationFeeDefault: 3000,
  printingBindingFee:           500,
  deliveryFeeAlmatyStandard:    2500,
};

export const PRICE_ROUNDING_INCREMENT = 100;

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
    return { group: 'other', requiresReview: true };
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
    return { group: 'other', requiresReview: true };
  }

  return { group: 'other', requiresReview: true };
}
