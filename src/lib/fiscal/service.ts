/**
 * Fiscal receipt service.
 * Server-side only. Never import in client bundles.
 *
 * Core contract:
 * - Idempotent: calling createSaleReceiptForPayment twice for the same payment
 *   returns the existing receipt on the second call without creating a duplicate.
 * - Non-blocking: fiscal failure does not throw. The caller's payment/job flow continues.
 * - Status transparency: pending_manual receipts are never shown to customers as issued.
 */
import { supabaseServer } from '@/lib/supabase/server';
import { getFiscalProvider } from './provider';
import { getFiscalConfig } from './config';
import type { Json } from '@/types/supabase';
import type { FiscalSaleInput, FiscalProvider } from './types';

export interface CreateSaleReceiptResult {
  fiscalReceiptId: string;
  status: string;
  fiscalUrl?: string;
  isNew: boolean;
}

export interface CreateRefundReceiptResult {
  fiscalReceiptId: string;
  status: string;
  fiscalUrl?: string;
  isNew: boolean;
}

/**
 * Creates (or finds existing) fiscal sale receipt for a paid payment transaction.
 * Must be called after `finalize_halyk_payment` confirms a CHARGE.
 *
 * Returns null if the payment transaction cannot be found or is not paid.
 */
export async function createSaleReceiptForPayment(
  paymentTransactionId: string,
): Promise<CreateSaleReceiptResult | null> {
  // 1. Check for existing receipt (idempotency)
  const { data: existing } = await supabaseServer
    .from('fiscal_receipts')
    .select('id, status, fiscal_url')
    .eq('payment_transaction_id', paymentTransactionId)
    .eq('operation_type', 'sale')
    .maybeSingle();

  if (existing) {
    return {
      fiscalReceiptId: existing.id,
      status: existing.status,
      fiscalUrl: existing.fiscal_url ?? undefined,
      isNew: false,
    };
  }

  // 2. Load payment transaction details
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: payment } = await (supabaseServer as any)
    .from('payment_transactions')
    .select('id, job_id, document_id, amount, currency, status, provider_environment, quote_id')
    .eq('id', paymentTransactionId)
    .eq('status', 'paid')
    .maybeSingle() as { data: { id: string; job_id: string; document_id: string; amount: number; currency: string; status: string; provider_environment: string; quote_id: string | null } | null };

  if (!payment) {
    console.warn('[fiscal/service] createSaleReceipt: payment not found or not paid', {
      paymentTransactionId,
    });
    return null;
  }

  // 2b. Fiscal/payment/quote amount consistency check
  if (payment.quote_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: quoteRow } = await (supabaseServer as any)
      .from('price_quotes')
      .select('amount_kzt')
      .eq('id', payment.quote_id)
      .maybeSingle() as { data: { amount_kzt: number } | null };

    if (quoteRow) {
      const quoteAmountKzt = Math.round(Number(quoteRow.amount_kzt));
      const paymentAmountKzt = Math.round(payment.amount);
      if (quoteAmountKzt !== paymentAmountKzt) {
        // Do not block fiscal receipt — payment is authoritative after CHARGE.
        // Log as CRITICAL for operator investigation.
        console.error('[fiscal/service] CRITICAL: AMOUNT_MISMATCH quote vs payment', {
          paymentTransactionId,
          quoteId: payment.quote_id,
          quoteAmountKzt,
          paymentAmountKzt,
        });
      }
    }
  }

  // 3. Load customer email for receipt
  const { data: job } = await supabaseServer
    .from('jobs')
    .select('id, document_id')
    .eq('id', payment.job_id)
    .maybeSingle();

  let customerEmail: string | undefined;
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
  const orderNumber = paymentTransactionId.slice(0, 8).toUpperCase();

  const fiscalInput: FiscalSaleInput = {
    jobId: payment.job_id,
    paymentTransactionId,
    amountKzt: Math.round(payment.amount),
    currency: 'KZT',
    customerEmail,
    description: `Перевод документа #${orderNumber}`,
    orderNumber,
  };

  // 4. Insert receipt row first (prevents race between concurrent callbacks)
  const { data: receiptRow, error: insertError } = await supabaseServer
    .from('fiscal_receipts')
    .insert({
      job_id: payment.job_id,
      document_id: payment.document_id,
      payment_transaction_id: paymentTransactionId,
      provider: provider.name,
      provider_environment: config.providerEnvironment,
      amount_kzt: fiscalInput.amountKzt,
      currency: 'KZT',
      operation_type: 'sale',
      status: 'pending',
      customer_email: customerEmail ?? null,
      receipt_payload_sanitized: {
        orderNumber,
        amountKzt: fiscalInput.amountKzt,
        description: fiscalInput.description,
      },
    })
    .select('id')
    .single();

  if (insertError) {
    // Unique constraint violation = another concurrent request already created it
    if (insertError.code === '23505') {
      const { data: race } = await supabaseServer
        .from('fiscal_receipts')
        .select('id, status, fiscal_url')
        .eq('payment_transaction_id', paymentTransactionId)
        .eq('operation_type', 'sale')
        .maybeSingle();
      if (race) {
        return {
          fiscalReceiptId: race.id,
          status: race.status,
          fiscalUrl: race.fiscal_url ?? undefined,
          isNew: false,
        };
      }
    }
    console.error('[fiscal/service] insert fiscal_receipt failed:', insertError.message);
    return null;
  }

  const receiptId = receiptRow.id;

  // 5. Call provider (non-blocking — failure updates DB but does not throw to caller)
  try {
    const result = await provider.createSaleReceipt(fiscalInput);

    await supabaseServer
      .from('fiscal_receipts')
      .update({
        status: result.status,
        provider_receipt_id: result.providerReceiptId ?? null,
        provider_shift_id: result.shiftId ?? null,
        provider_cashbox_id: result.cashboxId ?? null,
        fiscal_sign: result.fiscalSign ?? null,
        fiscal_url: result.fiscalUrl ?? null,
        provider_response_sanitized: (result.providerResponseSanitized ?? null) as Json | null,
        error_code: result.errorCode ?? null,
        error_message: result.errorMessage ?? null,
        issued_at: result.status === 'issued' ? new Date().toISOString() : null,
        failed_at: result.status === 'failed' ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', receiptId);

    if (result.status === 'issued') {
      console.info('[fiscal/service] fiscal sale receipt issued', {
        receiptId,
        paymentTransactionId,
        fiscalUrl: result.fiscalUrl,
      });
    } else {
      console.info('[fiscal/service] fiscal sale receipt created', {
        receiptId,
        status: result.status,
        provider: provider.name,
      });
    }

    return {
      fiscalReceiptId: receiptId,
      status: result.status,
      fiscalUrl: result.fiscalUrl,
      isNew: true,
    };
  } catch (err) {
    const msg = (err as Error).message;
    console.error('[fiscal/service] provider.createSaleReceipt threw:', msg, { receiptId });

    await supabaseServer
      .from('fiscal_receipts')
      .update({
        status: 'failed',
        error_message: msg,
        failed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', receiptId);

    // Do NOT re-throw — fiscal failure must not block the payment/job flow
    return {
      fiscalReceiptId: receiptId,
      status: 'failed',
      isNew: true,
    };
  }
}

// ─── Async provider update (used by ensureSaleFiscalReceiptForPaidPayment) ──────

async function _runProviderSaleReceipt(
  receiptId: string,
  provider: FiscalProvider,
  fiscalInput: FiscalSaleInput,
): Promise<void> {
  try {
    const result = await provider.createSaleReceipt(fiscalInput);
    await supabaseServer
      .from('fiscal_receipts')
      .update({
        status: result.status,
        provider_receipt_id: result.providerReceiptId ?? null,
        provider_shift_id: result.shiftId ?? null,
        provider_cashbox_id: result.cashboxId ?? null,
        fiscal_sign: result.fiscalSign ?? null,
        fiscal_url: result.fiscalUrl ?? null,
        provider_response_sanitized: (result.providerResponseSanitized ?? null) as Json | null,
        error_code: result.errorCode ?? null,
        error_message: result.errorMessage ?? null,
        issued_at: result.status === 'issued' ? new Date().toISOString() : null,
        failed_at: result.status === 'failed' ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', receiptId);
    if (result.status === 'issued') {
      console.info('[fiscal] provider receipt issued', { receiptId, fiscalUrl: result.fiscalUrl, provider: provider.name });
    } else {
      console.info('[fiscal] provider receipt result', { receiptId, status: result.status, provider: provider.name });
    }
  } catch (err) {
    const msg = (err as Error).message;
    console.error('[fiscal] provider sale receipt call failed:', msg, { receiptId, provider: provider.name });
    await supabaseServer
      .from('fiscal_receipts')
      .update({
        status: 'failed',
        error_message: msg,
        failed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', receiptId);
  }
}

/**
 * Ensures a fiscal receipt row exists for a confirmed paid payment.
 *
 * Guarantees:
 * - DB row is created synchronously before returning (awaitable, safe in serverless).
 * - Idempotent: second call returns the existing row without creating a duplicate.
 * - Non-blocking for HTTP providers: Webkassa API call fires async after row creation.
 * - fiscal failure never throws — returns null on unrecoverable error.
 *
 * Status after return:
 *   pending_manual — manual provider or fiscalization disabled (operator issues manually)
 *   pending        — real provider enabled; async update will set issued/failed/blocked_by_config
 *
 * Use this in all finalization paths (callback, status, cron) instead of void createSaleReceiptForPayment.
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

  // 6. If real provider is active: fire async provider attempt (does NOT block the caller)
  //    Provider will update the row to issued / failed / blocked_by_config.
  if (initialStatus === 'pending') {
    const fiscalInput: FiscalSaleInput = {
      jobId: payment.job_id,
      paymentTransactionId,
      amountKzt,
      currency: 'KZT',
      customerEmail,
      description: `Перевод документа #${orderNumber}`,
      orderNumber,
    };
    void _runProviderSaleReceipt(receiptId, provider, fiscalInput);
  }

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

  try {
    const result = await provider.createRefundReceipt({
      refundTransactionId,
      originalPaymentTransactionId,
      originalFiscalReceiptId: originalFiscal?.id,
      amountKzt,
      currency: 'KZT',
      reason,
    });

    await supabaseServer
      .from('fiscal_receipts')
      .update({
        status: result.status,
        provider_receipt_id: result.providerReceiptId ?? null,
        fiscal_url: result.fiscalUrl ?? null,
        provider_response_sanitized: (result.providerResponseSanitized ?? null) as Json | null,
        error_code: result.errorCode ?? null,
        error_message: result.errorMessage ?? null,
        issued_at: result.status === 'issued' ? new Date().toISOString() : null,
        failed_at: result.status === 'failed' ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', receiptId);

    // Link refund_transactions row to fiscal receipt
    await supabaseServer
      .from('refund_transactions')
      .update({ fiscal_refund_receipt_id: receiptId, updated_at: new Date().toISOString() })
      .eq('id', refundTransactionId);

    return {
      fiscalReceiptId: receiptId,
      status: result.status,
      fiscalUrl: result.fiscalUrl,
      isNew: true,
    };
  } catch (err) {
    const msg = (err as Error).message;
    console.error('[fiscal/service] provider.createRefundReceipt threw:', msg);

    await supabaseServer
      .from('fiscal_receipts')
      .update({
        status: 'failed',
        error_message: msg,
        failed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', receiptId);

    return { fiscalReceiptId: receiptId, status: 'failed', isNew: true };
  }
}
