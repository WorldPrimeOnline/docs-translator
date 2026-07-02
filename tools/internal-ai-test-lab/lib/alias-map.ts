/**
 * Maps friendly CLI aliases to the project's existing canonical enums.
 *
 * This tool must reuse existing pricing/translation enums verbatim — it never
 * invents new service levels or document types. Canonical values are copied
 * from (and must stay in sync with):
 *   - src/lib/pricing/types.ts            (ServiceLevel, UrgencyLevel)
 *   - worker/src/lib/output-plan.ts       (ServiceLevel)
 *   - worker/src/lib/translation-prompts/types.ts (DocumentType / DOCUMENT_TYPE)
 */
import type {
  CanonicalDocumentType,
  CanonicalFulfillmentMethod,
  CanonicalServiceLevel,
  CanonicalUrgencyLevel,
} from './types';

export class AliasMapError extends Error {}

// ─── Service level ──────────────────────────────────────────────────────────

const SERVICE_LEVEL_ALIASES: Record<string, CanonicalServiceLevel> = {
  electronic: 'electronic',

  official_translation: 'official_with_translator_signature_and_provider_stamp',
  official: 'official_with_translator_signature_and_provider_stamp',
  official_with_translator_signature_and_provider_stamp:
    'official_with_translator_signature_and_provider_stamp',

  notarized: 'notarization_through_partners',
  notarization: 'notarization_through_partners',
  notarization_through_partners: 'notarization_through_partners',
};

export function mapServiceLevel(raw: string): CanonicalServiceLevel {
  const key = raw.trim().toLowerCase();
  const mapped = SERVICE_LEVEL_ALIASES[key];
  if (!mapped) {
    throw new AliasMapError(
      `Unknown --service-level "${raw}". Supported aliases: ${Object.keys(SERVICE_LEVEL_ALIASES).join(', ')}`,
    );
  }
  return mapped;
}

// ─── Document type ──────────────────────────────────────────────────────────

const DOCUMENT_TYPE_ALIASES: Record<string, CanonicalDocumentType> = {
  passport: 'passport_id',
  passport_id: 'passport_id',
  id_card: 'passport_id',

  diploma: 'diploma_transcript',
  transcript: 'diploma_transcript',
  diploma_transcript: 'diploma_transcript',

  contract: 'contract',
  employment_contract: 'contract',

  bank_statement: 'bank_statement',
  bank: 'bank_statement',

  medical: 'medical_document',
  medical_document: 'medical_document',
  medical_certificate: 'medical_document',

  employment: 'employment_document',
  employment_document: 'employment_document',
  employment_letter: 'employment_document',

  police_clearance: 'police_clearance',
  police: 'police_clearance',

  visa: 'visa_documents',
  visa_documents: 'visa_documents',

  driver_license: 'driver_license',
  driving_license: 'driver_license',
  driver: 'driver_license',

  presentation: 'presentation',

  // No dedicated canonical type exists for these yet — fall back to 'other'.
  // (See PROJECT_CONTEXT.md §9 document list vs. the narrower pricing/translation
  // DocumentType enum — birth/marriage certs are not first-class enum members.)
  birth_certificate: 'other',
  marriage_certificate: 'other',
  divorce_certificate: 'other',
  other: 'other',
};

/** Aliases resolved to 'other' as a lossy fallback rather than an exact canonical match. */
export const DOCUMENT_TYPE_FALLBACK_ALIASES = new Set(['birth_certificate', 'marriage_certificate', 'divorce_certificate']);

export function mapDocumentType(raw: string): CanonicalDocumentType {
  const key = raw.trim().toLowerCase();
  const mapped = DOCUMENT_TYPE_ALIASES[key];
  if (!mapped) {
    throw new AliasMapError(
      `Unknown --document-type "${raw}". Supported aliases: ${Object.keys(DOCUMENT_TYPE_ALIASES).join(', ')}`,
    );
  }
  return mapped;
}

// ─── Urgency ─────────────────────────────────────────────────────────────────

const URGENCY_ALIASES: Record<string, CanonicalUrgencyLevel> = {
  standard: 'standard',
  within_24h: 'within_24h',
  '24h': 'within_24h',
  express: 'six_to_twelve_hours',
  six_to_twelve_hours: 'six_to_twelve_hours',
  rush: 'two_to_four_hours',
  two_to_four_hours: 'two_to_four_hours',
  night_or_weekend: 'night_or_weekend',
  overnight: 'night_or_weekend',
};

export function mapUrgencyLevel(raw: string | undefined): CanonicalUrgencyLevel {
  if (!raw) return 'standard';
  const key = raw.trim().toLowerCase();
  const mapped = URGENCY_ALIASES[key];
  if (!mapped) {
    throw new AliasMapError(
      `Unknown --urgency "${raw}". Supported aliases: ${Object.keys(URGENCY_ALIASES).join(', ')}`,
    );
  }
  return mapped;
}

// ─── Fulfillment method ─────────────────────────────────────────────────────

const FULFILLMENT_ALIASES: Record<string, CanonicalFulfillmentMethod> = {
  pickup: 'pickup',
  delivery: 'delivery',
};

export function mapFulfillmentMethod(raw: string | undefined): CanonicalFulfillmentMethod | undefined {
  if (!raw) return undefined;
  const key = raw.trim().toLowerCase();
  const mapped = FULFILLMENT_ALIASES[key];
  if (!mapped) {
    throw new AliasMapError(
      `Unknown --fulfillment-method "${raw}". Supported values: ${Object.keys(FULFILLMENT_ALIASES).join(', ')}`,
    );
  }
  return mapped;
}

// ─── Delivery zone heuristic ─────────────────────────────────────────────────
// PricingInput has no raw "city" field — only a coarse deliveryZone enum. This
// heuristic maps a free-text city name onto that enum. It is NOT authoritative
// geocoding; the raw city string is always preserved separately in the report
// for human review.

export type CanonicalDeliveryZone = 'almaty_standard' | 'remote_area' | 'other_city' | 'urgent_delivery';

export function inferDeliveryZone(deliveryCity: string | undefined): CanonicalDeliveryZone | undefined {
  if (!deliveryCity) return undefined;
  const city = deliveryCity.trim().toLowerCase();
  if (city === 'almaty' || city === 'алматы') return 'almaty_standard';
  return 'other_city';
}
