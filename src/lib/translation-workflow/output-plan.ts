import type { ServiceLevel } from '../translation-prompts/types';
import type { OutputPlan } from './types';

/**
 * Derive OutputPlan from ServiceLevel (primary) with boolean notarized fallback
 * for backward compatibility with pre-migration jobs.
 *
 * Both `official_with_translator_signature_and_provider_stamp` and
 * `notarization_through_partners` produce a translator_review_draft.
 * Only `notarization_through_partners` proceeds to the notary stage afterward.
 */
export function computeOutputPlan(
  serviceLevelOrNotarized: ServiceLevel | boolean | null | undefined,
): OutputPlan {
  const level = resolveServiceLevel(serviceLevelOrNotarized);

  if (level === 'notarization_through_partners') {
    return {
      mode: 'notarization_package',
      requiresHumanReview: true,
      requiresNotaryReview: true,
      generateDocx: true,
      generatePreviewPdf: true,
      generateFinalPdf: false,
      releaseToCustomerImmediately: false,
    };
  }

  if (level === 'official_with_translator_signature_and_provider_stamp') {
    return {
      mode: 'translator_review_draft',
      requiresHumanReview: true,
      requiresNotaryReview: false,
      generateDocx: true,
      generatePreviewPdf: true,
      generateFinalPdf: false,
      releaseToCustomerImmediately: false,
    };
  }

  // electronic
  return {
    mode: 'translation_only',
    requiresHumanReview: false,
    requiresNotaryReview: false,
    generateDocx: false,
    generatePreviewPdf: false,
    generateFinalPdf: true,
    releaseToCustomerImmediately: true,
  };
}

function resolveServiceLevel(
  input: ServiceLevel | boolean | null | undefined,
): ServiceLevel {
  if (typeof input === 'boolean') {
    // Legacy boolean path: notarized=true → notarization_through_partners
    return input ? 'notarization_through_partners' : 'electronic';
  }
  return input ?? 'electronic';
}

/**
 * Derive legacy boolean fields from ServiceLevel for backward compatibility.
 * New code should read service_level; these are only for old queries.
 */
export function deriveBackcompatBooleans(level: ServiceLevel): {
  notarized: boolean;
  bureau_stamp: boolean;
} {
  switch (level) {
    case 'notarization_through_partners':
      return { notarized: true, bureau_stamp: true };
    case 'official_with_translator_signature_and_provider_stamp':
      return { notarized: false, bureau_stamp: true };
    default:
      return { notarized: false, bureau_stamp: false };
  }
}
