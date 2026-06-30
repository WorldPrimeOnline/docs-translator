/**
 * Reconciliation cron for Halyk ePay refunds.
 *
 * The operator issues refunds manually via the Halyk merchant cabinet.
 * This cron detects those refunds by checking the Halyk Status API and
 * reconciles local state:
 *
 *   1. Find paid payment_transactions (no refunded_at) paid within the last 30 days.
 *   2. Call Halyk Status API for each.
 *   3. On REFUND/CANCEL statusName: update local state atomically.
 *   4. Create/link a refund_transactions row (idempotent via idempotency_key).
 *   5. Trigger fiscal refund receipt creation if a sale receipt exists.
 *   6. Update jobs.status = 'refunded' if job was not already processed.
 *   7. Alert operator via Telegram.
 *
 * Safety rules:
 * - Never mark refunded unless Halyk status API confirms it.
 * - Never create duplicate refund_transactions (unique idempotency_key).
 * - Never create fiscal refund receipt if sale receipt does not exist.
 * - Never mark jobs.status = 'delivered' or 'completed'.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { checkPaymentStatus } from '@/lib/payments/halyk/client';
import { getHalykConfig } from '@/lib/payments/halyk/config';
import { notifyOperatorPaymentAlert } from '@/lib/telegram/client';

const BATCH_LIMIT = 15;
const LOOKBACK_DAYS = 30;
const COOLDOWN_MINUTES = 60; // min gap between checks for the same paid tx

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
  const lookbackCutoff = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const cooldownCutoff = new Date(now.getTime() - COOLDOWN_MINUTES * 60 * 1000).toISOString();

  // Find paid transactions that might have been refunded by the operator
  // - status = 'paid' (not yet reconciled to refunded)
  // - refunded_at IS NULL (not already reconciled)
  // - paid within the lookback window
  // - status_checked_at is either NULL or older than cooldown (to prevent Halyk API spam)
  const { data: candidates, error } = await supabaseServer
    .from('payment_transactions')
    .select('id, provider_invoice_id, job_id, amount, currency, status, paid_at, status_checked_at, provider_environment')
    .eq('status', 'paid')
    .is('refunded_at', null)
    .eq('payment_provider', 'halyk_epay')
    .eq('provider_environment', config.mode)
    .gt('paid_at', lookbackCutoff)
    .or(`status_checked_at.is.null,status_checked_at.lt.${cooldownCutoff}`)
    .order('paid_at', { ascending: true })
    .limit(BATCH_LIMIT);

  if (error) {
    console.error('[reconcile-refunds] DB fetch failed:', error.message);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }

  if (!candidates || candidates.length === 0) {
    return NextResponse.json({ checked: 0, refunded: 0, unchanged: 0 });
  }

  let checked = 0;
  let refunded = 0;
  let unchanged = 0;
  let errors = 0;

  for (const tx of candidates) {
    if (!tx.provider_invoice_id) continue;
    checked++;

    try {
      const statusResponse = await checkPaymentStatus(tx.provider_invoice_id);
      const { resultCode, transaction } = statusResponse;
      const statusName = transaction?.statusName?.trim().toUpperCase();

      // Update status_checked_at on every call to enforce cooldown
      await supabaseServer
        .from('payment_transactions')
        .update({ status_checked_at: now.toISOString(), updated_at: now.toISOString() })
        .eq('id', tx.id);

      const isRefund = resultCode === 100 && (statusName === 'REFUND' || statusName === 'CANCEL' || statusName === 'CANCEL_OLD');

      if (!isRefund) {
        unchanged++;
        continue;
      }

      console.log('[reconcile-refunds] Halyk confirmed refund for payment:', tx.id, {
        invoiceId: tx.provider_invoice_id,
        jobId: tx.job_id,
        statusName,
        resultCode,
      });

      // Atomically update payment_transactions to refunded
      const { error: ptErr } = await supabaseServer
        .from('payment_transactions')
        .update({
          status: 'refunded',
          provider_status: statusName ?? null,
          provider_reason: transaction?.reason ?? null,
          provider_reason_code: transaction?.reasonCode ?? null,
          refunded_at: now.toISOString(),
          updated_at: now.toISOString(),
          provider_payload: {
            refundReconciliation: true,
            resultCode,
            statusName,
            transactionId: transaction?.transactionId ?? transaction?.id ?? null,
            approvalCode: transaction?.approvalCode ?? null,
            reference: transaction?.reference ?? null,
            reconciledAt: now.toISOString(),
          },
        })
        .eq('id', tx.id)
        .eq('status', 'paid'); // guard: only update if still marked paid

      if (ptErr) {
        console.error('[reconcile-refunds] Failed to update payment to refunded:', tx.id, ptErr.message);
        errors++;
        continue;
      }

      // Create idempotent refund_transactions row
      const idempotencyKey = `halyk-refund-reconcile-${tx.id}`;
      const { error: rtErr } = await supabaseServer
        .from('refund_transactions')
        .upsert(
          {
            job_id: tx.job_id,
            payment_transaction_id: tx.id,
            provider: 'halyk_epay',
            provider_environment: tx.provider_environment ?? config.mode,
            refund_amount_kzt: Math.round(tx.amount),
            currency: 'KZT',
            status: 'succeeded',
            reason: `Halyk cabinet refund reconciled — statusName=${statusName}`,
            idempotency_key: idempotencyKey,
            processed_at: now.toISOString(),
            updated_at: now.toISOString(),
          },
          { onConflict: 'idempotency_key', ignoreDuplicates: true },
        );

      if (rtErr) {
        console.warn('[reconcile-refunds] refund_transactions upsert failed (non-fatal):', tx.id, rtErr.message);
      }

      // Update job to refunded if it hasn't progressed to a delivery/completion state
      // Do NOT overwrite completed/delivered/failed-after-delivery states
      const SAFE_TO_REFUND_JOB_STATUSES = ['payment_pending', 'queued', 'ocr_in_progress', 'ocr_completed', 'translation_in_progress', 'pdf_rendering', 'failed'];
      const { data: jobRow } = await supabaseServer
        .from('jobs')
        .select('id, status')
        .eq('id', tx.job_id)
        .maybeSingle();

      if (jobRow && SAFE_TO_REFUND_JOB_STATUSES.includes(jobRow.status)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: jobErr } = await (supabaseServer as any)
          .from('jobs')
          .update({ status: 'refunded' })
          .eq('id', tx.job_id)
          .in('status', SAFE_TO_REFUND_JOB_STATUSES);

        if (jobErr) {
          console.warn('[reconcile-refunds] job status update failed (non-fatal):', tx.job_id, jobErr.message);
        } else {
          console.log('[reconcile-refunds] job marked refunded:', tx.job_id);
        }
      } else if (jobRow) {
        console.log('[reconcile-refunds] job status not updated (already in terminal/delivery state):', tx.job_id, jobRow.status);
      }

      // Check if fiscal sale receipt exists — only then create refund receipt
      const { data: saleReceipt } = await supabaseServer
        .from('fiscal_receipts')
        .select('id, status')
        .eq('payment_transaction_id', tx.id)
        .eq('operation_type', 'sale')
        .maybeSingle();

      if (saleReceipt) {
        // Check for existing refund receipt (idempotency)
        const { data: existingRefundReceipt } = await supabaseServer
          .from('fiscal_receipts')
          .select('id')
          .eq('payment_transaction_id', tx.id)
          .eq('operation_type', 'refund')
          .maybeSingle();

        if (!existingRefundReceipt) {
          console.log('[reconcile-refunds] queuing fiscal refund receipt for payment:', tx.id);
          const { error: frErr } = await supabaseServer
            .from('fiscal_receipts')
            .insert({
              job_id: tx.job_id,
              document_id: (await supabaseServer.from('jobs').select('document_id').eq('id', tx.job_id).maybeSingle()).data?.document_id ?? tx.job_id,
              payment_transaction_id: tx.id,
              provider: 'manual',
              provider_environment: tx.provider_environment ?? config.mode,
              amount_kzt: Math.round(tx.amount),
              currency: 'KZT',
              operation_type: 'refund',
              status: 'pending_manual',
              receipt_payload_sanitized: {
                refundReason: `Halyk cabinet refund reconciled — statusName=${statusName}`,
                originalSaleReceiptId: saleReceipt.id,
                reconciledAt: now.toISOString(),
              },
            });
          if (frErr && frErr.code !== '23505') {
            console.warn('[reconcile-refunds] fiscal refund receipt creation failed:', tx.id, frErr.message);
          }
        }
      } else {
        console.warn('[reconcile-refunds] NO sale fiscal receipt found — skipping refund receipt creation:', tx.id, {
          invoiceId: tx.provider_invoice_id,
        });
      }

      // Alert operator
      void notifyOperatorPaymentAlert({
        paymentId: tx.id,
        invoiceId: tx.provider_invoice_id,
        jobId: tx.job_id,
        quoteId: null,
        amountKzt: tx.amount,
        currency: tx.currency,
        providerStatus: statusName ?? null,
        reason: `Halyk refund reconciled — local status updated to refunded. statusName=${statusName}. Manual fiscal receipt required if sale receipt exists.`,
        env: config.mode === 'test' ? 'staging/test' : 'production',
      });

      refunded++;
    } catch (err) {
      console.error('[reconcile-refunds] error checking tx:', tx.id, (err as Error).message);
      errors++;
    }

    // Delay between Halyk API calls
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`[reconcile-refunds] checked=${checked} refunded=${refunded} unchanged=${unchanged} errors=${errors}`);

  return NextResponse.json({ checked, refunded, unchanged, errors });
}
