/**
 * LEGACY: Fixed KZT pricing per service level.
 * These were the original test prices used before the dynamic pricing engine was implemented.
 *
 * @deprecated Use `src/lib/pricing/service.ts` → `computeQuoteForJob()` instead.
 * These constants MUST NOT be used in production payment flows.
 * They are retained only for: dev/test reference, fallback display, legacy data lookups.
 *
 * Production payment amount must always come from a price_quotes row.
 * See docs/finance/FINANCIAL_ARCHITECTURE.md for the quote lifecycle.
 */
import type { ServiceLevel } from '@/lib/translation-prompts/types';

export const CARD_PAYMENT_PRICES_KZT_LEGACY: Record<ServiceLevel, number> = {
  electronic: 1999,
  official_with_translator_signature_and_provider_stamp: 3999,
  notarization_through_partners: 6999,
};

/** @deprecated Use computeQuoteForJob() from src/lib/pricing/service.ts */
export function getPriceKztLegacy(serviceLevel: ServiceLevel): number {
  return CARD_PAYMENT_PRICES_KZT_LEGACY[serviceLevel];
}

// Kept for backward-compat references — do not use in new payment code
export const CARD_PAYMENT_PRICES_KZT = CARD_PAYMENT_PRICES_KZT_LEGACY;
/** @deprecated */
export const getPriceKzt = getPriceKztLegacy;
