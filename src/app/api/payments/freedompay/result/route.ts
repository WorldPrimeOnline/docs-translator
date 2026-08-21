/**
 * Freedom Pay Result URL — public server-to-server endpoint. No session dependency.
 * Mirrors src/app/api/payments/halyk/callback/route.ts's defense-in-depth posture:
 * pg_result is never trusted alone — a successful result always triggers an
 * authoritative get_status3.php confirmation before finalizing.
 *
 * Freedom Pay retries this endpoint every 30 min for up to 2 hours on any non-200
 * response, and requires retries to receive the SAME response as the original
 * delivery. WPO does not regenerate pg_salt/pg_sig per retry: the first ACK computed
 * for a payment's terminal outcome is persisted into the existing
 * payment_transactions.provider_payload JSONB (`_wpo_response` key, no schema
 * migration) and replayed verbatim on every subsequent delivery for that payment.
 *
 * No fiscalization calls anywhere in this route, per explicit scope exclusion —
 * Freedom Pay payment/refund and the future cash register for the current entity are
 * two separate tasks. Does not check the card-payments entity flag in
 * src/lib/business-profile.ts — that flag is Halyk-only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { getFreedomPayConfig } from '@/lib/payments/freedompay/config';
import { verifySignature } from '@/lib/payments/freedompay/signature';
import { buildResultAck, resultAckToXml, FREEDOMPAY_RESULT_SCRIPT_NAME, type FreedomPayAckFields } from '@/lib/payments/freedompay/result-ack';
import { checkStatus, type StatusResult } from '@/lib/payments/freedompay/client';
import { mapFreedomPayResult, mapFreedomPayPaymentStatus } from '@/lib/payments/freedompay/status-map';
import { markQuotePaid } from '@/lib/pricing/service';
import { notifyOperatorPaymentAlert } from '@/lib/telegram/client';
import { confirmReferral } from '@/lib/referral/server';

const TERMINAL_STATUSES = ['paid', 'failed', 'canceled', 'refunded', 'duplicate_charge_review'];

function xmlResponse(ack: FreedomPayAckFields): NextResponse {
  return new NextResponse(resultAckToXml(ack), {
    status: 200,
    headers: { 'Content-Type': 'application/xml' },
  });
}

function describeStatus(status: string): string {
  switch (status) {
    case 'paid': return 'Order paid';
    case 'failed': return 'Order failed';
    case 'canceled': return 'Order canceled';
    case 'refunded': return 'Order refunded';
    case 'duplicate_charge_review': return 'Received — under review';
    default: return 'Received';
  }
}

/** Read-modify-write merge into provider_payload so we never clobber fields the
 * finalization RPC (or an earlier branch of this same request) already wrote. */
async function storeAck(paymentId: string, ack: FreedomPayAckFields): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabaseServer as any)
    .from('payment_transactions')
    .select('provider_payload')
    .eq('id', paymentId)
    .maybeSingle() as { data: { provider_payload: Record<string, unknown> | null } | null };

  const existing = data?.provider_payload ?? {};
  await supabaseServer
    .from('payment_transactions')
    .update({
      provider_payload: { ...existing, _wpo_response: ack } as unknown as import('@/types/supabase').Json,
      updated_at: new Date().toISOString(),
    })
    .eq('id', paymentId);
}

function sanitiseForStorage(payload: Record<string, string>): Record<string, string> {
  const EXCLUDED = new Set(['pg_sig', 'pg_card_pan', 'pg_card_cvv', 'pg_card_exp']);
  return Object.fromEntries(Object.entries(payload).filter(([k]) => !EXCLUDED.has(k)));
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const config = getFreedomPayConfig();
  const correlationId = crypto.randomUUID();

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (err) {
    console.warn('[freedompay/result] body parse error', { correlationId, error: (err as Error).message });
    return xmlResponse(buildResultAck('error', 'Bad request'));
  }

  const payload: Record<string, string> = {};
  formData.forEach((value, key) => {
    if (typeof value === 'string') payload[key] = value;
  });

  console.log('[freedompay/result] received', {
    correlationId,
    fieldKeys: Object.keys(payload),
    pgOrderId: payload.pg_order_id,
    pgResult: payload.pg_result,
  });

  const pgOrderId = payload.pg_order_id;
  const pgSig = payload.pg_sig;
  if (!pgOrderId || !pgSig) {
    console.warn('[freedompay/result] missing pg_order_id or pg_sig', { correlationId });
    return xmlResponse(buildResultAck('error', 'Missing required fields'));
  }

  if (!config.enabled) {
    console.error('[freedompay/result] received callback while Freedom Pay disabled', { correlationId, pgOrderId });
    return xmlResponse(buildResultAck('error', 'Not configured'));
  }

  // Signature must be verified over exactly the fields Freedom Pay sent, excluding
  // pg_sig itself.
  const fieldsForVerification: Record<string, string> = { ...payload };
  delete fieldsForVerification.pg_sig;

  if (!verifySignature(FREEDOMPAY_RESULT_SCRIPT_NAME, fieldsForVerification, config.secretKey, pgSig)) {
    console.error('[freedompay/result] signature verification failed', { correlationId, pgOrderId });
    return xmlResponse(buildResultAck('error', 'Invalid signature'));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: paymentTx } = await (supabaseServer as any)
    .from('payment_transactions')
    .select('id, status, amount, currency, job_id, quote_id, provider_payload')
    .eq('provider_invoice_id', pgOrderId)
    .maybeSingle() as {
      data: {
        id: string; status: string; amount: number; currency: string;
        job_id: string; quote_id: string | null; provider_payload: Record<string, unknown> | null;
      } | null;
    };

  if (!paymentTx) {
    // Do not reveal whether the invoice exists — mirrors Halyk callback's posture.
    console.warn('[freedompay/result] unknown order', { correlationId, pgOrderId });
    return xmlResponse(buildResultAck('error', 'Unknown order'));
  }

  // callback_received_at is stamped HERE ONLY — this is the exclusive writer for that
  // column (see migration 0071). A signature-verified POST matching a known payment
  // row is, by definition, a real inbound Result URL delivery, regardless of what
  // outcome branch runs next — including idempotent retries, which re-stamp the same
  // fact rather than leaving it stale. finalize_payment_transaction (called from this
  // route AND from the unrelated on-demand status route) deliberately no longer
  // touches this column, so its presence can no longer be confused with a status-route
  // reconciliation. Never include this timestamp or the request URL in provider_payload
  // — it is WPO-internal delivery evidence, not part of Freedom Pay's payload.
  await supabaseServer
    .from('payment_transactions')
    .update({ callback_received_at: new Date().toISOString() })
    .eq('id', paymentTx.id);

  // Idempotency: an earlier delivery already computed and stored the ACK for this
  // payment's terminal outcome — replay it verbatim, never recompute salt/sig.
  const storedAck = paymentTx.provider_payload?._wpo_response as FreedomPayAckFields | undefined;
  if (storedAck) {
    console.log('[freedompay/result] replaying stored ACK', { correlationId, paymentId: paymentTx.id });
    return xmlResponse(storedAck);
  }

  // Already terminal locally (e.g. finalized via the on-demand status route instead
  // of this callback) but no ACK stored yet for THIS delivery — compute once, store,
  // so any further retry hits the fast path above.
  if (TERMINAL_STATUSES.includes(paymentTx.status)) {
    const ack = buildResultAck('ok', describeStatus(paymentTx.status));
    await storeAck(paymentTx.id, ack);
    return xmlResponse(ack);
  }

  // ── Amount/currency validation against the stored snapshot ──────────────────
  const pgAmount = payload.pg_amount;
  const pgCurrency = payload.pg_currency ?? 'KZT';
  if (pgAmount !== undefined) {
    const providedAmount = Math.round(Number(pgAmount));
    const storedAmount = Math.round(paymentTx.amount);
    if (!Number.isFinite(providedAmount) || providedAmount !== storedAmount || pgCurrency !== paymentTx.currency) {
      console.error('[freedompay/result] amount/currency mismatch', {
        correlationId, paymentId: paymentTx.id, storedAmount, providedAmount,
        storedCurrency: paymentTx.currency, providedCurrency: pgCurrency,
      });
      await supabaseServer
        .from('payment_transactions')
        .update({ status: 'requires_review', updated_at: new Date().toISOString() })
        .eq('id', paymentTx.id);
      void notifyOperatorPaymentAlert({
        paymentId: paymentTx.id,
        invoiceId: pgOrderId,
        jobId: paymentTx.job_id,
        quoteId: paymentTx.quote_id,
        amountKzt: paymentTx.amount,
        currency: paymentTx.currency,
        providerStatus: payload.pg_result ?? null,
        reason: `Freedom Pay amount/currency mismatch — stored ${storedAmount} ${paymentTx.currency}, received ${providedAmount} ${pgCurrency}`,
        env: 'staging/test',
      });
      const ack = buildResultAck('ok', describeStatus('requires_review'));
      await storeAck(paymentTx.id, ack);
      return xmlResponse(ack);
    }
  }

  const mapped = mapFreedomPayResult(payload.pg_result);

  // ── Success path — never trust pg_result alone, confirm via Status API first ──
  // NOTE: the Status API (get_status3.php) and this Result URL callback are DIFFERENT
  // response schemas — pg_result (callback) vs pg_payment_status (Status API). Do not
  // conflate them; see status-map.ts's doc comment for the 2026-08-20 incident this
  // caused (a real provider "error" status was read as an unrecognized field and the
  // payment stayed stuck pending forever).
  if (mapped === 'paid') {
    let statusResp: StatusResult | null = null;
    try {
      statusResp = await checkStatus(pgOrderId);
    } catch (err) {
      console.error('[freedompay/result] status confirmation failed', {
        correlationId, paymentId: paymentTx.id, error: (err as Error).message,
      });
    }

    const providerMapped = statusResp ? mapFreedomPayPaymentStatus(statusResp.pgPaymentStatus) : 'unknown';

    if (statusResp) {
      // Persist sanitized provider breadcrumb fields on every successful get_status3.php
      // response, regardless of outcome — including the 'paid' path, which used to skip
      // this write entirely and fall straight through to the finalize RPC, leaving
      // status_checked_at stale/null even though a check had just happened (2026-08-21
      // observability fix — see docs/ai-context/DECISIONS.md).
      const now = new Date().toISOString();
      const breadcrumb: Record<string, unknown> = { status_checked_at: now, updated_at: now };
      if (statusResp.pgPaymentId) breadcrumb.provider_transaction_id = statusResp.pgPaymentId;
      if (statusResp.pgPaymentStatus) breadcrumb.provider_status = statusResp.pgPaymentStatus;
      if (statusResp.pgErrorDescription || statusResp.pgErrorCode) {
        breadcrumb.provider_reason = statusResp.pgErrorDescription ?? statusResp.pgErrorCode;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabaseServer as any).from('payment_transactions').update(breadcrumb).eq('id', paymentTx.id);

      if (providerMapped === 'failed') {
        // Result URL callback said pg_result=1, but the authoritative Status API says
        // error — trust the Status API. Do not touch jobs.status (never was queued).
        // breadcrumb (incl. status_checked_at) already persisted above.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabaseServer as any)
          .from('payment_transactions')
          .update({ status: 'failed', failed_at: now })
          .eq('id', paymentTx.id);
        console.warn('[freedompay/result] pg_result=1 but Status API reports error', {
          correlationId, paymentId: paymentTx.id, pgPaymentStatus: statusResp.pgPaymentStatus,
        });
        const ack = buildResultAck('ok', describeStatus('failed'));
        await storeAck(paymentTx.id, ack);
        return xmlResponse(ack);
      }

      // process/pending/unknown: breadcrumb already persisted above — do not finalize,
      // do not store an ACK yet (leave room for a future retry or on-demand reconciliation).
    }

    if (providerMapped !== 'paid') {
      console.warn('[freedompay/result] pg_result=1 but Status API does not yet confirm success', {
        correlationId, paymentId: paymentTx.id, statusApiPaymentStatus: statusResp?.pgPaymentStatus ?? null,
      });
      return xmlResponse(buildResultAck('ok', 'Received — pending confirmation'));
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rpcResult, error: rpcError } = await (supabaseServer as any).rpc('finalize_payment_transaction', {
      p_invoice_id: pgOrderId,
      p_transaction_id: statusResp?.pgPaymentId ?? payload.pg_payment_id ?? null,
      p_provider_status: statusResp?.pgPaymentStatus ?? payload.pg_result ?? null,
      p_provider_reason: statusResp?.pgErrorDescription ?? payload.pg_description ?? null,
      p_provider_reason_code: null,
      p_card_mask: payload.pg_card_pan ?? null,
      p_card_type: payload.pg_card_brand ?? null,
      p_issuer: null,
      p_approval_code: null,
      p_reference: payload.pg_payment_id ?? null,
      p_secure: null,
      p_provider_payload: sanitiseForStorage(payload),
    });

    if (rpcError) {
      console.error('[freedompay/result] finalization RPC error', { correlationId, paymentId: paymentTx.id, error: rpcError.message });
      // Do not store this ACK as final — a retry should try finalization again.
      return xmlResponse(buildResultAck('ok', 'Received — pending finalization'));
    }

    const result = rpcResult as { ok: boolean; duplicate_charge?: boolean; job_id?: string; already_paid?: boolean } | null;

    if (result?.duplicate_charge) {
      console.error('[freedompay/result] DUPLICATE CHARGE detected', { correlationId, paymentId: paymentTx.id, jobId: result.job_id });
      void notifyOperatorPaymentAlert({
        paymentId: paymentTx.id,
        invoiceId: pgOrderId,
        jobId: result.job_id ?? paymentTx.job_id,
        quoteId: paymentTx.quote_id,
        amountKzt: paymentTx.amount,
        currency: paymentTx.currency,
        providerStatus: payload.pg_result ?? null,
        reason: 'DUPLICATE CHARGE — a second successful Freedom Pay charge was received for an already-paid job. Immediate manual refund review required.',
        env: 'staging/test',
      });
    } else if (result?.ok && result.job_id) {
      const quoteId = paymentTx.quote_id;
      if (quoteId) {
        await markQuotePaid(quoteId, paymentTx.id).catch((err) => {
          console.error('[freedompay/result] markQuotePaid failed (non-fatal)', { correlationId, error: (err as Error).message });
        });
      }
      await confirmReferral(result.job_id, quoteId).catch((err) => {
        console.error('[freedompay/result] confirmReferral failed (non-fatal)', { correlationId, error: (err as Error).message });
      });
    }

    const finalStatus = result?.duplicate_charge ? 'duplicate_charge_review' : 'paid';
    const ack = buildResultAck('ok', describeStatus(finalStatus));
    await storeAck(paymentTx.id, ack);
    console.log('[freedompay/result] finalized', { correlationId, paymentId: paymentTx.id, finalStatus });
    return xmlResponse(ack);
  }

  // ── Failure path ──────────────────────────────────────────────────────────────
  if (mapped === 'failed') {
    const now = new Date().toISOString();
    await supabaseServer
      .from('payment_transactions')
      .update({
        status: 'failed',
        provider_status: payload.pg_result ?? null,
        provider_reason: payload.pg_description ?? null,
        failed_at: now,
        updated_at: now,
      })
      .eq('id', paymentTx.id);
    const ack = buildResultAck('ok', describeStatus('failed'));
    await storeAck(paymentTx.id, ack);
    return xmlResponse(ack);
  }

  // ── pg_result=2 (incomplete) or unrecognized — acknowledge, nothing terminal yet ──
  return xmlResponse(buildResultAck('ok', 'Received'));
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
