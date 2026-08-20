/**
 * Maps Freedom Pay's status fields onto WPO's existing, provider-neutral
 * payment_transactions.status vocabulary — no new status values introduced.
 *
 * Two DIFFERENT response schemas, two DIFFERENT mapping functions — do not conflate
 * them (2026-08-20 incident: the Status API reconciliation path was incorrectly
 * reading pg_result, a Result-URL-callback-only field that get_status3.php never
 * returns, so a real provider-side "error" status was silently read as "unknown
 * field, stay pending" and the customer-visible payment never reached a terminal
 * state — see docs/ai-context/DECISIONS.md 2026-08-20 for the incident writeup):
 *
 * - mapFreedomPayResult(pgResult): Result URL callback (POST /api/payments/freedompay/result)
 *   pg_result: 2 = not completed, 1 = success, 0 = failure. Confirmed via
 *   docs.freedompay.kz + two independent mirrors. See docs/ai-context/DECISIONS.md
 *   for the 2026-08-20 incident writeup.
 *
 * - mapFreedomPayPaymentStatus(pgPaymentStatus): get_status3.php Status API response.
 *   pg_payment_status: 'success' | 'error' | 'process' | 'pending' | other/missing.
 *   Confirmed against real Freedom Pay cabinet data for merchant #588913 (2026-08-20):
 *   two staging test payments that failed card entry (provider error 10005) both came
 *   back from the cabinet as provider status "error" — get_status3.php does NOT expose
 *   pg_result at all for this API.
 */

export type FreedomPayMappedResult = 'paid' | 'failed' | 'payment_pending' | 'unknown';

/** Result URL callback (inbound webhook) mapping — pg_result only. */
export function mapFreedomPayResult(pgResult: string | number | undefined | null): FreedomPayMappedResult {
  const value = pgResult === undefined || pgResult === null ? '' : String(pgResult).trim();
  if (value === '1') return 'paid';
  if (value === '0') return 'failed';
  if (value === '2') return 'payment_pending';
  return 'unknown';
}

/**
 * Status API (get_status3.php) mapping — pg_payment_status only. Never used for the
 * Result URL callback and vice versa; the two response schemas are not interchangeable.
 * Unknown/missing values deliberately fall through to 'unknown' (never 'paid') —
 * callers must treat 'unknown' the same as 'payment_pending' (do not finalize) and
 * log it for diagnosis rather than silently retrying forever.
 */
export function mapFreedomPayPaymentStatus(pgPaymentStatus: string | undefined | null): FreedomPayMappedResult {
  const value = (pgPaymentStatus ?? '').trim().toLowerCase();
  if (value === 'success') return 'paid';
  if (value === 'error') return 'failed';
  if (value === 'process' || value === 'pending') return 'payment_pending';
  return 'unknown';
}
