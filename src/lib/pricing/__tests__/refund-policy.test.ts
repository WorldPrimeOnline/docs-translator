import { calculateRefundEligibility } from '../refund-policy';
import type { RefundInput } from '../refund-policy';

const base = (overrides: Partial<RefundInput> = {}): RefundInput => ({
  jobStatus: 'queued',
  workflowStatus: null,
  paymentStatus: 'paid',
  paymentAmountKzt: 6500,
  existingRefundedKzt: 0,
  isDuplicateCharge: false,
  ...overrides,
});

describe('calculateRefundEligibility', () => {
  it('duplicate charge → full refund', () => {
    const result = calculateRefundEligibility(base({ isDuplicateCharge: true }));
    expect(result.policyCase).toBe('duplicate_charge');
    expect(result.maxRefundableKzt).toBe(6500);
    expect(result.requiresApproval).toBe(false);
    expect(result.canAutoRefund).toBe(true);
  });

  it('payment failed → before_payment/payment_failed', () => {
    const result = calculateRefundEligibility(base({ paymentStatus: 'failed' }));
    expect(result.policyCase).toBe('payment_failed');
    expect(result.maxRefundableKzt).toBe(0);
  });

  it('payment_pending status → before_payment', () => {
    const result = calculateRefundEligibility(base({ paymentStatus: 'payment_pending' }));
    expect(result.policyCase).toBe('before_payment');
    expect(result.maxRefundableKzt).toBe(0);
  });

  it('paid + queued → full refund, no approval needed', () => {
    const result = calculateRefundEligibility(base({ jobStatus: 'queued' }));
    expect(result.policyCase).toBe('paid_before_processing');
    expect(result.maxRefundableKzt).toBe(6500);
    expect(result.requiresApproval).toBe(false);
    expect(result.canAutoRefund).toBe(true);
  });

  it('paid + payment_pending job status → full refund', () => {
    const result = calculateRefundEligibility(base({ jobStatus: 'payment_pending' }));
    expect(result.policyCase).toBe('paid_before_processing');
    expect(result.maxRefundableKzt).toBe(6500);
  });

  it('ocr_in_progress → processing_started, requires approval', () => {
    const result = calculateRefundEligibility(base({ jobStatus: 'ocr_in_progress' }));
    expect(result.policyCase).toBe('processing_started');
    expect(result.maxRefundableKzt).toBe(6500);
    expect(result.requiresApproval).toBe(true);
    expect(result.canAutoRefund).toBe(false);
    expect(result.nonRefundableCosts).toBe(Math.round(6500 * 0.10));
  });

  it('translation_in_progress → processing_started', () => {
    const result = calculateRefundEligibility(base({ jobStatus: 'translation_in_progress' }));
    expect(result.policyCase).toBe('processing_started');
  });

  it('awaiting_translator_review → translator_assigned, 50% of remaining', () => {
    const result = calculateRefundEligibility(base({ workflowStatus: 'awaiting_translator_review', jobStatus: 'completed' }));
    expect(result.policyCase).toBe('translator_assigned');
    expect(result.maxRefundableKzt).toBe(Math.round(6500 * 0.5));
    expect(result.requiresApproval).toBe(true);
  });

  it('translator_approved workflow status → translator_assigned', () => {
    const result = calculateRefundEligibility(base({ workflowStatus: 'translator_approved', jobStatus: 'completed' }));
    expect(result.policyCase).toBe('translator_assigned');
    expect(result.maxRefundableKzt).toBe(Math.round(6500 * 0.5));
  });

  it('notarization_in_progress → notary_started, 0 refundable', () => {
    const result = calculateRefundEligibility(base({ workflowStatus: 'notarization_in_progress', jobStatus: 'completed' }));
    expect(result.policyCase).toBe('notary_started');
    expect(result.maxRefundableKzt).toBe(0);
    expect(result.requiresApproval).toBe(true);
  });

  it('delivered workflow status → delivered, 0 refundable', () => {
    const result = calculateRefundEligibility(base({ workflowStatus: 'delivered', jobStatus: 'completed' }));
    expect(result.policyCase).toBe('delivered');
    expect(result.maxRefundableKzt).toBe(0);
  });

  it('picked_up → delivered policy case', () => {
    const result = calculateRefundEligibility(base({ workflowStatus: 'picked_up', jobStatus: 'completed' }));
    expect(result.policyCase).toBe('delivered');
    expect(result.maxRefundableKzt).toBe(0);
  });

  it('completed job with no known workflow status → exception_only', () => {
    const result = calculateRefundEligibility(base({ jobStatus: 'completed', workflowStatus: null }));
    expect(result.policyCase).toBe('delivered');
    expect(result.maxRefundableKzt).toBe(0);
  });

  it('existing refunds reduce remaining', () => {
    const result = calculateRefundEligibility(base({ jobStatus: 'queued', existingRefundedKzt: 1000 }));
    expect(result.maxRefundableKzt).toBe(5500);
  });

  it('existing refunds >= payment amount → 0 refundable', () => {
    const result = calculateRefundEligibility(base({ jobStatus: 'queued', existingRefundedKzt: 6500 }));
    expect(result.maxRefundableKzt).toBe(0);
  });

  it('failed payment does not depend on job status', () => {
    const r1 = calculateRefundEligibility(base({ paymentStatus: 'failed', jobStatus: 'queued' }));
    const r2 = calculateRefundEligibility(base({ paymentStatus: 'failed', jobStatus: 'ocr_in_progress' }));
    expect(r1.policyCase).toBe('payment_failed');
    expect(r2.policyCase).toBe('payment_failed');
  });
});
