/**
 * Customer-visible retention/expiry display for history orders.
 *
 * `HISTORY_RETENTION_DAYS` mirrors `RETENTION_DAYS` in
 * src/app/api/cron/cleanup/route.ts (currently 30) purely so the dashboard can show
 * an "available until X" estimate before retention cleanup has actually run.
 *
 * 2026-07-24 fix: the previous version of this module's doc comment flagged a real
 * conflict — the old cleanup cron deleted the entire `documents` row, so "metadata
 * stays visible past 30 days" was unobservable. That's now resolved: the cron only
 * ever deletes R2 objects + job_source_files/job_result_files rows, then sets
 * `documents.files_purged_at` (see migration 0066) — the row itself, jobs,
 * price_quotes, and payment/fiscal history are never deleted. `files_purged_at` is
 * the AUTHORITATIVE "expired" signal surfaced by /api/jobs (never inferred purely
 * from this module's date math) — computeRetentionExpiry()/isRetentionExpired() are
 * now used only for the "available until X" estimate BEFORE that has happened, never
 * to decide whether a download is offered.
 */

export const HISTORY_RETENTION_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The date after which the underlying R2 objects are expected to be purged by the cleanup cron. */
export function computeRetentionExpiry(createdAt: string, retentionDays: number = HISTORY_RETENTION_DAYS): Date {
  return new Date(new Date(createdAt).getTime() + retentionDays * MS_PER_DAY);
}

/**
 * Whether `now` is at or past the retention expiry for a document created at `createdAt`.
 * Accepts `now` explicitly (default: current time) so tests can simulate "past the
 * 30-day window" without relying on real wall-clock time or faking global Date.
 * Display-only estimate — see computeRetentionExpiry's doc comment.
 */
export function isRetentionExpired(
  createdAt: string,
  now: Date = new Date(),
  retentionDays: number = HISTORY_RETENTION_DAYS,
): boolean {
  return now.getTime() >= computeRetentionExpiry(createdAt, retentionDays).getTime();
}

/**
 * 2026-07-24 retention fix: bucketOrders()/getCustomerOrderState() have no concept of
 * R2/file retention — a "completed, downloadable" order stays `isActive: true`
 * forever on its own, purely from service-level/workflow_status/hasReadyResultFiles.
 * Once retention cleanup has actually purged an order's files (filesPurgedAt set),
 * it must migrate out of the active/ready section into history. Forcing
 * `isActive: false` here — applied to the bucketing INPUT, never to the order data
 * itself — is the smallest change that achieves that without touching the pure
 * bucketing/state-derivation utilities.
 *
 * 2026-07-25 fix: this MUST only apply to orders that are already terminal.
 * Retention cleanup purges by `documents.created_at` alone (see
 * src/app/api/cron/cleanup/route.ts) — it has no idea whether the order's business
 * workflow ever finished, so a genuinely abandoned order (uploaded, quoted, never
 * paid — payment_pending, non-terminal) sitting for 30+ days gets its temp files
 * purged too. The original version of this function forced isActive:false
 * unconditionally whenever filesPurgedAt was set, which would push that still-active,
 * still-payable order into the isActive:false/isTerminal:false gap — invisible in
 * every bucket (see the 2026-07-25 staging incident and
 * order-buckets.test.ts's invariant test). Retention purging its files must never
 * change its business state — only a terminal (already-finished) order migrates to
 * history because of a purge.
 */
export function applyFilesPurgedOverride<T extends { isActive: boolean; isTerminal: boolean; filesPurgedAt: string | null }>(orders: T[]): T[] {
  return orders.map((o) => (o.filesPurgedAt && o.isTerminal ? { ...o, isActive: false } : o));
}
