/**
 * Worker-side fiscal and refund reconciliation.
 *
 * Runs periodically in the Railway worker (separate from job processing).
 * Does NOT block the translation job poll loop.
 *
 * What it does:
 * 1. Runs fiscal-processor to process pending/retry_required fiscal_receipts via Webkassa.
 * 2. After the processor runs, checks for any receipts that are STILL pending/stuck
 *    (e.g. processor not configured, lock contention) and logs them for operator awareness.
 * 3. Logs failed receipts that require operator investigation.
 * 4. Triggers Next.js reconcile-payments and reconcile-refunds cron endpoints
 *    (since vercel.json only allows one cron on the Hobby plan).
 *
 * Statuses NOT processed by fiscal-processor (always need operator action):
 * - pending_manual: manual provider or fiscalization disabled
 * - blocked_by_config: WEBKASSA_ALLOW_REAL_RECEIPTS not set for production
 * - failed: permanent failure; operator must investigate
 *
 * Statuses handled by fiscal-processor automatically:
 * - pending: waiting for first Webkassa call
 * - retry_required: transient failure, will be retried
 *
 * Throttled: runs every 5 min.
 * Never logs more than MAX_ITEMS_PER_CYCLE items per cycle to avoid log spam.
 */
import { supabase } from './supabase';
import { env } from './env';
import { processPendingFiscalReceipts, isWebkassaConfigured } from './fiscal-processor';
import { maybeRunScheduledZReport } from './fiscal-z-report';

const MAX_ITEMS_PER_CYCLE = 10;
const RETRY_AFTER_MINUTES = 5;

export async function reconcileFiscalAndRefunds(): Promise<void> {
  // Process pending fiscal receipts through sequential per-cashbox queue (Webkassa requirement).
  // Must run before Z-report to ensure all receipts are issued before shift is closed.
  await processPendingFiscalReceipts();
  await reconcileStuckFiscalReceipts();
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

/**
 * After processPendingFiscalReceipts() runs, check for receipts that are STILL stuck.
 *
 * Stuck pending/retry_required → processor didn't pick them up (misconfigured env, lock contention).
 * Stuck failed → permanent failure, operator must investigate.
 *
 * Does NOT bump retry_count on pending/retry_required — that is the processor's job only.
 * Only updates updated_at to throttle repeat logging (5-minute cooldown per item).
 */
async function reconcileStuckFiscalReceipts(): Promise<void> {
  const cutoff = new Date(Date.now() - RETRY_AFTER_MINUTES * 60 * 1000).toISOString();

  const { data: stale, error } = await supabase
    .from('fiscal_receipts')
    .select('id, payment_transaction_id, amount_kzt, status, provider, retry_count, created_at')
    .in('status', ['pending', 'retry_required', 'failed'])
    .lt('updated_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(MAX_ITEMS_PER_CYCLE);

  if (error) {
    console.error('[fiscal-reconcile] DB error fetching stale receipts:', error.message);
    return;
  }

  if (!stale || stale.length === 0) return;

  const failed = stale.filter((r) => r.status === 'failed');
  const stuck = stale.filter((r) => r.status !== 'failed');

  const processorConfigured = isWebkassaConfigured();

  if (stuck.length > 0) {
    // pending/retry_required still sitting here after processPendingFiscalReceipts() ran.
    // Most likely cause: Webkassa env vars not set (WEBKASSA_ENABLED, WEBKASSA_ALLOW_REAL_RECEIPTS).
    console.warn(
      `[fiscal-reconcile] ${stuck.length} fiscal receipt(s) not picked up by processor`,
      {
        processorConfigured,
        hint: processorConfigured
          ? 'processor IS configured — possible lock contention or operation_type/provider mismatch'
          : 'processor NOT configured — check WEBKASSA_ENABLED and WEBKASSA_ALLOW_REAL_RECEIPTS env vars',
        receipts: stuck.map((r) => ({
          id: r.id,
          status: r.status,
          provider: r.provider,
          amountKzt: r.amount_kzt,
          retryCount: r.retry_count,
          createdAt: r.created_at,
        })),
      },
    );
  }

  if (failed.length > 0) {
    console.warn(
      `[fiscal-reconcile] ${failed.length} fiscal receipt(s) failed — operator investigation required`,
      failed.map((r) => ({
        id: r.id,
        provider: r.provider,
        amountKzt: r.amount_kzt,
        retryCount: r.retry_count,
        createdAt: r.created_at,
      })),
    );
  }

  // Update updated_at only (NOT retry_count — that is the processor's job) to throttle log spam.
  for (const receipt of stale) {
    await supabase
      .from('fiscal_receipts')
      .update({ updated_at: new Date().toISOString() })
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
