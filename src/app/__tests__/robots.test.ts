/**
 * Regression guard for SEO audit finding #4 (robots.txt vs locale-prefixed routes)
 * and the Sitemap: directive's domain (part of finding #1's fix — was public/robots.txt,
 * now dynamic src/app/robots.ts reusing SITE_URL).
 *
 * Also locks in the crawl-vs-noindex correction: a route must never be BOTH
 * robots.txt-disallowed AND rely on its own noindex meta tag — disallow prevents the
 * crawler from ever reading that tag. Publicly reachable HTML routes that noindex
 * themselves (auth/*, payment/result, start) must NOT be blocked; only genuinely
 * auth-gated routes (dashboard, checkout) or non-HTML endpoints (api, auth/callback)
 * are blocked.
 */
import robots from '../robots';
import { SITE_URL } from '@/lib/seo/site-metadata';

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}`);
}

function isDisallowed(path: string, disallow: string[]): boolean {
  return disallow.some((pattern) => patternToRegex(pattern).test(path));
}

describe('robots()', () => {
  const result = robots();
  const rules = Array.isArray(result.rules) ? result.rules[0]! : result.rules!;
  const disallow = (Array.isArray(rules.disallow) ? rules.disallow : [rules.disallow]).filter(
    (v): v is string => typeof v === 'string',
  );

  it('Sitemap directive uses the canonical www host, no redirect hop', () => {
    expect(SITE_URL).toBe('https://www.wpotranslations.org');
    expect(result.sitemap).toBe('https://www.wpotranslations.org/sitemap.xml');
  });

  it('allows crawling by default', () => {
    expect(rules.userAgent).toBe('*');
    expect(rules.allow).toBe('/');
  });

  describe('auth-gated routes — blocked (crawl-budget savings; anonymous always redirects anyway)', () => {
    it.each(['/ru/dashboard', '/en/dashboard', '/kk/dashboard', '/dashboard'])('%s is blocked', (path) => {
      expect(isDisallowed(path, disallow)).toBe(true);
    });

    it.each(['/kk/checkout', '/ru/checkout', '/en/checkout'])('%s is blocked', (path) => {
      expect(isDisallowed(path, disallow)).toBe(true);
    });
  });

  describe('non-HTML technical routes — blocked (no HTML, so no noindex tag is possible)', () => {
    it.each(['/api/jobs', '/api/documents/upload', '/api/'])('%s is blocked', (path) => {
      expect(isDisallowed(path, disallow)).toBe(true);
    });

    it('/auth/callback (route.ts handler, not [locale]/auth/* HTML) is blocked', () => {
      expect(isDisallowed('/auth/callback', disallow)).toBe(true);
    });
  });

  describe('publicly reachable HTML that relies on its own noindex tag — must NOT be blocked', () => {
    it.each(['/ru/auth/login', '/en/auth/signup', '/kk/auth/forgot-password', '/ru/auth/reset-password'])(
      '%s is not blocked by robots.txt (noindex meta tag is the mechanism instead)',
      (path) => {
        expect(isDisallowed(path, disallow)).toBe(false);
      },
    );

    it('/ru/payment/result is not blocked by robots.txt', () => {
      expect(isDisallowed('/ru/payment/result', disallow)).toBe(false);
    });

    it('/ru/start is not blocked by robots.txt', () => {
      expect(isDisallowed('/ru/start', disallow)).toBe(false);
    });
  });

  it('does not disallow representative public/indexable pages', () => {
    const publicPaths = [
      '/ru',
      '/en',
      '/ru/documents',
      '/ru/documents/passport-translation',
      '/ru/kazakhstan',
      '/ru/kazakhstan/notarized-translation',
      '/ru/contacts',
      '/ru/partners',
      '/ru/legal/privacy',
      '/ru/legal/terms',
    ];
    for (const path of publicPaths) {
      expect(isDisallowed(path, disallow)).toBe(false);
    }
  });
});
