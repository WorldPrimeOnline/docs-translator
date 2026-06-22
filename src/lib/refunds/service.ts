/**
 * Refund service — operator-initiated only.
 * Server-side only. Never import in client bundles.
 *
 * Architecture:
 * - No public customer endpoint for refunds.
 * - Operator calls this service via a protected admin API route.
 * - Halyk refund API is not yet integrated → all refunds go to pending_manual.
 * - Operator must process via Halyk merchant cabinet manually.
 * - On success, fiscal refund receipt is created (also pending_manual if no provider).
 * - All actions are audited.
 *
 * TODO: Implement real Halyk refund adapter when:
 * - Halyk merchant agreement confirms refund API access
 * - POST /operation/{transactionId}/refund endpoint credentials confirmed
 * - Minimum refund: 10 KZT per Halyk docs
 * - Only CHARGE transactions are refundable
 */
import crypto from 'crypto';
import { supabaseServer } from '@/lib/supabase/server';
import { createRefundReceiptForRefund } from '@/lib/fiscal/service';
import type { RefundRequest, RefundResult, RefundableAmountResult } from './types';

/**
 * Get the refundable amount for a payment transaction.
 * Calls the DB function to get paid amount minus already-succeeded refunds.
 */
export async function getRefundableAmount(
  paymentTransactionId: string,
): Promise<RefundableAmountResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabaseServer as any).rpc('get_refundable_amount', {
    p_payment_transaction_id: paymentTransactionId,
  });

  if (error || !data) {
    return { ok: false, error: error?.message ?? 'rpc_failed', totalPaid: 0, totalRefunded: 0, refundable: 0 };
  }

  return {
    ok: data.ok === true,
    error: data.error,
    totalPaid: data.total_paid ?? 0,
    totalRefunded: data.total_refunded ?? 0,
    refundable: data.refundable ?? 0,
  };
}

/**
 * Initiate a refund for a paid payment transaction.
 *
 * Validations performed:
 * 1. Payment must exist and be in 'paid' status.
 * 2. Refund amount must be ≥ 1 KZT and ≤ refundable amount.
 * 3. Idempotency key must be unique (duplicate request returns existing refund).
 *
 * Since the Halyk refund adapter is not yet implemented:
 * - Refund is created with status 'pending_manual'.
 * - Operator must process via Halyk merchant cabinet.
 * - Fiscal refund receipt is created (also pending_manual).
 */
export async function initiateRefund(request: RefundRequest): Promise<RefundResult> {
  const idempotencyKey = request.idempotencyKey ?? crypto.randomUUID();

  // Check for duplicate idempotency key
  const { data: existing } = await supabaseServer
    .from('refund_transactions')
    .select('id, status, provider_refund_id, fiscal_refund_receipt_id')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();

  if (existing) {
    console.info('[refund/service] duplicate idempotency key — returning existing refund', {
      refundId: existing.id,
      idempotencyKey,
    });
    return {
      refundTransactionId: existing.id,
      status: existing.status as RefundResult['status'],
      providerRefundId: existing.provider_refund_id ?? undefined,
      fiscalRefundReceiptId: existing.fiscal_refund_receipt_id ?? undefined,
    };
  }

  // Validate payment and refundable amount
  const amountCheck = await getRefundableAmount(request.paymentTransactionId);
  if (!amountCheck.ok) {
    return {
      refundTransactionId: '',
      status: 'failed',
      errorMessage: amountCheck.error ?? 'payment_not_paid',
    };
  }

  if (request.refundAmountKzt < 1) {
    return { refundTransactionId: '', status: 'failed', errorMessage: 'refund_amount_too_small' };
  }

  if (request.refundAmountKzt > amountCheck.refundable) {
    return {
      refundTransactionId: '',
      status: 'failed',
      errorMessage: `refund_exceeds_refundable: requested=${request.refundAmountKzt} refundable=${amountCheck.refundable}`,
    };
  }

  // Get job_id for the refund record
  const { data: payment } = await supabaseServer
    .from('payment_transactions')
    .select('job_id, provider_transaction_id, provider_environment')
    .eq('id', request.paymentTransactionId)
    .maybeSingle();

  if (!payment) {
    return { refundTransactionId: '', status: 'failed', errorMessage: 'payment_not_found' };
  }

  // Create refund record (pending_manual since no Halyk refund adapter)
  const { data: refundRow, error: insertError } = await supabaseServer
    .from('refund_transactions')
    .insert({
      job_id: payment.job_id,
      payment_transaction_id: request.paymentTransactionId,
      provider: 'halyk_epay',
      provider_environment: payment.provider_environment ?? 'test',
      refund_amount_kzt: request.refundAmountKzt,
      currency: 'KZT',
      status: 'pending_manual',
      reason: request.reason,
      operator_id: request.operatorId,
      idempotency_key: idempotencyKey,
      provider_response_sanitized: {
        note: 'Halyk refund API not yet integrated. Process via Halyk merchant cabinet.',
        providerTransactionId: payment.provider_transaction_id,
        requestedAt: new Date().toISOString(),
      },
    })
    .select('id')
    .single();

  if (insertError) {
    console.error('[refund/service] insert refund_transactions failed:', insertError.message);
    return { refundTransactionId: '', status: 'failed', errorMessage: insertError.message };
  }

  const refundId = refundRow.id;

  console.info('[refund/service] refund created (pending_manual)', {
    refundId,
    paymentTransactionId: request.paymentTransactionId,
    amountKzt: request.refundAmountKzt,
    operatorId: request.operatorId,
  });

  // Create fiscal refund receipt (also pending_manual since no real provider)
  let fiscalReceiptId: string | undefined;
  try {
    const fiscalResult = await createRefundReceiptForRefund(
      refundId,
      request.paymentTransactionId,
      request.refundAmountKzt,
      request.reason,
    );
    fiscalReceiptId = fiscalResult?.fiscalReceiptId;
  } catch (err) {
    // Fiscal failure does not block refund record creation
    console.error('[refund/service] fiscal refund receipt failed:', (err as Error).message);
  }

  return {
    refundTransactionId: refundId,
    status: 'pending_manual',
    fiscalRefundReceiptId: fiscalReceiptId,
  };
}
