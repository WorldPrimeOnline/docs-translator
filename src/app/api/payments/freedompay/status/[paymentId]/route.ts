/**
 * Freedom Pay payment status — session-authed frontend polling endpoint.
 * Mirrors src/app/api/payments/halyk/status/[paymentId]/route.ts's on-demand
 * reconciliation shape: if non-terminal and the last provider check is stale, calls
 * Freedom Pay's Status API directly and finalizes if confirmed — recovers from a
 * missed Result URL delivery while the customer is sitting on the result page.
 *
 * No fiscalization call — excluded from this integration entirely.
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { supabaseServer } from '@/lib/supabase/server';
import { checkStatus } from '@/lib/payments/freedompay/client';
import { getFreedomPayConfig } from '@/lib/payments/freedompay/config';
import { mapFreedomPayResult } from '@/lib/payments/freedompay/status-map';
import { notifyOperatorPaymentAlert } from '@/lib/telegram/client';
import { markQuotePaid } from '@/lib/pricing/service';
import { confirmReferral } from '@/lib/referral/server';
import type { Database } from '@/types';

const RECONCILE_COOLDOWN_MS = 12_000;
const TERMINAL_STATUSES = ['paid', 'failed', 'canceled', 'refunded', 'duplicate_charge_review'];

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

function computeCanRetryPayment(status: string, createdAt: string | null): boolean {
  if (['failed', 'canceled'].includes(status)) return true;
  if (status === 'payment_pending' && createdAt) {
    const ageMs = Date.now() - new Date(createdAt).getTime();
    return ageMs > 15 * 60 * 1000;
  }
  return false;
}

function toPublicStatus(status: string): { status: string; isTerminal: boolean } {
  switch (status) {
    case 'paid': return { status: 'paid', isTerminal: true };
    case 'failed': return { status: 'failed', isTerminal: true };
    case 'canceled': return { status: 'canceled', isTerminal: true };
    case 'refunded': return { status: 'refunded', isTerminal: true };
    case 'requires_review':
    case 'duplicate_charge_review': return { status: 'unknown', isTerminal: false };
    default: return { status: 'payment_pending', isTerminal: false };
  }
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: paymentTx, error: txError } = await (supabaseServer as any)
    .from('payment_transactions')
    .select('id, status, amount, currency, paid_at, failed_at, job_id, user_id, quote_id, provider_invoice_id, status_checked_at, created_at')
    .eq('id', paymentId)
    .eq('payment_provider', 'freedom_pay')
    .maybeSingle() as {
      data: {
        id: string; status: string; amount: number; currency: string; paid_at: string | null;
        failed_at: string | null; job_id: string; user_id: string; quote_id: string | null;
        provider_invoice_id: string | null; status_checked_at: string | null; created_at: string;
      } | null;
      error: { message: string } | null;
    };

  if (txError) {
    console.error('[freedompay/status] DB lookup error', { correlationId, error: txError.message });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
  if (!paymentTx || paymentTx.user_id !== user.id) {
    return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
  }

  let currentStatus: string = paymentTx.status;
  let currentPaidAt: string | null = paymentTx.paid_at;
  let currentFailedAt: string | null = paymentTx.failed_at;

  const config = getFreedomPayConfig();
  const isTerminal = TERMINAL_STATUSES.includes(currentStatus);
  const msSinceLastCheck = paymentTx.status_checked_at
    ? Date.now() - new Date(paymentTx.status_checked_at).getTime()
    : Infinity;
  const shouldReconcile = !isTerminal && !!paymentTx.provider_invoice_id && config.enabled && msSinceLastCheck > RECONCILE_COOLDOWN_MS;

  if (shouldReconcile) {
    try {
      const statusResp = await checkStatus(paymentTx.provider_invoice_id!);

      await supabaseServer
        .from('payment_transactions')
        .update({ status_checked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', paymentTx.id);

      const mapped = mapFreedomPayResult(statusResp.pgResult);

      if (mapped === 'paid') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: rpcResult, error: rpcError } = await (supabaseServer as any).rpc('finalize_payment_transaction', {
          p_invoice_id: paymentTx.provider_invoice_id,
          p_transaction_id: statusResp.pgPaymentId ?? null,
          p_provider_status: statusResp.pgResult ?? null,
          p_provider_reason: null,
          p_provider_reason_code: null,
          p_card_mask: null,
          p_card_type: null,
          p_issuer: null,
          p_approval_code: null,
          p_reference: statusResp.pgPaymentId ?? null,
          p_secure: null,
          p_provider_payload: statusResp.raw,
        });

        if (rpcError) {
          console.error('[freedompay/status] finalization RPC error', { correlationId, paymentId: paymentTx.id, error: rpcError.message });
        } else {
          const result = rpcResult as { ok: boolean; duplicate_charge?: boolean; job_id?: string } | null;
          if (result?.duplicate_charge) {
            currentStatus = 'duplicate_charge_review';
            console.error('[freedompay/status] DUPLICATE CHARGE detected', { correlationId, paymentId: paymentTx.id, jobId: result.job_id });
            void notifyOperatorPaymentAlert({
              paymentId: paymentTx.id,
              invoiceId: paymentTx.provider_invoice_id,
              jobId: result.job_id ?? paymentTx.job_id,
              quoteId: paymentTx.quote_id,
              amountKzt: paymentTx.amount,
              currency: paymentTx.currency,
              providerStatus: statusResp.pgResult ?? null,
              reason: 'DUPLICATE CHARGE — second successful Freedom Pay charge detected via status polling for an already-paid job.',
              env: 'staging/test',
            });
          } else if (result?.ok) {
            currentStatus = 'paid';
            currentPaidAt = new Date().toISOString();
            const quoteId = paymentTx.quote_id;
            if (quoteId) {
              await markQuotePaid(quoteId, paymentTx.id).catch((err) => {
                console.error('[freedompay/status] markQuotePaid failed (non-fatal)', { correlationId, error: (err as Error).message });
              });
            }
            if (result.job_id) {
              await confirmReferral(result.job_id, quoteId).catch((err) => {
                console.error('[freedompay/status] confirmReferral failed (non-fatal)', { correlationId, error: (err as Error).message });
              });
            }
          }
        }
      } else if (mapped === 'failed') {
        const now = new Date().toISOString();
        await supabaseServer
          .from('payment_transactions')
          .update({ status: 'failed', failed_at: now, updated_at: now })
          .eq('id', paymentTx.id);
        currentStatus = 'failed';
        currentFailedAt = now;
      }
    } catch (err) {
      console.error('[freedompay/status] provider reconciliation failed', {
        correlationId, paymentId: paymentTx.id, error: (err as Error).message,
      });
    }
  }

  const publicStatus = toPublicStatus(currentStatus);
  const retryAllowed = computeCanRetryPayment(currentStatus, paymentTx.created_at ?? null);

  return NextResponse.json({
    paymentId: paymentTx.id,
    status: publicStatus.status,
    amount: paymentTx.amount,
    currency: paymentTx.currency,
    paidAt: currentPaidAt ?? null,
    failedAt: currentFailedAt ?? null,
    jobId: paymentTx.job_id,
    isTerminal: publicStatus.isTerminal,
    isSuccess: publicStatus.status === 'paid',
    isFailure: ['failed', 'canceled'].includes(publicStatus.status),
    isAuthorized: false,
    canRetryPayment: retryAllowed,
    skippedProviderCheck: !shouldReconcile,
    messageCode: null,
    nextProviderCheckAfter: paymentTx.status_checked_at
      ? new Date(new Date(paymentTx.status_checked_at).getTime() + RECONCILE_COOLDOWN_MS).toISOString()
      : null,
    lastCheckedAt: paymentTx.status_checked_at ?? null,
  });
}
