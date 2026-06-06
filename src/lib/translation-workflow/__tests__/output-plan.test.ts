/**
 * @jest-environment node
 */
import { computeOutputPlan } from '../output-plan';

describe('computeOutputPlan', () => {
  it('notarized=true → translator_review_draft, generateDocx=true, releaseToCustomerImmediately=false', () => {
    const plan = computeOutputPlan(true);
    expect(plan.mode).toBe('translator_review_draft');
    expect(plan.generateDocx).toBe(true);
    expect(plan.releaseToCustomerImmediately).toBe(false);
    expect(plan.requiresHumanReview).toBe(true);
    expect(plan.generateFinalPdf).toBe(false);
    expect(plan.generatePreviewPdf).toBe(true);
  });

  it('notarized=false → translation_only, generateFinalPdf=true, releaseToCustomerImmediately=true', () => {
    const plan = computeOutputPlan(false);
    expect(plan.mode).toBe('translation_only');
    expect(plan.generateFinalPdf).toBe(true);
    expect(plan.releaseToCustomerImmediately).toBe(true);
    expect(plan.requiresHumanReview).toBe(false);
    expect(plan.generateDocx).toBe(false);
  });

  it('notarized=null → translation_only', () => {
    const plan = computeOutputPlan(null);
    expect(plan.mode).toBe('translation_only');
  });

  it('notarized=undefined → translation_only', () => {
    const plan = computeOutputPlan(undefined);
    expect(plan.mode).toBe('translation_only');
  });
});
