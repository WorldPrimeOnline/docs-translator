/**
 * Worker-side fiscal and refund reconciliation.
 *
 * Runs periodically in the Railway worker (separate from job processing).
 * Does NOT block the translation job poll loop.
 *
 * What it does:
 * 1. Finds fiscal_receipts in pending/failed/retry_required status and logs them
 *    for operator action. (With a real provider, would retry the API call.)
 * 2. Finds refund_transactions in pending_manual status and logs them for operator
 *    action. (With Halyk refund API, would retry the call.)
 *
 * Throttled: runs every FISCAL_RECONCILE_INTERVAL_MS (default 5 min).
 * Never logs more than MAX_ITEMS_TO_LOG items per cycle to avoid log spam.
 */
import { supabase } from './supabase';

const MAX_ITEMS_PER_CYCLE = 10;
const RETRY_AFTER_MINUTES = 5;

export async function reconcileFiscalAndRefunds(): Promise<void> {
  await reconcilePendingFiscalReceipts();
  await reconcilePendingRefunds();
}

async function reconcilePendingFiscalReceipts(): Promise<void> {
  const cutoff = new Date(Date.now() - RETRY_AFTER_MINUTES * 60 * 1000).toISOString();

  const { data: pending, error } = await supabase
    .from('fiscal_receipts')
    .select('id, payment_transaction_id, amount_kzt, status, provider, retry_count, created_at')
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
