import type { ServiceLevel } from '@/lib/translation-prompts/types';

/**
 * Fixed KZT pricing per service level for card payment orders.
 * These are whole tenge values (integer, no tiyn).
 */
export const CARD_PAYMENT_PRICES_KZT: Record<ServiceLevel, number> = {
  electronic: 1999,
  official_with_translator_signature_and_provider_stamp: 3999,
  notarization_through_partners: 6999,
};

export function getPriceKzt(serviceLevel: ServiceLevel): number {
  return CARD_PAYMENT_PRICES_KZT[serviceLevel];
}
