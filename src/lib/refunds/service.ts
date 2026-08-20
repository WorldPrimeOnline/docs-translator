/**
 * Refund service — operator-initiated only.
 * Server-side only. Never import in client bundles.
 *
 * Architecture:
 * - No public customer endpoint for refunds.
 * - Operator calls this service via a protected admin API route.
 * - Halyk refund API is not yet integrated → Halyk refunds go to pending_manual;
 *   operator must process via Halyk merchant cabinet manually. On success, a fiscal
 *   refund receipt is created for Halyk refunds only (also pending_manual).
 * - Freedom Pay refunds call the live revoke() API synchronously (see
 *   src/lib/payments/freedompay/client.ts) and resolve to 'succeeded'/'failed'
 *   without any fiscal receipt call — fiscalization is entirely out of scope for
 *   Freedom Pay in this phase; WPO payment/refund and the future online cash
 *   register for the current legal entity are two separate tasks.
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
import { refund as freedomPayRefund, FreedomPayApiError } from '@/lib/payments/freedompay/client';
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
    .select('job_id, provider_transaction_id, provider_environment, payment_provider')
    .eq('id', request.paymentTransactionId)
    .maybeSingle();

  if (!payment) {
    return { refundTransactionId: '', status: 'failed', errorMessage: 'payment_not_found' };
  }

  const provider = payment.payment_provider ?? 'halyk_epay';

  // Create refund record — pending_manual by default (Halyk refund API is not yet
  // integrated; operator processes manually via Halyk merchant cabinet). Freedom Pay
  // rows are updated below to 'succeeded'/'failed' once the live revoke() call
  // resolves, since that API is documented and available.
  const { data: refundRow, error: insertError } = await supabaseServer
    .from('refund_transactions')
    .insert({
      job_id: payment.job_id,
      payment_transaction_id: request.paymentTransactionId,
      provider,
      provider_environment: payment.provider_environment ?? 'test',
      refund_amount_kzt: request.refundAmountKzt,
      currency: 'KZT',
      status: 'pending_manual',
      reason: request.reason,
      operator_id: request.operatorId,
      idempotency_key: idempotencyKey,
      provider_response_sanitized: {
        note: provider === 'freedom_pay'
          ? 'Freedom Pay revoke() will be called synchronously.'
          : 'Halyk refund API not yet integrated. Process via Halyk merchant cabinet.',
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
    provider,
  });

  // ── Freedom Pay: call the live revoke() API, no fiscal receipt call ─────────
  // Fiscalization is entirely out of scope for Freedom Pay in this phase — WPO
  // payment/refund and the future online cash register for the current entity are
  // two separate tasks. createRefundReceiptForRefund() is never invoked here.
  if (provider === 'freedom_pay') {
    if (!payment.provider_transaction_id) {
      console.error('[refund/service] freedom_pay refund missing provider_transaction_id (pg_payment_id)', { refundId });
      return { refundTransactionId: refundId, status: 'pending_manual', errorMessage: 'missing_pg_payment_id' };
    }

    try {
      const refundResp = await freedomPayRefund({
        pgPaymentId: payment.provider_transaction_id,
        amountKzt: request.refundAmountKzt,
        // Passed through as pg_idempotency_key — see client.ts's RefundParams doc
        // comment on why this is defense-in-depth, not a substitute for WPO's own
        // idempotency_key uniqueness check above.
        idempotencyKey,
      });

      const now = new Date().toISOString();

      if (refundResp.ok) {
        await supabaseServer
          .from('refund_transactions')
          .update({
            status: 'succeeded',
            provider_response_sanitized: { pg_status: refundResp.raw.pg_status, pg_refund_id: refundResp.raw.pg_refund_id ?? null },
            updated_at: now,
          })
          .eq('id', refundId);

        await supabaseServer
          .from('payment_transactions')
          .update({ status: 'refunded', refunded_at: now, updated_at: now })
          .eq('id', request.paymentTransactionId);

        console.info('[refund/service] freedom_pay refund succeeded', { refundId, paymentTransactionId: request.paymentTransactionId });

        return {
          refundTransactionId: refundId,
          status: 'succeeded',
          providerRefundId: refundResp.raw.pg_refund_id,
        };
      }

      console.error('[refund/service] freedom_pay revoke rejected', { refundId, raw: refundResp.raw });
      await supabaseServer
        .from('refund_transactions')
        .update({ status: 'failed', provider_response_sanitized: { pg_status: refundResp.raw.pg_status ?? 'unknown' }, updated_at: now })
        .eq('id', refundId);

      return { refundTransactionId: refundId, status: 'failed', errorMessage: 'freedompay_refund_rejected' };
    } catch (err) {
      // Ambiguous outcome: the revoke() call threw before WPO could read a confirmed
      // pg_status (network error, timeout, or unparseable response). Freedom Pay may
      // have already processed the refund on their end — WPO cannot tell from this
      // exception alone. Do NOT treat this the same as a confirmed rejection above:
      // leave status at pending_manual (never 'failed', which would invite an operator
      // to casually retry) and record the ambiguity explicitly so an operator checks
      // the Freedom Pay cabinet/status before deciding to retry.
      //
      // WPO-side idempotency: retrying initiateRefund() with the SAME idempotencyKey
      // short-circuits at the top of this function (existing idempotency_key uniqueness
      // check) and never calls revoke() a second time. That protection only holds if
      // the caller reuses the same key — an operator who retries via a fresh UI action
      // without the original key would generate a new key and call revoke() again.
      // pg_idempotency_key is now sent to Freedom Pay per-request (see above), which
      // may provide provider-side dedup on retry, but this is NOT independently
      // confirmed against docs.freedompay.kz — flagged as a pre-production
      // verification item, not relied upon here as the sole safety net.
      const isFp = err instanceof FreedomPayApiError;
      console.error('[refund/service] freedom_pay revoke call failed — ambiguous outcome, do not auto-retry', {
        refundId,
        code: isFp ? err.code : 'UNKNOWN',
        message: err instanceof Error ? err.message : String(err),
      });

      await supabaseServer
        .from('refund_transactions')
        .update({
          provider_response_sanitized: {
            ambiguous_timeout: true,
            note: 'revoke() call threw before a confirmed pg_status was read — Freedom Pay may have already processed this refund. Verify via the Freedom Pay merchant cabinet or a status check before retrying.',
            errorCode: isFp ? err.code : 'UNKNOWN',
            idempotencyKeySent: idempotencyKey,
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', refundId);

      return { refundTransactionId: refundId, status: 'pending_manual', errorMessage: 'freedompay_refund_ambiguous_timeout' };
    }
  }

  // ── Halyk (and any other non-Freedom-Pay provider): unchanged existing behavior ──
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
