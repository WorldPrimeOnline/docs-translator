/**
 * Refund types. Server-side only.
 */

export type RefundStatus =
  | 'requested'
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'requires_review'
  | 'pending_manual'
  | 'canceled';

export interface RefundRequest {
  paymentTransactionId: string;
  refundAmountKzt: number;
  reason: string;
  /** Who is initiating the refund (staff_profiles.id or operator email). */
  operatorId: string;
  /** Optional: caller-provided idempotency key. Generated if absent. */
  idempotencyKey?: string;
}

export interface RefundResult {
  refundTransactionId: string;
  status: RefundStatus;
  providerRefundId?: string;
  fiscalRefundReceiptId?: string;
  /** Error message if the refund failed. */
  errorMessage?: string;
}

export interface RefundableAmountResult {
  ok: boolean;
  error?: string;
  totalPaid: number;
  totalRefunded: number;
  refundable: number;
}
