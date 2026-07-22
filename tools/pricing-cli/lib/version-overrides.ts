/**
 * In-memory-only pricing_versions overrides — salvaged from the deleted internal Pricing Lab
 * web tool (2026-07-20 removal). Applied on top of a resolved PricingVersion inside this CLI
 * process only; never written back to Supabase, never touches pricing_versions.status.
 *
 * NOT overridable here: the notary applicant-type MRP coefficient
 * (NOTARY_APPLICANT_MRP_COEFFICIENT in src/lib/pricing/config.ts) — it is a module-level
 * constant, not a PricingVersion field, and calculatePrice() takes no config-override
 * parameter. Overriding it would mean monkey-patching a frozen/shared pipeline module, which
 * this tool deliberately never does (see README "What NOT to do").
 */
import type { PricingVersion } from '@/lib/pricing/types';

export interface VersionOverrides {
  taxRate?: number;
  acquiringRate?: number;
  riskReserveRate?: number;
  ownerReserveRate?: number;
  marketingRateDirect?: number;
  aiItRate?: number;
  channelReserveRate?: number;
  clientDiscountRate?: number;
  wpoCoordinationRate?: number;
  translatorPayoutRate?: number;
  partnerCommissionRate?: number;
  ocrRatePerPhysicalPageKzt?: number;
  courierFeeKzt?: number;
  printingFeeKzt?: number;
  extraPaperCopyFeeKzt?: number;
  roundingStepOfficialKzt?: number;
  roundingStepNotaryKzt?: number;
  mrpValue?: number;
}

export const VERSION_OVERRIDE_KEYS: Array<keyof VersionOverrides> = [
  'ocrRatePerPhysicalPageKzt', 'translatorPayoutRate', 'wpoCoordinationRate', 'mrpValue',
  'courierFeeKzt', 'printingFeeKzt', 'taxRate', 'acquiringRate', 'riskReserveRate',
  'marketingRateDirect', 'aiItRate', 'ownerReserveRate', 'channelReserveRate',
  'clientDiscountRate', 'partnerCommissionRate', 'roundingStepOfficialKzt', 'roundingStepNotaryKzt',
];

/** CLI flag name (--<flag>) for each override key, for --help text and cli-args parsing. */
export const VERSION_OVERRIDE_FLAGS: Record<keyof VersionOverrides, string> = {
  taxRate: 'override-tax-rate',
  acquiringRate: 'override-acquiring-rate',
  riskReserveRate: 'override-risk-reserve-rate',
  ownerReserveRate: 'override-owner-reserve-rate',
  marketingRateDirect: 'override-marketing-rate',
  aiItRate: 'override-ai-it-rate',
  channelReserveRate: 'override-channel-reserve-rate',
  clientDiscountRate: 'override-discount-rate',
  wpoCoordinationRate: 'override-wpo-coordination-rate',
  translatorPayoutRate: 'override-translator-payout-rate',
  partnerCommissionRate: 'override-partner-commission-rate',
  ocrRatePerPhysicalPageKzt: 'override-ocr-rate',
  courierFeeKzt: 'override-courier-fee',
  printingFeeKzt: 'override-printing-fee',
  extraPaperCopyFeeKzt: 'override-extra-copy-fee',
  roundingStepOfficialKzt: 'override-rounding-step-official',
  roundingStepNotaryKzt: 'override-rounding-step-notary',
  mrpValue: 'override-mrp',
};

export const VERSION_OVERRIDE_LABELS: Record<keyof VersionOverrides, string> = {
  ocrRatePerPhysicalPageKzt: 'OCR (₸/физ.стр.)',
  translatorPayoutRate: 'Выплата переводчику',
  wpoCoordinationRate: 'Комиссия WPO',
  mrpValue: 'МРП (в тысячах ₸)',
  courierFeeKzt: 'Курьер (₸)',
  printingFeeKzt: 'Печать (₸)',
  extraPaperCopyFeeKzt: 'Доп. копия (₸)',
  taxRate: 'Налог',
  acquiringRate: 'Halyk (эквайринг)',
  riskReserveRate: 'Риск',
  marketingRateDirect: 'Маркетинг/CAC',
  aiItRate: 'AI/IT',
  ownerReserveRate: 'Резерв владельцев',
  channelReserveRate: 'Канальный резерв',
  clientDiscountRate: 'Скидка клиенту (Referral)',
  partnerCommissionRate: 'Комиссия партнёру (fallback)',
  roundingStepOfficialKzt: 'Округление (official)',
  roundingStepNotaryKzt: 'Округление (notary)',
};

/** Merges overrides onto a resolved PricingVersion IN MEMORY ONLY. Never mutates the input. */
export function applyVersionOverrides(version: PricingVersion, overrides: VersionOverrides): PricingVersion {
  return { ...version, ...overrides };
}

export function hasAnyOverride(overrides: VersionOverrides): boolean {
  return Object.keys(overrides).length > 0;
}
