/**
 * Internal payment status endpoint for frontend polling.
 * Requires user session. Returns only data the user is allowed to see.
 * NEVER uses query params (success=true etc.) to determine paid status.
 *
 * On-demand reconciliation: if the payment is still pending and the last provider
 * check is stale (or has never happened), this endpoint calls the Halyk Status API
 * directly and finalizes the payment if confirmed. This handles the case where the
 * Halyk postLink callback was not delivered.
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { supabaseServer } from '@/lib/supabase/server';
import { checkPaymentStatus, HalykApiError } from '@/lib/payments/halyk/client';
import { getHalykConfig } from '@/lib/payments/halyk/config';
import { mapHalykStatus, isPaidStatus, isTerminalStatus } from '@/lib/payments/halyk/status-map';
import type { InternalPaymentStatus } from '@/lib/payments/halyk/types';
import type { Database } from '@/types';

const RECONCILE_COOLDOWN_MS = 12_000; // min seconds between Halyk API calls per transaction

async function getAuthUser() {
  const cookieStore = await cookies();
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    },
  );
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
): Promise<NextResponse> {
  const correlationId = crypto.randomUUID();
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { paymentId } = await params;

  // Load payment transaction and verify ownership
  const { data: paymentTx, error: txError } = await supabaseServer
    .from('payment_transactions')
    .select('id, status, amount, currency, paid_at, failed_at, job_id, user_id, provider_invoice_id, status_checked_at')
    .eq('id', paymentId)
    .maybeSingle();

  if (txError) {
    console.error('[halyk/status] DB lookup error', { correlationId, error: txError.message });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }

  if (!paymentTx) {
    return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
  }

  if (paymentTx.user_id !== user.id) {
    return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
  }

  console.log('[halyk/status] checking payment status', {
    correlationId,
    paymentTransactionId: paymentTx.id,
    jobId: paymentTx.job_id,
    providerInvoiceId: paymentTx.provider_invoice_id ? '[present]' : '[absent]',
    internalStatusBefore: paymentTx.status,
    lastStatusCheckedAt: paymentTx.status_checked_at,
  });

  // ── On-demand reconciliation ───────────────────────────────────────────────
  let currentStatus: string = paymentTx.status;
  let currentPaidAt: string | null = paymentTx.paid_at;
  let currentFailedAt: string | null = paymentTx.failed_at;

  const config = getHalykConfig();
  const alreadyTerminal = isTerminalStatus(currentStatus as InternalPaymentStatus);

  const msSinceLastCheck = paymentTx.status_checked_at
    ? Date.now() - new Date(paymentTx.status_checked_at).getTime()
    : Infinity;

  const shouldReconcile =
    !alreadyTerminal &&
    !!paymentTx.provider_invoice_id &&
    config.enabled &&
    msSinceLastCheck > RECONCILE_COOLDOWN_MS;

  let providerCheckSkippedReason: string | null = null;
  if (alreadyTerminal) providerCheckSkippedReason = 'already_terminal';
  else if (!paymentTx.provider_invoice_id) providerCheckSkippedReason = 'no_invoice_id';
  else if (!config.enabled) providerCheckSkippedReason = 'halyk_disabled';
  else if (msSinceLastCheck <= RECONCILE_COOLDOWN_MS) providerCheckSkippedReason = 'cooldown';

  if (shouldReconcile) {
    // Note: status_checked_at is updated AFTER a successful API response (not before),
    // so that parse/network errors do not permanently block retries via cooldown.
    // A small thundering-herd risk is acceptable given the 12s cooldown applies on success.

    let providerResultCode: number | undefined;
    let providerStatusName: string | undefined;
    let finalizeAttempted = false;
    let finalizeSucceeded = false;
    let finalizeError: string | undefined;

    try {
      const statusResp = await checkPaymentStatus(paymentTx.provider_invoice_id!);

      // Success: stamp the cooldown timestamp now that we have a valid response
      await supabaseServer
        .from('payment_transactions')
        .update({ status_checked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', paymentTx.id);
      providerResultCode = statusResp.resultCode;
      providerStatusName = statusResp.transaction?.statusName;

      const mappedStatus = mapHalykStatus(
        statusResp.resultCode,
        statusResp.transaction?.statusName,
      );

      if (isPaidStatus(mappedStatus)) {
        finalizeAttempted = true;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: rpcResult, error: rpcError } = await (supabaseServer as any).rpc(
          'finalize_halyk_payment',
          {
            p_invoice_id: paymentTx.provider_invoice_id,
            p_transaction_id: statusResp.transaction?.transactionId ?? null,
            p_provider_status: statusResp.transaction?.statusName ?? null,
            p_provider_reason: statusResp.transaction?.reason ?? null,
            p_provider_reason_code: statusResp.transaction?.reasonCode ?? null,
            p_card_mask: statusResp.transaction?.cardMask ?? null,
            p_card_type: statusResp.transaction?.cardType ?? null,
            p_issuer: statusResp.transaction?.issuer ?? null,
            p_approval_code: statusResp.transaction?.approvalCode ?? null,
            p_reference: statusResp.transaction?.reference ?? null,
            p_secure: statusResp.transaction?.secure ?? null,
            p_provider_payload: { resultCode: statusResp.resultCode, statusName: providerStatusName },
          },
        );

        if (rpcError) {
          finalizeError = rpcError.message;
          console.error('[halyk/status] finalization RPC error', {
            correlationId,
            paymentId: paymentTx.id,
            rpcError: rpcError.message,
          });
        } else {
          finalizeSucceeded = true;
          currentStatus = 'paid';
          currentPaidAt = new Date().toISOString();

          const result = rpcResult as { duplicate_charge?: boolean; job_id?: string } | null;
          if (result?.duplicate_charge) {
            currentStatus = 'duplicate_charge_review';
            console.error('[halyk/status] DUPLICATE CHARGE detected', {
              correlationId,
              paymentId: paymentTx.id,
              jobId: result.job_id,
            });
          }
        }
      } else if (['failed', 'canceled'].includes(mappedStatus)) {
        // Update to terminal failure status
        const now = new Date().toISOString();
        await supabaseServer
          .from('payment_transactions')
          .update({
            status: mappedStatus,
            provider_status: providerStatusName ?? null,
            failed_at: now,
            updated_at: now,
          })
          .eq('id', paymentTx.id);
        currentStatus = mappedStatus;
        currentFailedAt = now;
      } else {
        // Non-terminal non-paid: update provider_status for diagnostics
        await supabaseServer
          .from('payment_transactions')
          .update({
            provider_status: providerStatusName ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', paymentTx.id);
        currentStatus = mappedStatus;
      }
    } catch (err) {
      const isHalyk = err instanceof HalykApiError;
      console.error('[halyk/status] provider reconciliation failed', {
        correlationId,
        paymentId: paymentTx.id,
        code: isHalyk ? err.code : 'UNKNOWN',
        httpStatus: isHalyk ? err.httpStatus : undefined,
        responseBodySnippetSanitized: isHalyk ? err.responseBodySnippet : undefined,
        validationIssues: isHalyk ? err.validationIssues : undefined,
        halykErrorCode: isHalyk ? err.halykErrorCode : undefined,
        halykErrorDescription: isHalyk ? err.halykErrorDescription : undefined,
        message: err instanceof Error ? err.message : String(err),
      });
      // status_checked_at was NOT updated (cooldown not applied on error) — retry will happen
    }

    console.log('[halyk/status] provider check result', {
      correlationId,
      paymentId: paymentTx.id,
      providerResultCode,
      providerStatusName,
      mappedInternalStatus: currentStatus,
      finalizeAttempted,
      finalizeSucceeded,
      finalizeError,
    });
  } else {
    console.log('[halyk/status] skipped provider check', {
      correlationId,
      paymentId: paymentTx.id,
      reason: providerCheckSkippedReason,
      currentStatus,
    });
  }

  return NextResponse.json({
    paymentId: paymentTx.id,
    status: currentStatus,
    amount: paymentTx.amount,
    currency: paymentTx.currency,
    paidAt: currentPaidAt ?? null,
    failedAt: currentFailedAt ?? null,
    jobId: paymentTx.job_id,
  });
}
