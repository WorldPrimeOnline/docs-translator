/**
 * Worker-local copy of output plan logic.
 * Keep in sync with src/lib/translation-workflow/output-plan.ts.
 */

export type ServiceLevel =
  | 'electronic'
  | 'official_with_translator_signature_and_provider_stamp'
  | 'notarization_through_partners';

export type OutputMode =
  | 'translation_only'
  | 'translator_review_draft'
  | 'notarization_package';

export interface OutputPlan {
  mode: OutputMode;
  requiresHumanReview: boolean;
  requiresNotaryReview: boolean;
  generateDocx: boolean;
  generatePreviewPdf: boolean;
  generateFinalPdf: boolean;
  releaseToCustomerImmediately: boolean;
}

function resolveServiceLevel(input: ServiceLevel | boolean | null | undefined): ServiceLevel {
  if (input === true) return 'notarization_through_partners';
  if (!input) return 'electronic';
  return input;
}

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
