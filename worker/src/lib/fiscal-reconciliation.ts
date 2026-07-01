/**
 * Worker-side fiscal and refund reconciliation.
 *
 * Runs periodically in the Railway worker (separate from job processing).
 * Does NOT block the translation job poll loop.
 *
 * What it does:
 * 1. Finds fiscal_receipts in pending/retry_required status and logs them for
 *    operator attention. (These can occur if the web app call failed transiently.)
 * 2. Finds refund_transactions in pending_manual status and logs them for operator.
 * 3. Triggers Next.js reconcile-payments and reconcile-refunds cron endpoints
 *    (since vercel.json only allows one cron on the Hobby plan).
 *
 * Statuses NOT auto-retried:
 * - pending_manual: requires operator action
 * - blocked_by_config: requires config change (WEBKASSA_ALLOW_REAL_RECEIPTS)
 * - failed: permanent failure; operator must investigate
 *
 * Throttled: runs every 5 min.
 * Never logs more than MAX_ITEMS_PER_CYCLE items per cycle to avoid log spam.
 */
import { supabase } from './supabase';
import { env } from './env';
import { processPendingFiscalReceipts } from './fiscal-processor';
import { maybeRunScheduledZReport } from './fiscal-z-report';

const MAX_ITEMS_PER_CYCLE = 10;
const RETRY_AFTER_MINUTES = 5;

export async function reconcileFiscalAndRefunds(): Promise<void> {
  // Process pending fiscal receipts through sequential per-cashbox queue (Webkassa requirement).
  // Must run before Z-report to ensure all receipts are issued before shift is closed.
  await processPendingFiscalReceipts();
  await reconcilePendingFiscalReceipts();
  await reconcilePendingRefunds();
  // Z-report runs after receipts are processed — only when no pending receipts remain.
  await maybeRunScheduledZReport();
}

/**
 * Trigger Next.js reconcile-payments cron endpoint from the worker.
 * This runs every 15 minutes from index.ts since vercel.json cannot host
 * additional crons on the Hobby plan.
 */
export async function triggerReconcilePayments(): Promise<void> {
  if (!env.CRON_SECRET) {
    console.warn('[fiscal-reconcile] CRON_SECRET not set — skipping reconcile-payments trigger');
    return;
  }
  try {
    const url = `${env.SITE_URL}/api/cron/reconcile-payments`;
    const resp = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) {
      console.error('[fiscal-reconcile] reconcile-payments returned:', resp.status);
    } else {
      const body = await resp.json() as Record<string, unknown>;
      console.info('[fiscal-reconcile] reconcile-payments result:', body);
    }
  } catch (err) {
    console.error('[fiscal-reconcile] reconcile-payments trigger error:', (err as Error).message);
  }
}

/**
 * Trigger Next.js reconcile-refunds cron endpoint from the worker.
 * This runs every 30 minutes from index.ts.
 */
export async function triggerReconcileRefunds(): Promise<void> {
  if (!env.CRON_SECRET) {
    console.warn('[fiscal-reconcile] CRON_SECRET not set — skipping reconcile-refunds trigger');
    return;
  }
  try {
    const url = `${env.SITE_URL}/api/cron/reconcile-refunds`;
    const resp = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
      signal: AbortSignal.timeout(45_000),
    });
    if (!resp.ok) {
      console.error('[fiscal-reconcile] reconcile-refunds returned:', resp.status);
    } else {
      const body = await resp.json() as Record<string, unknown>;
      console.info('[fiscal-reconcile] reconcile-refunds result:', body);
    }
  } catch (err) {
    console.error('[fiscal-reconcile] reconcile-refunds trigger error:', (err as Error).message);
  }
}

async function reconcilePendingFiscalReceipts(): Promise<void> {
  const cutoff = new Date(Date.now() - RETRY_AFTER_MINUTES * 60 * 1000).toISOString();

  const { data: pending, error } = await supabase
    .from('fiscal_receipts')
    .select('id, payment_transaction_id, amount_kzt, status, provider, retry_count, created_at')
    // 'pending' and 'retry_required' are handled by fiscal-processor — only log if stale.
    // 'failed' requires operator investigation.
    .in('status', ['pending', 'failed', 'retry_required'])
    .lt('updated_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(MAX_ITEMS_PER_CYCLE);

  if (error) {
    console.error('[fiscal-reconcile] DB error fetching pending receipts:', error.message);
    return;
  }

  if (!pending || pending.length === 0) return;

  console.warn(
    `[fiscal-reconcile] ${pending.length} fiscal receipt(s) need manual attention`,
    pending.map((r) => ({
      id: r.id,
      status: r.status,
      amountKzt: r.amount_kzt,
      retryCount: r.retry_count,
      createdAt: r.created_at,
    })),
  );

  // With manual provider: just log. No API retry possible.
  // With a real provider: call provider.createSaleReceipt() and update status.
  // Increment retry_count and update updated_at to throttle logging.
  for (const receipt of pending) {
    await supabase
      .from('fiscal_receipts')
      .update({
        retry_count: (receipt.retry_count ?? 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', receipt.id);
  }
}

async function reconcilePendingRefunds(): Promise<void> {
  const cutoff = new Date(Date.now() - RETRY_AFTER_MINUTES * 60 * 1000).toISOString();

  const { data: pending, error } = await supabase
    .from('refund_transactions')
    .select('id, payment_transaction_id, refund_amount_kzt, status, reason, created_at')
    .in('status', ['pending_manual', 'pending', 'requires_review'])
    .lt('updated_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(MAX_ITEMS_PER_CYCLE);

  if (error) {
    console.error('[fiscal-reconcile] DB error fetching pending refunds:', error.message);
    return;
  }

  if (!pending || pending.length === 0) return;

  console.warn(
    `[fiscal-reconcile] ${pending.length} refund(s) need manual attention`,
    pending.map((r) => ({
      id: r.id,
      status: r.status,
      amountKzt: r.refund_amount_kzt,
      reason: r.reason,
      createdAt: r.created_at,
    })),
  );

  // With manual mode: just log. Operator must process via Halyk merchant cabinet.
  // Update updated_at to throttle repeat logging.
  for (const refund of pending) {
    await supabase
      .from('refund_transactions')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', refund.id);
  }
}
