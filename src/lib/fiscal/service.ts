/**
 * Fiscal receipt service.
 * Server-side only. Never import in client bundles.
 *
 * Core contract:
 * - Vercel (web app) only creates fiscal_receipts DB rows. It NEVER calls Webkassa directly.
 * - Railway worker (fiscal-processor) picks up pending rows and calls Webkassa sequentially.
 * - Idempotent: calling create* functions twice returns the existing row on the second call.
 * - Non-blocking: DB failures log and return null; they do not throw to callers.
 * - Status transparency: pending_manual receipts are never shown to customers as issued.
 */
import { supabaseServer } from '@/lib/supabase/server';
import { getFiscalProvider } from './provider';
import { getFiscalConfig } from './config';

export interface CreateRefundReceiptResult {
  fiscalReceiptId: string;
  status: string;
  fiscalUrl?: string;
  isNew: boolean;
}

/**
 * Ensures a fiscal receipt row exists for a confirmed paid payment.
 *
 * Guarantees:
 * - DB row is created synchronously before returning (awaitable, safe in serverless).
 * - Idempotent: second call returns the existing row without creating a duplicate.
 * - Does NOT call Webkassa. Railway worker (fiscal-processor) handles Webkassa sequentially.
 *
 * Status after return:
 *   pending_manual — manual provider or fiscalization disabled (operator issues manually)
 *   pending        — real provider; worker will update to issued/failed
 */
export async function ensureSaleFiscalReceiptForPaidPayment(
  paymentTransactionId: string,
): Promise<{ fiscalReceiptId: string; status: string; isNew: boolean } | null> {
  // 1. Idempotency check
  const { data: existing } = await supabaseServer
    .from('fiscal_receipts')
    .select('id, status, fiscal_url')
    .eq('payment_transaction_id', paymentTransactionId)
    .eq('operation_type', 'sale')
    .maybeSingle();

  if (existing) {
    console.info('[fiscal] sale receipt already exists', {
      fiscalReceiptId: existing.id,
      paymentTransactionId,
      status: existing.status,
    });
    return { fiscalReceiptId: existing.id, status: existing.status, isNew: false };
  }

  // 2. Load payment transaction
  const { data: payment } = await supabaseServer
    .from('payment_transactions')
    .select('id, job_id, document_id, amount, currency, status, provider_environment')
    .eq('id', paymentTransactionId)
    .eq('status', 'paid')
    .maybeSingle();

  if (!payment) {
    console.warn('[fiscal] ensure sale receipt: payment not found or not paid', { paymentTransactionId });
    return null;
  }

  // 3. Load customer email for receipt delivery
  let customerEmail: string | undefined;
  const { data: job } = await supabaseServer
    .from('jobs')
    .select('id, document_id')
    .eq('id', payment.job_id)
    .maybeSingle();
  if (job) {
    const { data: doc } = await supabaseServer
      .from('documents')
      .select('user_id')
      .eq('id', job.document_id)
      .maybeSingle();
    if (doc) {
      const { data: user } = await supabaseServer
        .from('users')
        .select('email')
        .eq('id', doc.user_id)
        .maybeSingle();
      customerEmail = user?.email;
    }
  }

  const config = getFiscalConfig();
  const provider = getFiscalProvider();
  const amountKzt = Math.round(payment.amount);
  const orderNumber = paymentTransactionId.slice(0, 8).toUpperCase();

  // 4. Determine initial status from config — no HTTP call, no provider call yet.
  //    manual or disabled → pending_manual (operator issues receipt manually, no async call)
  //    real provider enabled → pending (async provider call will update to final status)
  const initialStatus = (provider.name === 'manual' || !config.enabled)
    ? 'pending_manual' as const
    : 'pending' as const;

  console.info('[fiscal] ensure sale receipt start', {
    paymentTransactionId,
    jobId: payment.job_id,
    provider: provider.name,
    providerEnvironment: config.providerEnvironment,
    amountKzt,
    currency: 'KZT',
    initialStatus,
  });

  // 5. Insert DB row with correct initial status (happens before any provider HTTP call)
  const { data: receiptRow, error: insertError } = await supabaseServer
    .from('fiscal_receipts')
    .insert({
      job_id: payment.job_id,
      document_id: payment.document_id,
      payment_transaction_id: paymentTransactionId,
      provider: provider.name,
      provider_environment: config.providerEnvironment,
      amount_kzt: amountKzt,
      currency: 'KZT',
      operation_type: 'sale',
      status: initialStatus,
      customer_email: customerEmail ?? null,
      receipt_payload_sanitized: {
        orderNumber,
        amountKzt,
        description: `Перевод документа #${orderNumber}`,
      },
    })
    .select('id')
    .single();

  if (insertError) {
    if (insertError.code === '23505') {
      const { data: race } = await supabaseServer
        .from('fiscal_receipts')
        .select('id, status, fiscal_url')
        .eq('payment_transaction_id', paymentTransactionId)
        .eq('operation_type', 'sale')
        .maybeSingle();
      if (race) {
        console.info('[fiscal] sale receipt already exists (race)', {
          fiscalReceiptId: race.id,
          paymentTransactionId,
          status: race.status,
        });
        return { fiscalReceiptId: race.id, status: race.status, isNew: false };
      }
    }
    console.error('[fiscal] sale receipt creation failed', {
      paymentTransactionId,
      code: insertError.code,
      message: insertError.message,
    });
    return null;
  }

  const receiptId = receiptRow.id;

  console.info('[fiscal] sale receipt row created', {
    fiscalReceiptId: receiptId,
    paymentTransactionId,
    status: initialStatus,
  });

  // 6. Row created — worker fiscal-processor will pick it up and call Webkassa sequentially.
  //    No direct Webkassa call from serverless: prevents parallel requests to the same cashbox
  //    across Vercel instances (Webkassa requirement: one active request per cashbox at a time).

  return { fiscalReceiptId: receiptId, status: initialStatus, isNew: true };
}

/**
 * Creates (or finds existing) fiscal refund receipt after a refund is confirmed.
 * Links it to the refund_transactions row via fiscal_refund_receipt_id.
 */
export async function createRefundReceiptForRefund(
  refundTransactionId: string,
  originalPaymentTransactionId: string,
  amountKzt: number,
  reason: string,
): Promise<CreateRefundReceiptResult | null> {
  // 1. Check for existing receipt
  const { data: existing } = await supabaseServer
    .from('fiscal_receipts')
    .select('id, status, fiscal_url')
    .eq('payment_transaction_id', originalPaymentTransactionId)
    .eq('operation_type', 'refund')
    .maybeSingle();

  if (existing) {
    return {
      fiscalReceiptId: existing.id,
      status: existing.status,
      fiscalUrl: existing.fiscal_url ?? undefined,
      isNew: false,
    };
  }

  const { data: payment } = await supabaseServer
    .from('payment_transactions')
    .select('job_id, document_id, provider_environment')
    .eq('id', originalPaymentTransactionId)
    .maybeSingle();

  if (!payment) return null;

  const provider = getFiscalProvider();
  const config = getFiscalConfig();

  const { data: originalFiscal } = await supabaseServer
    .from('fiscal_receipts')
    .select('id')
    .eq('payment_transaction_id', originalPaymentTransactionId)
    .eq('operation_type', 'sale')
    .maybeSingle();

  const { data: receiptRow, error: insertError } = await supabaseServer
    .from('fiscal_receipts')
    .insert({
      job_id: payment.job_id,
      document_id: payment.document_id,
      payment_transaction_id: originalPaymentTransactionId,
      provider: provider.name,
      provider_environment: config.providerEnvironment,
      amount_kzt: amountKzt,
      currency: 'KZT',
      operation_type: 'refund',
      status: 'pending',
      receipt_payload_sanitized: {
        refundTransactionId,
        amountKzt,
        reason,
      },
    })
    .select('id')
    .single();

  if (insertError) {
    console.error('[fiscal/service] insert refund receipt failed:', insertError.message);
    return null;
  }

  const receiptId = receiptRow.id;

  // Link refund_transactions row to fiscal receipt (before worker processes it)
  await supabaseServer
    .from('refund_transactions')
    .update({ fiscal_refund_receipt_id: receiptId, updated_at: new Date().toISOString() })
    .eq('id', refundTransactionId);

  // Row created — worker fiscal-processor picks it up and calls Webkassa sequentially.
  // Vercel must not call the provider directly: prevents parallel cashbox requests.
  console.info('[fiscal/service] refund receipt row created (pending — worker will issue)', {
    receiptId,
    refundTransactionId,
    originalPaymentTransactionId,
    provider: provider.name,
    originalSaleReceiptId: originalFiscal?.id ?? null,
  });

  return { fiscalReceiptId: receiptId, status: 'pending', isNew: true };
}
