import { getFreedomPayResultUrl, _resetFreedomPayConfigCache } from '../config';
import { deriveScriptNameFromUrl } from '../signature';

const BASE_URL = 'https://docs-translator-git-staging-world-prime-online-s-projects.vercel.app';
const PROD_URL = 'https://wpotranslations.org';

function clearEnv(): void {
  delete process.env.NEXT_PUBLIC_APP_ENV;
  delete process.env.APP_ENV;
  delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
}

beforeEach(() => {
  clearEnv();
  _resetFreedomPayConfigCache();
});

afterEach(() => {
  clearEnv();
});

describe('getFreedomPayResultUrl — Vercel protection bypass (2026-08-21 fix)', () => {
  it('staging + secret present: Result URL contains the bypass query param', () => {
    process.env.NEXT_PUBLIC_APP_ENV = 'staging';
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET = 'test-bypass-secret';

    const url = getFreedomPayResultUrl(BASE_URL);

    expect(url).toContain('x-vercel-protection-bypass=test-bypass-secret');
    expect(url.startsWith(`${BASE_URL}/api/payments/freedompay/result?`)).toBe(true);
  });

  it('production: Result URL NEVER contains the bypass param, even when the secret is present', () => {
    process.env.NEXT_PUBLIC_APP_ENV = 'production';
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET = 'test-bypass-secret';

    const url = getFreedomPayResultUrl(PROD_URL);

    expect(url).toBe(`${PROD_URL}/api/payments/freedompay/result`);
    expect(url).not.toContain('x-vercel-protection-bypass');
    expect(url).not.toContain('test-bypass-secret');
  });

  it('unset APP_ENV defaults to production-safe behavior — no bypass param', () => {
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET = 'test-bypass-secret';
    // NEXT_PUBLIC_APP_ENV / APP_ENV intentionally left unset.

    const url = getFreedomPayResultUrl(PROD_URL);

    expect(url).toBe(`${PROD_URL}/api/payments/freedompay/result`);
    expect(url).not.toContain('x-vercel-protection-bypass');
  });

  it('staging without a bypass secret configured: URL is unchanged (no bypass, no crash)', () => {
    process.env.NEXT_PUBLIC_APP_ENV = 'staging';
    // VERCEL_AUTOMATION_BYPASS_SECRET intentionally left unset.

    const url = getFreedomPayResultUrl(BASE_URL);

    expect(url).toBe(`${BASE_URL}/api/payments/freedompay/result`);
    expect(url).not.toContain('x-vercel-protection-bypass');
  });

  it('APP_ENV fallback (no NEXT_PUBLIC_APP_ENV) behaves the same as NEXT_PUBLIC_APP_ENV for staging', () => {
    process.env.APP_ENV = 'staging';
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET = 'test-bypass-secret';

    const url = getFreedomPayResultUrl(BASE_URL);

    expect(url).toContain('x-vercel-protection-bypass=test-bypass-secret');
  });

  it('script_name for the inbound signature is derived from the path constant, never from the query string', () => {
    // Regression guard for the exact concern raised alongside this fix: appending
    // ?x-vercel-protection-bypass=... to pg_result_url must never change what
    // deriveScriptNameFromUrl() would compute for the inbound Result URL request.
    process.env.NEXT_PUBLIC_APP_ENV = 'staging';
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET = 'test-bypass-secret';

    const urlWithBypass = getFreedomPayResultUrl(BASE_URL);
    expect(deriveScriptNameFromUrl(urlWithBypass)).toBe('result');
  });
});
