/**
 * Reproduces the exact server-render path for the Pricing Lab page (not just its API routes).
 * Only the Supabase auth primitives (`next/headers` cookies + `@supabase/ssr` createServerClient)
 * are faked — `checkPricingLabPageAccess` / `diagnosePricingLabAccess` / `checkPricingLabEnvironment`
 * all run for real against real process.env, so this catches regressions in the actual guard
 * wiring, not just a mocked-away "ok: true".
 *
 * Root cause of the 2026-07-20 staging 404 (see PricingLabPage / pricing-lab-guard.ts comments):
 * the page previously had no cookies()/headers() usage, so Next.js could statically render it
 * once at build time and never re-evaluate env/auth per request. `export const dynamic =
 * 'force-dynamic'` plus routing the page through the same cookie-forwarding Supabase client as
 * the API routes fixes that; this test exercises the resulting per-request check directly.
 */
export {};

let mockUser: { id: string; email: string | null } | null = null;

jest.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => {},
  }),
}));

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: mockUser } }),
    },
  }),
}));

jest.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

jest.mock('../PricingLabClient', () => ({
  PricingLabClient: () => 'PricingLabClient-marker',
}));

const ORIGINAL_ENV = { ...process.env };

describe('PricingLabPage server render', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    mockUser = null;
    jest.resetModules();
  });

  it('renders PricingLabClient for an authenticated, allowlisted operator on staging with the flag enabled', async () => {
    process.env.NEXT_PUBLIC_APP_ENV = 'staging';
    process.env.ENABLE_PRICING_LAB = 'true';
    process.env.PRICING_LAB_ALLOWED_EMAILS = 'ops@wpo.test';
    mockUser = { id: 'user-1', email: 'ops@wpo.test' };

    const { default: PricingLabPage } = await import('../page');
    const { PricingLabClient } = await import('../PricingLabClient');
    const element = await PricingLabPage();

    // Real render (not notFound) — the element is the (mocked) PricingLabClient component.
    expect(element.type).toBe(PricingLabClient);
  });

  it('still 404s an authenticated user who is not on the allowlist (root cause fix must not weaken the allowlist)', async () => {
    process.env.NEXT_PUBLIC_APP_ENV = 'staging';
    process.env.ENABLE_PRICING_LAB = 'true';
    process.env.PRICING_LAB_ALLOWED_EMAILS = 'ops@wpo.test';
    mockUser = { id: 'user-2', email: 'stranger@wpo.test' };

    const { default: PricingLabPage } = await import('../page');
    await expect(PricingLabPage()).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
