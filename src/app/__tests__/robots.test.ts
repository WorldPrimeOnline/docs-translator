/**
 * Regression guard for SEO audit finding #4 (robots.txt vs locale-prefixed routes)
 * and the Sitemap: directive's domain (part of finding #1's fix — was public/robots.txt,
 * now dynamic src/app/robots.ts reusing SITE_URL).
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

  it('disallows locale-prefixed private/service routes for every enabled locale', () => {
    const privatePaths = [
      '/ru/dashboard',
      '/en/dashboard',
      '/kk/dashboard',
      '/en/auth/login',
      '/ru/auth/signup',
      '/kk/checkout',
      '/ru/payment/result',
      '/api/jobs',
      '/auth/callback', // outside [locale], not locale-prefixed
      '/dashboard', // unprefixed literal, kept from the original file for safety
    ];
    for (const path of privatePaths) {
      expect(isDisallowed(path, disallow)).toBe(true);
    }
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
