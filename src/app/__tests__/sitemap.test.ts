/**
 * Regression guard for the sitemap old-domain incident: public/sitemap.xml used to be
 * a static file hardcoded to https://docs-translator.vercel.app (SEO audit finding #1).
 * It has been replaced by this dynamic generator — these tests lock in that the
 * generated sitemap can never again reference the old domain, any *.vercel.app host,
 * a staging hostname, a disabled locale, or a private/internal route.
 */
import sitemap from '../sitemap';
import { SITE_URL } from '@/lib/seo/site-metadata';
import { LOCALES } from '@/i18n/locales';

const DISABLED_LOCALE_CODES = LOCALES.filter((l) => !l.enabled).map((l) => l.code);

const PRIVATE_PATH_SEGMENTS = [
  '/dashboard',
  '/checkout',
  '/auth',
  '/payment',
  '/api',
  '/start',
];

describe('sitemap()', () => {
  const entries = sitemap();
  const urls = entries.map((e) => e.url);

  it('is not empty', () => {
    expect(urls.length).toBeGreaterThan(0);
  });

  it('every URL starts with the canonical production SITE_URL', () => {
    expect(SITE_URL).toBe('https://www.wpotranslations.org');
    for (const url of urls) {
      expect(url.startsWith(`${SITE_URL}/`)).toBe(true);
    }
  });

  it('never references the old docs-translator.vercel.app domain', () => {
    for (const url of urls) {
      expect(url).not.toContain('docs-translator.vercel.app');
    }
  });

  it('never references any *.vercel.app host', () => {
    for (const url of urls) {
      expect(url).not.toMatch(/vercel\.app/);
    }
  });

  it('never references a staging hostname', () => {
    for (const url of urls) {
      expect(url.toLowerCase()).not.toContain('staging');
    }
  });

  it('never includes a disabled locale', () => {
    expect(DISABLED_LOCALE_CODES.length).toBeGreaterThan(0); // sanity: there are disabled locales to check against
    for (const url of urls) {
      const path = url.slice(SITE_URL.length + 1); // strip "https://www.wpotranslations.org/"
      const firstSegment = path.split('/')[0];
      expect(DISABLED_LOCALE_CODES).not.toContain(firstSegment);
    }
  });

  it('never includes private/internal/transactional routes', () => {
    for (const url of urls) {
      const path = url.slice(SITE_URL.length);
      for (const segment of PRIVATE_PATH_SEGMENTS) {
        expect(path).not.toMatch(new RegExp(`^/[a-z]{2}${segment}(/|$)`));
      }
    }
  });

  it('never includes the duplicate /privacy or /tos alias pages', () => {
    for (const url of urls) {
      const path = url.slice(SITE_URL.length);
      expect(path).not.toMatch(/^\/[a-z]{2}\/privacy(\/|$)/);
      expect(path).not.toMatch(/^\/[a-z]{2}\/tos(\/|$)/);
    }
  });

  it('has no duplicate URLs', () => {
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('includes the homepage for every enabled locale, not the bare unprefixed "/"', () => {
    for (const locale of LOCALES.filter((l) => l.enabled).map((l) => l.code)) {
      expect(urls).toContain(`${SITE_URL}/${locale}`);
    }
    expect(urls).not.toContain(`${SITE_URL}/`);
  });

  it('excludes legal pages for de/tr/th (English-fallback content, finding #5)', () => {
    for (const locale of ['de', 'tr', 'th']) {
      const legalUrls = urls.filter((u) => u.startsWith(`${SITE_URL}/${locale}/legal/`));
      expect(legalUrls).toHaveLength(0);
    }
  });

  it('includes legal pages for a locale with real translated content (ru)', () => {
    expect(urls).toContain(`${SITE_URL}/ru/legal/privacy`);
    expect(urls).toContain(`${SITE_URL}/ru/legal/terms`);
  });

  it('includes the vertical landing pages for every enabled locale', () => {
    for (const locale of LOCALES.filter((l) => l.enabled).map((l) => l.code)) {
      expect(urls).toContain(`${SITE_URL}/${locale}/documents/passport-translation`);
      expect(urls).toContain(`${SITE_URL}/${locale}/kazakhstan/notarized-translation`);
    }
  });

  it('excludes /de/kazakhstan/university-document-translation (verified incomplete i18n content, finding #3)', () => {
    expect(urls).not.toContain(`${SITE_URL}/de/kazakhstan/university-document-translation`);
  });

  it('still includes /kazakhstan/university-document-translation for every OTHER enabled locale', () => {
    for (const locale of LOCALES.filter((l) => l.enabled && l.code !== 'de').map((l) => l.code)) {
      expect(urls).toContain(`${SITE_URL}/${locale}/kazakhstan/university-document-translation`);
    }
  });
});
