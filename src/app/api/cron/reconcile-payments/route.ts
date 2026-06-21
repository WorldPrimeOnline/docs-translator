/**
 * Reconciliation cron for pending Halyk ePay payments.
 * Runs every 15 minutes via Vercel Cron (see vercel.json).
 * Secured with CRON_SECRET. Not accessible as a user operation.
 *
 * Finds payment_pending / requires_review transactions and checks status with Halyk.
 * On CHARGE: atomically finalizes via RPC.
 * On terminal failure: marks as failed/canceled.
 * On persistent unknown: marks as requires_review.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { checkPaymentStatus } from '@/lib/payments/halyk/client';
import { mapHalykStatus, isPaidStatus, isTerminalStatus } from '@/lib/payments/halyk/status-map';
import { getHalykConfig } from '@/lib/payments/halyk/config';
import { createSaleReceiptForPayment } from '@/lib/fiscal/service';

const BATCH_LIMIT = 20;
const MIN_AGE_MINUTES = 2;    // don't reconcile brand-new attempts
const MAX_AGE_HOURS = 24;     // stop checking after 24h

export async function GET(request: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const config = getHalykConfig();
  if (!config.enabled) {
    return NextResponse.json({ skipped: true, reason: 'halyk_epay_disabled' });
  }

  const now = new Date();
  const minAge = new Date(now.getTime() - MIN_AGE_MINUTES * 60 * 1000).toISOString();
  const maxAge = new Date(now.getTime() - MAX_AGE_HOURS * 60 * 60 * 1000).toISOString();

  // Fetch pending/review transactions within the reconciliation window
  const { data: candidates, error } = await supabaseServer
    .from('payment_transactions')
    .select('id, provider_invoice_id, amount, currency, status, created_at, provider_environment')
    .in('status', ['payment_pending', 'requires_review'])
    .eq('payment_provider', 'halyk_epay')
    .eq('provider_environment', config.mode)
    .lt('created_at', minAge)
    .gt('created_at', maxAge)
    .order('created_at', { ascending: true })
    .limit(BATCH_LIMIT);

  if (error) {
    console.error('[reconcile-payments] DB fetch failed:', error.message);
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
      const statusResponse = await checkPaymentStatus(tx.provider_invoice_id);
      const { resultCode, transaction } = statusResponse;
      const statusName = transaction?.statusName;
      const internalStatus = mapHalykStatus(resultCode, statusName);

      await supabaseServer
        .from('payment_transactions')
        .update({ status_checked_at: now.toISOString(), updated_at: now.toISOString() })
        .eq('id', tx.id);

      if (isPaidStatus(internalStatus)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: rpcError } = await (supabaseServer as any).rpc('finalize_halyk_payment', {
          p_invoice_id: tx.provider_invoice_id,
          p_transaction_id: transaction?.transactionId ?? null,
          p_provider_status: statusName ?? null,
          p_provider_reason: transaction?.reason ?? null,
          p_provider_reason_code: transaction?.reasonCode ?? null,
          p_card_mask: transaction?.cardMask ?? null,
          p_card_type: transaction?.cardType ?? null,
          p_issuer: transaction?.issuer ?? null,
          p_approval_code: transaction?.approvalCode ?? null,
          p_reference: transaction?.reference ?? null,
          p_secure: transaction?.secure ?? null,
          p_provider_payload: { resultCode, statusName, reconciled: true },
        });

        if (rpcError) {
          console.error('[reconcile-payments] RPC error for tx:', tx.id, rpcError.message);
          errors++;
        } else {
          finalized++;
          // Fiscal receipt — non-blocking, idempotent
          void createSaleReceiptForPayment(tx.id).catch((err: unknown) => {
            console.error('[reconcile-payments] fiscal receipt failed (non-fatal):', (err as Error).message, { txId: tx.id });
          });
        }
      } else if (isTerminalStatus(internalStatus)) {
        await supabaseServer
          .from('payment_transactions')
          .update({
            status: internalStatus,
            provider_status: statusName ?? null,
            failed_at: now.toISOString(),
            updated_at: now.toISOString(),
          })
          .eq('id', tx.id);
        failed++;
      } else {
        stillPending++;

        // If stuck in requires_review for too long, flag for operator
        const ageHours = (now.getTime() - new Date(tx.created_at).getTime()) / (1000 * 60 * 60);
        if (ageHours > 1 && internalStatus !== 'payment_pending') {
          console.warn('[reconcile-payments] long-pending requires_review tx:', tx.id,
            'age:', Math.round(ageHours), 'h');
          // TODO: fire operator alert via existing Telegram channel
        }
      }
    } catch (err) {
      console.error('[reconcile-payments] error processing tx:', tx.id, (err as Error).message);
      errors++;
    }

    // Small delay between Halyk API calls to avoid rate-limiting
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`[reconcile-payments] total=${candidates.length} finalized=${finalized} failed=${failed} pending=${stillPending} errors=${errors}`);

  return NextResponse.json({
    total: candidates.length,
    finalized,
    failed,
    stillPending,
    errors,
  });
}
