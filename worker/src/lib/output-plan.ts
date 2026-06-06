/**
 * Worker-local copy of output plan logic.
 * Keep in sync with src/lib/translation-workflow/output-plan.ts.
 */

export type OutputMode =
  | 'translation_only'
  | 'translator_review_draft'
  | 'official_translation'
  | 'notarization_package';

export interface OutputPlan {
  mode: OutputMode;
  requiresHumanReview: boolean;
  generateDocx: boolean;
  generatePreviewPdf: boolean;
  generateFinalPdf: boolean;
  releaseToCustomerImmediately: boolean;
}

export function computeOutputPlan(notarized: boolean | null | undefined): OutputPlan {
  if (notarized) {
    return {
      mode: 'translator_review_draft',
      requiresHumanReview: true,
      generateDocx: true,
      generatePreviewPdf: true,
      generateFinalPdf: false,
      releaseToCustomerImmediately: false,
    };
  }
  return {
    mode: 'translation_only',
    requiresHumanReview: false,
    generateDocx: false,
    generatePreviewPdf: false,
    generateFinalPdf: true,
    releaseToCustomerImmediately: true,
  };
}
