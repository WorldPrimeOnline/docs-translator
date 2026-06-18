/**
 * @jest-environment node
 */
import { computeOutputPlan, deriveBackcompatBooleans } from '../output-plan';

describe('computeOutputPlan — legacy boolean input (backward compat)', () => {
  it('notarized=true → notarization_package', () => {
    const plan = computeOutputPlan(true);
    expect(plan.mode).toBe('notarization_package');
    expect(plan.generateDocx).toBe(true);
    expect(plan.releaseToCustomerImmediately).toBe(false);
    expect(plan.requiresHumanReview).toBe(true);
    expect(plan.requiresNotaryReview).toBe(true);
    expect(plan.generateFinalPdf).toBe(false);
    expect(plan.generatePreviewPdf).toBe(false);
  });

  it('notarized=false → translation_only', () => {
    const plan = computeOutputPlan(false);
    expect(plan.mode).toBe('translation_only');
    expect(plan.generateFinalPdf).toBe(true);
    expect(plan.releaseToCustomerImmediately).toBe(true);
    expect(plan.requiresHumanReview).toBe(false);
    expect(plan.requiresNotaryReview).toBe(false);
    expect(plan.generateDocx).toBe(false);
  });

  it('notarized=null → translation_only', () => {
    expect(computeOutputPlan(null).mode).toBe('translation_only');
  });

  it('notarized=undefined → translation_only', () => {
    expect(computeOutputPlan(undefined).mode).toBe('translation_only');
  });
});

describe('computeOutputPlan — ServiceLevel string input', () => {
  it('electronic → translation_only', () => {
    const plan = computeOutputPlan('electronic');
    expect(plan.mode).toBe('translation_only');
    expect(plan.requiresHumanReview).toBe(false);
    expect(plan.requiresNotaryReview).toBe(false);
    expect(plan.releaseToCustomerImmediately).toBe(true);
  });

  it('official_with_translator_signature_and_provider_stamp → translator_review_draft', () => {
    const plan = computeOutputPlan('official_with_translator_signature_and_provider_stamp');
    expect(plan.mode).toBe('translator_review_draft');
    expect(plan.requiresHumanReview).toBe(true);
    expect(plan.requiresNotaryReview).toBe(false);
    expect(plan.generateDocx).toBe(true);
    expect(plan.generatePreviewPdf).toBe(false);
    expect(plan.generateFinalPdf).toBe(false);
    expect(plan.releaseToCustomerImmediately).toBe(false);
  });

  it('notarization_through_partners → notarization_package', () => {
    const plan = computeOutputPlan('notarization_through_partners');
    expect(plan.mode).toBe('notarization_package');
    expect(plan.requiresHumanReview).toBe(true);
    expect(plan.requiresNotaryReview).toBe(true);
    expect(plan.generateDocx).toBe(true);
    expect(plan.generatePreviewPdf).toBe(false);
    expect(plan.generateFinalPdf).toBe(false);
    expect(plan.releaseToCustomerImmediately).toBe(false);
  });
});

describe('deriveBackcompatBooleans', () => {
  it('electronic → notarized=false, bureau_stamp=false', () => {
    const b = deriveBackcompatBooleans('electronic');
    expect(b.notarized).toBe(false);
    expect(b.bureau_stamp).toBe(false);
  });

  it('official_with_translator_signature_and_provider_stamp → notarized=false, bureau_stamp=true', () => {
    const b = deriveBackcompatBooleans('official_with_translator_signature_and_provider_stamp');
    expect(b.notarized).toBe(false);
    expect(b.bureau_stamp).toBe(true);
  });

  it('notarization_through_partners → notarized=true, bureau_stamp=true', () => {
    const b = deriveBackcompatBooleans('notarization_through_partners');
    expect(b.notarized).toBe(true);
    expect(b.bureau_stamp).toBe(true);
  });
});
