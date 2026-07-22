/**
 * CLI-friendly aliases -> the project's real canonical enums (src/lib/pricing/types.ts). This
 * tool never invents new enum values — see tools/internal-ai-test-lab/lib/alias-map.ts for the
 * established precedent of this pattern in this repo.
 */
import type { ServiceLevel } from '@/lib/pricing/types';
import type { UrgencyAlias } from './types';

const SERVICE_LEVEL_ALIASES: Record<string, ServiceLevel> = {
  electronic: 'electronic',
  official: 'official_with_translator_signature_and_provider_stamp',
  official_translation: 'official_with_translator_signature_and_provider_stamp',
  official_with_translator_signature_and_provider_stamp: 'official_with_translator_signature_and_provider_stamp',
  notary: 'notarization_through_partners',
  notarized: 'notarization_through_partners',
  notarization: 'notarization_through_partners',
  notarization_through_partners: 'notarization_through_partners',
};

export function resolveServiceLevel(value: string): ServiceLevel | null {
  return SERVICE_LEVEL_ALIASES[value.trim().toLowerCase()] ?? null;
}

const URGENCY_ALIASES: Record<string, UrgencyAlias> = {
  standard: 'standard',
  same_day: 'same_day',
  before_noon: 'before_noon',
  after_noon: 'after_noon',
  after_18: 'after_18',
};

export function resolveUrgency(value: string): UrgencyAlias | null {
  return URGENCY_ALIASES[value.trim().toLowerCase()] ?? null;
}

/** Splits the CLI urgency alias into calculatePrice()'s notaryUrgencyLevel + window override. */
export function splitUrgency(urgency: UrgencyAlias): {
  notaryUrgencyLevel: 'standard' | 'same_day';
  notaryUrgencyWindowOverride: 'before_noon' | 'after_noon' | 'after_18' | undefined;
} {
  if (urgency === 'standard') return { notaryUrgencyLevel: 'standard', notaryUrgencyWindowOverride: undefined };
  if (urgency === 'same_day') return { notaryUrgencyLevel: 'same_day', notaryUrgencyWindowOverride: undefined };
  return { notaryUrgencyLevel: 'same_day', notaryUrgencyWindowOverride: urgency };
}

/**
 * Deterministic ISO timestamp that resolves to the requested Almaty notary-cutoff window —
 * ported verbatim from the deleted Pricing Lab calculate route (git a24b45bf), so the
 * before_noon/after_noon/after_18 fixtures reproduce exactly.
 */
export function buildNowOverride(window: 'before_noon' | 'after_noon' | 'after_18' | undefined): string | undefined {
  if (!window) return undefined;
  const now = new Date();
  const hourUtc = window === 'before_noon' ? 3 : window === 'after_noon' ? 9 : 15; // Almaty = UTC+5
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc, 0, 0)).toISOString();
}

const APPLICANT_TYPE_ALIASES: Record<string, 'individual' | 'legal_entity'> = {
  individual: 'individual',
  person: 'individual',
  legal_entity: 'legal_entity',
  company: 'legal_entity',
  legal: 'legal_entity',
};

export function resolveApplicantType(value: string): 'individual' | 'legal_entity' | null {
  return APPLICANT_TYPE_ALIASES[value.trim().toLowerCase()] ?? null;
}

const CHANNEL_ALIASES: Record<string, 'direct' | 'referral'> = {
  direct: 'direct',
  referral: 'referral',
};

export function resolveChannel(value: string): 'direct' | 'referral' | null {
  return CHANNEL_ALIASES[value.trim().toLowerCase()] ?? null;
}
