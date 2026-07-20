/**
 * Access guard for the internal Pricing Lab tool (2026-07-17).
 *
 * STAGING ONLY — mirrors the same double-guard idiom already established for
 * src/lib/payments/finalize-payment.ts's checkStagingGuards(): env must not be
 * "production" AND an explicit boolean flag must be "true". Additionally requires the
 * authenticated user's email to be on an explicit allowlist — there is no existing
 * staff_profiles-to-auth.users link in this codebase to reuse (staff_profiles has no
 * user_id column and is service-role-only, used only for Telegram/Jira routing), so this
 * allowlist is the simplest safe mechanism rather than inventing a full RBAC system.
 *
 * Pricing Lab must NEVER be reachable in production, regardless of any other flag.
 */

export interface PricingLabGuardResult {
  allowed: boolean;
  reason: string;
}

export type PricingLabDenyCode =
  | 'production'
  | 'disabled'
  | 'not_authenticated'
  | 'missing_email'
  | 'email_not_allowed';

export interface PricingLabDiagnostics {
  code: PricingLabDenyCode | 'ok';
  appEnv: string;
  vercelEnv: string | undefined;
  enabled: boolean;
  hasUser: boolean;
  allowlistCount: number;
  emailAllowed: boolean;
}

function isStagingEnvironment(): boolean {
  const appEnv = process.env.NEXT_PUBLIC_APP_ENV ?? process.env.APP_ENV ?? 'production';
  return appEnv !== 'production';
}

function isPricingLabEnabled(): boolean {
  return process.env.ENABLE_PRICING_LAB === 'true';
}

/** Environment-only check (no user context) — used by the page/layout to decide 404 vs render. */
export function checkPricingLabEnvironment(): PricingLabGuardResult {
  if (!isStagingEnvironment()) {
    return { allowed: false, reason: 'Pricing Lab is never available in production.' };
  }
  if (!isPricingLabEnabled()) {
    return { allowed: false, reason: 'ENABLE_PRICING_LAB is not set to "true".' };
  }
  return { allowed: true, reason: 'ok' };
}

function allowedOperatorEmails(): string[] {
  const raw = process.env.PRICING_LAB_ALLOWED_EMAILS ?? '';
  return raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

/** Full check including operator authorization — used by API route handlers. */
export function checkPricingLabAccess(userEmail: string | null | undefined): PricingLabGuardResult {
  const envCheck = checkPricingLabEnvironment();
  if (!envCheck.allowed) return envCheck;

  const allowlist = allowedOperatorEmails();
  if (allowlist.length === 0) {
    return { allowed: false, reason: 'PRICING_LAB_ALLOWED_EMAILS is not configured — refusing rather than allowing any authenticated user.' };
  }
  if (!userEmail || !allowlist.includes(userEmail.toLowerCase())) {
    return { allowed: false, reason: 'Authenticated user is not on the Pricing Lab operator allowlist.' };
  }
  return { allowed: true, reason: 'ok' };
}

/**
 * Full diagnostic breakdown of the access decision, distinguishing "no session at all" from
 * "session exists but has no email" — a distinction checkPricingLabAccess collapses (its
 * callers only ever pass `user?.email ?? null`). Used by the Pricing Lab *page* to log a safe,
 * structured reason for a denial — never the email itself or allowlist contents, only the
 * booleans/counts/codes needed to tell the reasons apart.
 */
export function diagnosePricingLabAccess(
  hasUser: boolean,
  userEmail: string | null | undefined,
): PricingLabDiagnostics {
  const appEnv = process.env.NEXT_PUBLIC_APP_ENV ?? process.env.APP_ENV ?? 'production';
  const vercelEnv = process.env.VERCEL_ENV;
  const enabled = isPricingLabEnabled();
  const allowlist = allowedOperatorEmails();
  const normalizedEmail = userEmail ? userEmail.trim().toLowerCase() : null;
  const emailAllowed = normalizedEmail != null && allowlist.length > 0 && allowlist.includes(normalizedEmail);

  const base = { appEnv, vercelEnv, enabled, hasUser, allowlistCount: allowlist.length, emailAllowed };

  if (appEnv === 'production') return { ...base, code: 'production' };
  if (!enabled) return { ...base, code: 'disabled' };
  if (!hasUser) return { ...base, code: 'not_authenticated' };
  if (!normalizedEmail) return { ...base, code: 'missing_email' };
  if (!emailAllowed) return { ...base, code: 'email_not_allowed' };
  return { ...base, code: 'ok' };
}
