/**
 * Reconciliation cron for pending Freedom Pay payments — server-side fallback for
 * missed/blocked Result URL deliveries.
 *
 * Added 2026-08-21 alongside the Vercel Deployment Protection fix (see
 * docs/ai-context/DECISIONS.md): before this route existed, a Freedom Pay payment
 * only ever reconciled via the customer polling GET /api/payments/freedompay/status/
 * [paymentId] on /payment/result. A customer who paid and closed the browser before
 * that poll fired had no path back to 'paid' at all. This is a SEPARATE endpoint from
 * /api/cron/reconcile-payments (Halyk-only) — that route is intentionally untouched.
 *
 * Finds payment_pending / requires_review payment_transactions rows for
 * payment_provider='freedom_pay', checks status with get_status3.php, and finalizes
 * via the shared finalize_payment_transaction RPC on success. Mirrors
 * reconcile-payments/route.ts's shape (batch limit, min/max age window, CRON_SECRET
 * auth) so operators reading one understand the other.
 *
 * No fiscalization call — Freedom Pay is explicitly out of scope for fiscalization,
 * same as the result/status routes (see their doc comments).
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { checkStatus } from '@/lib/payments/freedompay/client';
import { mapFreedomPayPaymentStatus } from '@/lib/payments/freedompay/status-map';
import { getFreedomPayConfig } from '@/lib/payments/freedompay/config';
import { markQuotePaid } from '@/lib/pricing/service';
import { confirmReferral } from '@/lib/referral/server';
import { notifyOperatorPaymentAlert } from '@/lib/telegram/client';

const BATCH_LIMIT = 20;
const MIN_AGE_MINUTES = 2;    // don't reconcile brand-new attempts (give the Result URL a chance first)
const MAX_AGE_HOURS = 24;     // stop checking after 24h

interface Candidate {
  id: string;
  provider_invoice_id: string | null;
  amount: number;
  currency: string;
  status: string;
  job_id: string;
  quote_id: string | null;
  created_at: string;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const config = getFreedomPayConfig();
  if (!config.enabled) {
    return NextResponse.json({ skipped: true, reason: 'freedompay_disabled' });
  }

  const now = new Date();
  const minAge = new Date(now.getTime() - MIN_AGE_MINUTES * 60 * 1000).toISOString();
  const maxAge = new Date(now.getTime() - MAX_AGE_HOURS * 60 * 60 * 1000).toISOString();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: candidates, error } = await (supabaseServer as any)
    .from('payment_transactions')
    .select('id, provider_invoice_id, amount, currency, status, job_id, quote_id, created_at')
    .in('status', ['payment_pending', 'requires_review'])
    .eq('payment_provider', 'freedom_pay')
    .lt('created_at', minAge)
    .gt('created_at', maxAge)
    .order('created_at', { ascending: true })
    .limit(BATCH_LIMIT) as { data: Candidate[] | null; error: { message: string } | null };

  if (error) {
    console.error('[reconcile-freedompay-payments] DB fetch failed:', error.message);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }

  if (!candidates || candidates.length === 0) {
    return NextResponse.json({ reconciled: 0, total: 0 });
  }

  let finalized = 0;
  let failed = 0;
  let stillPending = 0;
  let errors = 0;

  for (const tx of candidates) {
    if (!tx.provider_invoice_id) continue;

    try {
      const statusResp = await checkStatus(tx.provider_invoice_id);
      const checkedAt = new Date().toISOString();

      // Persist the breadcrumb unconditionally, exactly like the status/result routes
      // — this cron shares status_checked_at ownership with them, never
      // finalize_payment_transaction (see migration 0071 / docs/ai-context/DECISIONS.md).
      const breadcrumb: Record<string, unknown> = { status_checked_at: checkedAt, updated_at: checkedAt };
      if (statusResp.pgPaymentId) breadcrumb.provider_transaction_id = statusResp.pgPaymentId;
      if (statusResp.pgPaymentStatus) breadcrumb.provider_status = statusResp.pgPaymentStatus;
      if (statusResp.pgErrorDescription || statusResp.pgErrorCode) {
        breadcrumb.provider_reason = statusResp.pgErrorDescription ?? statusResp.pgErrorCode;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabaseServer as any).from('payment_transactions').update(breadcrumb).eq('id', tx.id);

      const mapped = mapFreedomPayPaymentStatus(statusResp.pgPaymentStatus);

      if (mapped === 'paid') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: rpcResult, error: rpcError } = await (supabaseServer as any).rpc('finalize_payment_transaction', {
          p_invoice_id: tx.provider_invoice_id,
          p_transaction_id: statusResp.pgPaymentId ?? null,
          p_provider_status: statusResp.pgPaymentStatus ?? null,
          p_provider_reason: statusResp.pgErrorDescription ?? null,
          p_provider_reason_code: statusResp.pgErrorCode ?? null,
          p_card_mask: null,
          p_card_type: null,
          p_issuer: null,
          p_approval_code: null,
          p_reference: statusResp.pgPaymentId ?? null,
          p_secure: null,
          p_provider_payload: statusResp.raw,
        });

        if (rpcError) {
          console.error('[reconcile-freedompay-payments] RPC error for tx:', tx.id, rpcError.message);
          errors++;
        } else {
          const rpcData = rpcResult as { ok: boolean; duplicate_charge?: boolean; job_id?: string } | null;

          if (rpcData?.duplicate_charge) {
            console.error('[reconcile-freedompay-payments] DUPLICATE CHARGE detected for tx:', tx.id, 'job:', rpcData.job_id);
            void notifyOperatorPaymentAlert({
              paymentId: tx.id,
              invoiceId: tx.provider_invoice_id,
              jobId: rpcData.job_id ?? tx.job_id,
              quoteId: tx.quote_id,
              amountKzt: tx.amount,
              currency: tx.currency,
              providerStatus: statusResp.pgPaymentStatus ?? null,
              reason: 'DUPLICATE CHARGE — second successful Freedom Pay charge detected via fallback reconciliation cron for an already-paid job. Immediate manual refund review required.',
              env: 'staging/test',
            });
          } else if (rpcData?.ok) {
            finalized++;
            const quoteId = tx.quote_id;
            if (quoteId) {
              await markQuotePaid(quoteId, tx.id).catch((err) => {
                console.error('[reconcile-freedompay-payments] markQuotePaid failed (non-fatal):', (err as Error).message, { txId: tx.id });
              });
            }
            if (rpcData.job_id) {
              await confirmReferral(rpcData.job_id, quoteId).catch((err) => {
                console.error('[reconcile-freedompay-payments] confirmReferral failed (non-fatal):', (err as Error).message, { txId: tx.id });
              });
            }
          }
        }
      } else if (mapped === 'failed') {
        await supabaseServer
          .from('payment_transactions')
          .update({ status: 'failed', failed_at: checkedAt })
          .eq('id', tx.id);
        failed++;
      } else {
        // process/pending/unknown — breadcrumb already persisted above, leave status
        // untouched. 'unknown' is treated the same as pending (never finalize).
        stillPending++;
      }
    } catch (err) {
      console.error('[reconcile-freedompay-payments] error processing tx:', tx.id, (err as Error).message);
      errors++;
    }

    // Small delay between Freedom Pay API calls to avoid rate-limiting — mirrors
    // reconcile-payments/route.ts's cadence.
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`[reconcile-freedompay-payments] total=${candidates.length} finalized=${finalized} failed=${failed} pending=${stillPending} errors=${errors}`);

  return NextResponse.json({
    total: candidates.length,
    finalized,
    failed,
    stillPending,
    errors,
  });
}
