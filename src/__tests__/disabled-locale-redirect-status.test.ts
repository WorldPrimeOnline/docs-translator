/**
 * Regression guard for SEO audit finding #10: the disabled-locale guard in
 * src/middleware.ts must redirect with 308 (permanent) — a disabled locale is a
 * deliberate, permanent product state, not a temporary outage — while every other
 * redirect in the file (auth gates) stays 307, unchanged.
 *
 * middleware.ts imports `next-intl/middleware`, unresolvable here for the same class
 * of reason next-intl subpaths are unresolvable under this repo's ts-jest config
 * elsewhere (locales.test.ts, landing-pages-metadata.test.ts, etc.). Source-checked
 * instead of imported/executed. Real runtime behavior (actual header, path/query
 * preservation, no redirect chain) is verified against a production build — see this
 * fix's report.
 */
import * as fs from 'fs';
import * as path from 'path';
import { LOCALES, DEFAULT_LOCALE } from '@/i18n/locales';

const REPO_ROOT = path.join(__dirname, '..', '..');

function readSource(relativeToRepoRoot: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativeToRepoRoot), 'utf-8');
}

describe('locale source of truth (sanity check for this fix\'s assumptions)', () => {
  it('enabled locales are exactly ru en kk zh uz ky de tr th', () => {
    const enabled = LOCALES.filter((l) => l.enabled).map((l) => l.code).sort();
    expect(enabled).toEqual(['de', 'en', 'kk', 'ky', 'ru', 'th', 'tr', 'uz', 'zh'].sort());
  });

  it('disabled locales are exactly ko tj tk mn es', () => {
    const disabled = LOCALES.filter((l) => !l.enabled).map((l) => l.code).sort();
    expect(disabled).toEqual(['ko', 'tj', 'tk', 'mn', 'es'].sort());
  });

  it('DEFAULT_LOCALE is ru', () => {
    expect(DEFAULT_LOCALE).toBe('ru');
  });
});

describe('middleware.ts — disabled-locale guard uses 308, not 307', () => {
  const src = readSource('src/middleware.ts');

  it('the disabled-locale redirect block uses status: 308', () => {
    const blockMatch = src.match(/for \(const disabledCode of DISABLED_LOCALE_CODES\) \{[\s\S]*?\n {2}\}/);
    expect(blockMatch).not.toBeNull();
    const block = blockMatch![0];
    expect(block).toContain('status: 308');
    expect(block).not.toContain('status: 307');
  });

  it('the redirect destination logic (path preserved, target is DEFAULT_LOCALE) is unchanged', () => {
    const blockMatch = src.match(/for \(const disabledCode of DISABLED_LOCALE_CODES\) \{[\s\S]*?\n {2}\}/);
    const block = blockMatch![0];
    expect(block).toContain('url.pathname = `/${DEFAULT_LOCALE}${rest}`');
    // Only pathname is reassigned — url is a clone of request.nextUrl, so .search
    // (query string) is preserved automatically; there is no `url.search =` anywhere
    // in this block that would strip or otherwise touch it.
    expect(block).not.toMatch(/url\.search\s*=/);
  });

  it('no other 307 in the file was accidentally changed to 308 — auth-gate redirects keep their default (307) status', () => {
    // The 3 auth-gate redirects (unauthenticated /dashboard, /checkout, and
    // logged-in-user-hits-/auth/*) call NextResponse.redirect(url) with NO explicit
    // status object at all — Next.js defaults that to 307. Locking in there are
    // still exactly 3 such bare calls, and that none of them gained an explicit
    // status (which would signal someone widened this fix's scope).
    const bareRedirectCalls = src.match(/return NextResponse\.redirect\(url\);/g) ?? [];
    expect(bareRedirectCalls).toHaveLength(3);
  });

  it('exactly one status:308 and zero status:307 exist in the whole file (this fix touched only the disabled-locale block)', () => {
    const count308 = (src.match(/status:\s*308/g) ?? []).length;
    const count307 = (src.match(/status:\s*307/g) ?? []).length;
    expect(count308).toBe(1);
    expect(count307).toBe(0);
  });
});
