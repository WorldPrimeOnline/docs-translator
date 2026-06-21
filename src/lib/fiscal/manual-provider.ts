/**
 * Manual fiscal provider.
 *
 * Used when no OFD/fiscal provider API is configured.
 * Creates a pending_manual receipt that the operator must issue via the fiscal
 * provider's web cabinet (e.g., ReKassa, Webkassa, or any KZ-registered OFD).
 *
 * IMPORTANT: does NOT call any external API.
 * IMPORTANT: does NOT mark receipts as issued.
 * IMPORTANT: the receipt link is null — do not show a fake receipt to the customer.
 *
 * TODO: Replace with a real adapter once the fiscal provider and credentials are confirmed:
 *   - Provider name (ReKassa / Webkassa / another OFD)
 *   - FISCAL_CLIENT_ID or FISCAL_API_KEY
 *   - FISCAL_CASHBOX_ID (KKM serial)
 *   - FISCAL_OFD_ID
 *   - FISCAL_TAXPAYER_ID (ИИН/БИН)
 *   - Accountant confirmation that the adapter output matches OFD requirements
 */
import type { FiscalProvider, FiscalSaleInput, FiscalRefundInput, FiscalReceiptResult } from './types';

export class ManualFiscalProvider implements FiscalProvider {
  readonly name = 'manual';

  async createSaleReceipt(input: FiscalSaleInput): Promise<FiscalReceiptResult> {
    console.info('[fiscal/manual] Sale receipt pending manual issuance', {
      jobId: input.jobId,
      paymentTransactionId: input.paymentTransactionId,
      amountKzt: input.amountKzt,
      orderNumber: input.orderNumber,
    });

    return {
      status: 'pending_manual',
      providerReceiptId: undefined,
      fiscalUrl: undefined,
      providerResponseSanitized: {
        provider: 'manual',
        note: 'No fiscal provider configured. Issue receipt via OFD cabinet.',
        orderNumber: input.orderNumber,
        amountKzt: input.amountKzt,
      },
    };
  }

  async createRefundReceipt(input: FiscalRefundInput): Promise<FiscalReceiptResult> {
    console.info('[fiscal/manual] Refund receipt pending manual issuance', {
      refundTransactionId: input.refundTransactionId,
      amountKzt: input.amountKzt,
      reason: input.reason,
    });

    return {
      status: 'pending_manual',
      providerReceiptId: undefined,
      fiscalUrl: undefined,
      providerResponseSanitized: {
        provider: 'manual',
        note: 'No fiscal refund provider configured. Issue correction via OFD cabinet.',
        refundTransactionId: input.refundTransactionId,
        amountKzt: input.amountKzt,
      },
    };
  }
}
