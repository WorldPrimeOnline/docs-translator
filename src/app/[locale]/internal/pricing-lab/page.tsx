import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { checkPricingLabPageAccess } from '@/lib/internal/require-pricing-lab-access';
import { PricingLabClient } from './PricingLabClient';

// Never indexed, never linked from any public page.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: 'WPO Pricing Lab',
};

// Required: this route previously had no cookies()/headers() usage of its own, so Next.js
// could statically render it once at build time and never re-evaluate env/auth per request —
// a stale build (or one whose build-time env vars didn't match the current Vercel dashboard
// config) would then 404 forever regardless of later env changes. See the 2026-07-20
// pricing-lab-guard 404 investigation. Forcing dynamic rendering makes every request
// re-run the check below against the live environment and the live session.
export const dynamic = 'force-dynamic';

/**
 * Internal operator tool (staging only) — see src/lib/internal/pricing-lab-guard.ts.
 * Full check here (env + authenticated operator on the allowlist), matching every API route
 * this page calls (src/lib/internal/require-pricing-lab-access.ts). Previously this page only
 * checked the environment and relied on API routes for auth, which let an authenticated
 * non-allowlisted user reach the page shell before its widgets started 404ing individually.
 * Middleware (src/middleware.ts) still redirects unauthenticated users to /auth/login first;
 * this check additionally covers the allowlist and re-confirms the environment per request.
 */
export default async function PricingLabPage() {
  const { allowed, diagnostics } = await checkPricingLabPageAccess();

  if (!allowed) {
    // Staging-only, safe structured warning — never the email itself or allowlist contents,
    // only the booleans/counts/codes needed to tell denial reasons apart in Vercel logs.
    if (diagnostics.appEnv !== 'production') {
      console.warn('[pricing-lab] page access denied', {
        route: 'pricing-lab',
        reason: diagnostics.code,
        appEnv: diagnostics.appEnv,
        vercelEnv: diagnostics.vercelEnv,
        enabled: diagnostics.enabled,
        hasUser: diagnostics.hasUser,
        allowlistCount: diagnostics.allowlistCount,
        emailAllowed: diagnostics.emailAllowed,
      });
    }
    notFound();
  }

  return <PricingLabClient />;
}
