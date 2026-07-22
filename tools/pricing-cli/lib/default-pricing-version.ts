/**
 * Built-in "safe default" pricing version — a literal copy of the WPO-approved
 * '2026-Q3-KZ-NEWMODEL' draft seed (supabase/migrations/0051, 0056, 0057, 0058), so that running
 * this CLI with no --config and no --from-staging still reproduces the approved worked examples
 * (see fixtures.ts) out of the box, entirely offline.
 *
 * This is a local copy for CLI convenience only — it never reads or writes the real
 * pricing_versions table. Use --from-staging to fetch the live row by code instead.
 */
import type { PricingVersion, PricingLanguageRate } from '@/lib/pricing/types';

export const DEFAULT_PRICING_VERSION_CODE = '2026-Q3-KZ-NEWMODEL';

export const DEFAULT_PRICING_VERSION: PricingVersion = {
  id: 'local-default',
  code: DEFAULT_PRICING_VERSION_CODE,
  status: 'draft',
  currency: 'KZT',
  internalFxRate: null,
  mrpValue: 4.325,
  taxRate: 0.03,
  acquiringRate: 0.025,
  riskReserveRate: 0.05,
  ownerReserveRate: 0.00,
  marketingRateDirect: 0.05,
  partnerCommissionRate: 0.10,
  targetProfitRate: 0.25,
  aiItReservePerPageKzt: 100.00,
  validFrom: '2026-07-17T00:00:00.000Z',
  validTo: null,
  metadata: { formula_version: 'new_2026_07_21', source: 'pricing-cli local default' },
  aiItRate: 0.10,
  channelReserveRate: 0.20,
  clientDiscountRate: 0.10,
  wpoCoordinationRate: 0.30,
  translatorPayoutRate: 0.30,
  ocrRatePerPhysicalPageKzt: 100.00,
  courierFeeKzt: 5000.00,
  printingFeeKzt: 0.00,
  extraPaperCopyFeeKzt: 0.00,
  roundingStepOfficialKzt: 100.00,
  roundingStepNotaryKzt: 500.00,
  publicElectronicPriceKzt: null,
  publicOfficialMinPriceKzt: null,
  publicNotaryMinPriceKzt: null,
};

/** RU -> X rate card, per the WPO-approved rate card (migration 0051). */
const RU_TARGET_RATES: Record<string, number> = {
  kk: 2000.00,
  uz: 3500.00,
  ky: 4000.00,
  uk: 3500.00,
  be: 5000.00,
  en: 3000.00,
  de: 5000.00,
  fr: 4000.00,
  it: 4000.00,
  zh: 5000.00,
  ko: 7000.00,
  tr: 4000.00,
  th: 10000.00,
  ar: 6000.00,
};

const RUSSIAN_ANCHOR_LANGUAGE = 'ru';

function normalizeLanguageCode(language: string): string {
  return language.trim().toLowerCase();
}

interface LocalBaseRate {
  language: string;
  rateId: string;
  rateKztPerTranslationPage: number;
  active: boolean;
  requiresOperatorReview: boolean;
}

function getLocalBaseRate(language: string): LocalBaseRate | null {
  const rate = RU_TARGET_RATES[language];
  if (rate == null) return null;
  return { language, rateId: `local-default-ru-${language}`, rateKztPerTranslationPage: rate, active: true, requiresOperatorReview: false };
}

/**
 * Mirrors src/lib/pricing/service.ts's getLanguageRate symmetric pair resolution (2026-07-26
 * decision), against this file's local RU_TARGET_RATES instead of the DB: RU_TARGET_RATES rows
 * are each language X's base rate relative to Russian, the anchor. A pair's rate is
 * max(base(source), base(target)), so EN<->ZH resolves from the same 14 rows without a
 * separately-listed EN->ZH entry. Returns null only when a non-Russian side has no base rate at
 * all (never fabricated).
 */
export function getDefaultLanguageRate(
  pricingVersionId: string,
  sourceLanguage: string,
  targetLanguage: string,
): PricingLanguageRate | null {
  const source = normalizeLanguageCode(sourceLanguage);
  const target = normalizeLanguageCode(targetLanguage);

  const sourceBaseRate = source === RUSSIAN_ANCHOR_LANGUAGE ? null : getLocalBaseRate(source);
  const targetBaseRate = target === RUSSIAN_ANCHOR_LANGUAGE ? null : getLocalBaseRate(target);

  if (source !== RUSSIAN_ANCHOR_LANGUAGE && !sourceBaseRate) return null;
  if (target !== RUSSIAN_ANCHOR_LANGUAGE && !targetBaseRate) return null;
  if (!sourceBaseRate && !targetBaseRate) return null;

  const sourceRateKzt = sourceBaseRate?.rateKztPerTranslationPage ?? 0;
  const targetRateKzt = targetBaseRate?.rateKztPerTranslationPage ?? 0;
  const winningSide: 'source' | 'target' = sourceRateKzt >= targetRateKzt ? 'source' : 'target';
  const winner = (winningSide === 'source' ? sourceBaseRate : targetBaseRate)!;

  return {
    id: winner.rateId,
    pricingVersionId,
    sourceLanguage: source,
    targetLanguage: target,
    rateKztPerTranslationPage: Math.max(sourceRateKzt, targetRateKzt),
    active: (sourceBaseRate?.active ?? true) && (targetBaseRate?.active ?? true),
    requiresOperatorReview: (sourceBaseRate?.requiresOperatorReview ?? false) || (targetBaseRate?.requiresOperatorReview ?? false),
    resolution: { sourceBaseRate, targetBaseRate, winningSide },
  };
}
