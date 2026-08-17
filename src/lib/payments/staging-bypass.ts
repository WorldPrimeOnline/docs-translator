/**
 * Environment/password guard for the staging-only payment bypass.
 * Kept separate from the API route so both are independently unit-testable.
 *
 * STAGING ONLY. isStagingBypassEnabled() refuses whenever APP_ENV/NEXT_PUBLIC_APP_ENV
 * is "production" (or unset — fails closed), regardless of STAGING_PAYMENT_BYPASS_ENABLED.
 */

import * as crypto from 'crypto';

export function isStagingBypassEnabled(): boolean {
  const appEnv = process.env.NEXT_PUBLIC_APP_ENV ?? process.env.APP_ENV ?? 'production';
  if (appEnv === 'production') return false;
  return process.env.STAGING_PAYMENT_BYPASS_ENABLED === 'true';
}

/**
 * Constant-time password check. Hashes both sides to fixed-length digests first so
 * crypto.timingSafeEqual (which throws/leaks on length mismatch) never sees a length
 * difference between the candidate and the configured secret.
 */
export function verifyStagingBypassPassword(candidate: string): boolean {
  const expected = process.env.STAGING_PAYMENT_BYPASS_PASSWORD;
  if (!expected || !candidate) return false;

  const candidateDigest = crypto.createHash('sha256').update(candidate).digest();
  const expectedDigest = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(candidateDigest, expectedDigest);
}
