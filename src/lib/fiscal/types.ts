/**
 * Fiscal provider interface and result types.
 * Server-side only — never import in client bundles.
 */

export type FiscalOperationType = 'sale' | 'refund' | 'correction';

export type FiscalReceiptStatus =
  | 'pending_manual'
  | 'pending'
  | 'issued'
  | 'failed'
  | 'retry_required'
  | 'canceled';

export interface FiscalSaleInput {
  jobId: string;
  paymentTransactionId: string;
  amountKzt: number;
  currency: 'KZT';
  customerEmail?: string;
  customerPhone?: string;
  description: string;
  orderNumber: string;
}

export interface FiscalRefundInput {
  refundTransactionId: string;
  originalPaymentTransactionId: string;
  originalFiscalReceiptId?: string;
  amountKzt: number;
  currency: 'KZT';
  reason: string;
}

export interface FiscalReceiptResult {
  status: FiscalReceiptStatus;
  /** Provider-assigned receipt ID (null for pending_manual). */
  providerReceiptId?: string;
  /** Public URL to the issued fiscal receipt (null for pending_manual). */
  fiscalUrl?: string;
  /** Shift ID from provider (OFD-specific). */
  shiftId?: string;
  /** Cashbox ID from provider (OFD-specific). */
  cashboxId?: string;
  /** Fiscal sign / QR data from provider. */
  fiscalSign?: string;
  /** Sanitised response to store in DB. Never includes card data. */
  providerResponseSanitized?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
}

export interface FiscalProvider {
  readonly name: string;
  createSaleReceipt(input: FiscalSaleInput): Promise<FiscalReceiptResult>;
  createRefundReceipt(input: FiscalRefundInput): Promise<FiscalReceiptResult>;
}
