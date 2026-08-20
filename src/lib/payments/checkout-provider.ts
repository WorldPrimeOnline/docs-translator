/**
 * Which payment provider the automatic, user-facing checkout flow uses.
 *
 * Staging uses Freedom Pay so the normal checkout UX (upload → price → pay) exercises
 * the real Freedom Pay test merchant end-to-end, without any curl/Postman step.
 * Production (and any other/unset env) keeps the existing Halyk flow completely
 * unchanged — this file is the ONLY switch point, so Halyk's production behavior
 * cannot regress by accident elsewhere.
 *
 * The staging-only payment bypass (src/lib/payments/staging-bypass.ts,
 * src/app/api/payments/staging-bypass/route.ts, scripts/staging/confirm-payment-paid.ts)
 * is unrelated to this — it is a separate internal mechanism for testing downstream
 * order processing without any real acquiring provider, not a checkout provider choice,
 * and is unaffected by this file.
 */

export type CheckoutPaymentProvider = 'halyk' | 'freedompay';

export function getCheckoutPaymentProvider(): CheckoutPaymentProvider {
  return process.env.NEXT_PUBLIC_APP_ENV === 'staging' ? 'freedompay' : 'halyk';
}
