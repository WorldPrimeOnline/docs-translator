import type { OutputPlan } from './types';

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
