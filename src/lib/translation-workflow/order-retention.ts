/**
 * Customer-visible retention/expiry display for history orders.
 *
 * IMPORTANT — display only, not a control: `HISTORY_RETENTION_DAYS` mirrors
 * `RETENTION_DAYS` in src/app/api/cron/cleanup/route.ts (currently 30) purely so the
 * dashboard can tell the customer "available until X". It does not, and cannot,
 * change when anything is actually deleted — that cron is the sole source of truth,
 * and today it deletes the ENTIRE `documents` row (cascading to jobs/translations/
 * ocr_results), not just the R2 file. That means once the cron has actually run past
 * this window, the row is gone and there is nothing left for the dashboard to render
 * an expiry message for — this module's `isRetentionExpired()` can only be observed
 * in the narrow gap before the daily cron runs, or in tests that pass an old
 * `createdAt` directly. This is a known product/eng conflict (documents-row vs.
 * R2-object-only deletion), flagged for an explicit decision — not resolved here.
 * Keep this constant in sync with cleanup/route.ts's RETENTION_DAYS by hand until
 * that decision changes the cron's behavior.
 */

export const HISTORY_RETENTION_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The date after which the underlying document row is expected to be swept by the cleanup cron. */
export function computeRetentionExpiry(createdAt: string, retentionDays: number = HISTORY_RETENTION_DAYS): Date {
  return new Date(new Date(createdAt).getTime() + retentionDays * MS_PER_DAY);
}

/**
 * Whether `now` is at or past the retention expiry for a document created at `createdAt`.
 * Accepts `now` explicitly (default: current time) so tests can simulate "past the
 * 30-day window" without relying on real wall-clock time or faking global Date.
 */
export function isRetentionExpired(
  createdAt: string,
  now: Date = new Date(),
  retentionDays: number = HISTORY_RETENTION_DAYS,
): boolean {
  return now.getTime() >= computeRetentionExpiry(createdAt, retentionDays).getTime();
}
