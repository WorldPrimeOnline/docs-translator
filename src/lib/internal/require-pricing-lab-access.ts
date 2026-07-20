/**
 * Shared server-side access check for every Pricing Lab API route.
 * Staging + ENABLE_PRICING_LAB + authenticated operator allowlist — see pricing-lab-guard.ts.
 */
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/types';
import { checkPricingLabAccess, diagnosePricingLabAccess, type PricingLabDiagnostics } from './pricing-lab-guard';

/**
 * Same cookie-forwarding Supabase client every Pricing Lab API route and the page use — kept
 * in one place so the page can never diverge from the routes on which client, which cookies,
 * or whether auth.getUser() is called (see the 2026-07-20 pricing-lab 404 investigation).
 */
async function getPricingLabAuthUser(): Promise<{ id: string; email: string | null } | null> {
  const cookieStore = await cookies();
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    },
  );
  const { data: { user } } = await supabase.auth.getUser();
  return user ? { id: user.id, email: user.email ?? null } : null;
}

export type PricingLabAccessResult =
  | { ok: true; userId: string; userEmail: string }
  | { ok: false; status: number; error: string };

export async function requirePricingLabAccess(): Promise<PricingLabAccessResult> {
  const user = await getPricingLabAuthUser();

  const check = checkPricingLabAccess(user?.email ?? null);
  if (!check.allowed) {
    // 404, not 403 — never reveal that this route exists to an unauthorized caller,
    // matching the "production returns 404" / "not discoverable by regular clients" requirement.
    return { ok: false, status: 404, error: 'Not found' };
  }

  return { ok: true, userId: user!.id, userEmail: user!.email! };
}

export type PricingLabPageAccessResult = { allowed: boolean; diagnostics: PricingLabDiagnostics };

/**
 * Full page-level guard — env + authenticated operator on the allowlist, matching every API
 * route this page calls. Returns structured diagnostics (no email, no allowlist contents) so
 * the page can log *why* it denied access.
 */
export async function checkPricingLabPageAccess(): Promise<PricingLabPageAccessResult> {
  const user = await getPricingLabAuthUser();
  const diagnostics = diagnosePricingLabAccess(user !== null, user?.email ?? null);
  return { allowed: diagnostics.code === 'ok', diagnostics };
}
