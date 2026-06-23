export type RefundPolicyCase =
  | 'before_payment'
  | 'payment_failed'
  | 'paid_before_processing'
  | 'processing_started'
  | 'translator_assigned'
  | 'notary_started'
  | 'delivered'
  | 'duplicate_charge'
  | 'exception_only';

export interface RefundEligibility {
  maxRefundableKzt: number;
  requiresApproval: boolean;
  policyCase: RefundPolicyCase;
  nonRefundableCosts: number;
  reason: string;
  canAutoRefund: boolean;
}

export interface RefundInput {
  jobStatus: string;
  workflowStatus: string | null;
  paymentStatus: string;
  paymentAmountKzt: number;
  existingRefundedKzt: number;
  isDuplicateCharge: boolean;
}

const PROCESSING_STATUSES = ['ocr_in_progress', 'ocr_completed', 'translation_in_progress', 'pdf_rendering'];
const NOTARY_STATUSES = ['assigned_to_notary', 'notarization_in_progress', 'notarized', 'ready_for_delivery', 'ready_for_pickup'];

export function calculateRefundEligibility(input: RefundInput): RefundEligibility {
  const { jobStatus, workflowStatus, paymentStatus, paymentAmountKzt, existingRefundedKzt, isDuplicateCharge } = input;
  const alreadyRefunded = Math.max(0, existingRefundedKzt);
  const maxRemaining = Math.max(0, paymentAmountKzt - alreadyRefunded);

  if (isDuplicateCharge) {
    return { maxRefundableKzt: maxRemaining, requiresApproval: false, policyCase: 'duplicate_charge', nonRefundableCosts: 0, reason: 'Duplicate charge — full refund authorized automatically', canAutoRefund: true };
  }

  if (paymentStatus !== 'paid') {
    return { maxRefundableKzt: 0, requiresApproval: false, policyCase: paymentStatus === 'failed' ? 'payment_failed' : 'before_payment', nonRefundableCosts: 0, reason: 'Payment not completed — no refund needed', canAutoRefund: false };
  }

  if (jobStatus === 'payment_pending' || jobStatus === 'queued') {
    return { maxRefundableKzt: maxRemaining, requiresApproval: false, policyCase: 'paid_before_processing', nonRefundableCosts: 0, reason: 'Job not yet started — full refund allowed', canAutoRefund: true };
  }

  if (PROCESSING_STATUSES.includes(jobStatus)) {
    return { maxRefundableKzt: maxRemaining, requiresApproval: true, policyCase: 'processing_started', nonRefundableCosts: Math.round(paymentAmountKzt * 0.10), reason: 'Processing in progress — operator approval required', canAutoRefund: false };
  }

  if (workflowStatus === 'awaiting_translator_review' || workflowStatus === 'translator_approved') {
    return { maxRefundableKzt: Math.round(maxRemaining * 0.5), requiresApproval: true, policyCase: 'translator_assigned', nonRefundableCosts: Math.round(paymentAmountKzt * 0.30), reason: 'Translator work completed — partial refund subject to operator approval', canAutoRefund: false };
  }

  if (workflowStatus && NOTARY_STATUSES.includes(workflowStatus)) {
    return { maxRefundableKzt: 0, requiresApproval: true, policyCase: 'notary_started', nonRefundableCosts: paymentAmountKzt, reason: 'Notary process started — refund exception only', canAutoRefund: false };
  }

  if (jobStatus === 'completed' || workflowStatus === 'delivered' || workflowStatus === 'picked_up') {
    return { maxRefundableKzt: 0, requiresApproval: true, policyCase: 'delivered', nonRefundableCosts: paymentAmountKzt, reason: 'Order delivered — refund exception only', canAutoRefund: false };
  }

  return { maxRefundableKzt: maxRemaining, requiresApproval: true, policyCase: 'exception_only', nonRefundableCosts: 0, reason: 'Manual review required', canAutoRefund: false };
}
