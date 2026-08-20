/**
 * Maps Freedom Pay's `pg_result` field onto WPO's existing, provider-neutral
 * payment_transactions.status vocabulary — no new status values introduced.
 *
 * pg_result meaning is confirmed (docs.freedompay.kz + two independent mirrors):
 * 2 = not completed, 1 = success, 0 = failure.
 */

export type FreedomPayMappedResult = 'paid' | 'failed' | 'payment_pending' | 'unknown';

export function mapFreedomPayResult(pgResult: string | number | undefined | null): FreedomPayMappedResult {
  const value = pgResult === undefined || pgResult === null ? '' : String(pgResult).trim();
  if (value === '1') return 'paid';
  if (value === '0') return 'failed';
  if (value === '2') return 'payment_pending';
  return 'unknown';
}
