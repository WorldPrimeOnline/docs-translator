/**
 * Centralised Freedom Pay configuration — server-only module.
 *
 * Freedom Pay is independent of BUSINESS_PROFILE.cardPaymentsActive (that flag exists
 * solely to block Halyk, whose credentials belong to the previous legal entity — see
 * src/lib/business-profile.ts). Freedom Pay's test merchant (#588913 TOO World Prime
 * Online) matches the CURRENT entity, so it must never be gated by that flag.
 *
 * API base URL and merchant mode are hardcoded constants for this staging-only phase
 * (mirrors how src/lib/payments/halyk/config.ts hardcodes its endpoint constants) —
 * add env-driven mode switching only when production is actually being planned.
 */

export interface FreedomPayConfig {
  enabled: boolean;
  merchantId: string;
  secretKey: string;
  apiBaseUrl: string;
  appBaseUrl: string;
}

/** api.freedompay.kz is the only base URL corroborated by the current docs.freedompay.kz
 * Merchant API documentation (source of truth per 2026-08-20 correction) — see the
 * Freedom Pay integration DELTA REPORT for the verification trail. */
const API_BASE_URL = 'https://api.freedompay.kz';

/**
 * Single source of truth for WPO's own Result URL path — used both to build
 * pg_result_url at payment-initiation time and to derive the signature script_name
 * when verifying inbound callbacks / signing WPO's ACK (see signature.ts).
 * Freedom Pay's documentation does not define what "script_name" means for a non-.php
 * inbound receiver; the basename-of-this-path convention is a WPO design decision
 * (confirmed by the user), not a vendor-documented fact — keeping it in exactly one
 * place means the very first real staging callback can prove or disprove it by
 * changing only this constant.
 */
export const FREEDOMPAY_RESULT_PATH = '/api/payments/freedompay/result';

let _config: FreedomPayConfig | null = null;

export function getFreedomPayConfig(): FreedomPayConfig {
  if (_config) return _config;

  const enabled =
    process.env.FREEDOMPAY_ENABLED === 'true' &&
    !!process.env.FREEDOMPAY_MERCHANT_ID &&
    !!process.env.FREEDOMPAY_SECRET_KEY;

  _config = {
    enabled,
    merchantId: process.env.FREEDOMPAY_MERCHANT_ID ?? '',
    secretKey: process.env.FREEDOMPAY_SECRET_KEY ?? '',
    apiBaseUrl: API_BASE_URL,
    appBaseUrl: (process.env.APP_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, ''),
  };

  return _config;
}

/** For tests: reset cached config so env vars are re-read. */
export function _resetFreedomPayConfigCache(): void {
  _config = null;
}

/**
 * Builds the Result URL sent to Freedom Pay as pg_result_url.
 *
 * Staging (`*.vercel.app`, no custom domain) sits behind Vercel Deployment
 * Protection (SSO) — see docs/ai-context/DECISIONS.md 2026-08-21: any unauthenticated
 * external request, including Freedom Pay's own server-to-server Result URL POST, is
 * redirected to vercel.com/sso-api before it ever reaches this Next.js route. The fix
 * is Vercel's own documented mechanism for exactly this case — appending
 * `?x-vercel-protection-bypass=<VERCEL_AUTOMATION_BYPASS_SECRET>` as a query parameter
 * lets that one request through the SSO layer. Vercel auto-injects this env var into
 * every environment once a "Protection Bypass for Automation" secret exists on the
 * project — nothing new to provision.
 *
 * Guarded to staging only: appEnv must not be 'production' AND the secret must be
 * present. Production's custom domain (wpotranslations.org) is already excluded from
 * SSO protection (`ssoProtection.deploymentType = 'all_except_custom_domains'`), so
 * production's Result URL must never carry this query param — it would leak an
 * unnecessary secret into a public webhook URL that doesn't need it.
 *
 * script_name for verifying Freedom Pay's inbound signature and for signing WPO's ACK
 * is derived from FREEDOMPAY_RESULT_PATH (a path constant), never from the live
 * request URL — see signature.ts / result-ack.ts — so this query param never
 * participates in either signature.
 */
export function getFreedomPayResultUrl(appBaseUrl: string): string {
  const baseUrl = `${appBaseUrl}${FREEDOMPAY_RESULT_PATH}`;
  const appEnv = process.env.NEXT_PUBLIC_APP_ENV ?? process.env.APP_ENV ?? 'production';
  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

  if (appEnv === 'production' || !bypassSecret) {
    return baseUrl;
  }

  const url = new URL(baseUrl);
  url.searchParams.set('x-vercel-protection-bypass', bypassSecret);
  return url.toString();
}
