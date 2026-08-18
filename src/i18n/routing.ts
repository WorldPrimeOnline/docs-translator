import { defineRouting } from 'next-intl/routing';
import { LOCALE_CODES, DEFAULT_LOCALE } from './locales';

export const routing = defineRouting({
  locales: LOCALE_CODES as unknown as [string, ...string[]],
  defaultLocale: DEFAULT_LOCALE,
  // All locales always have /{code}/ prefix. / redirects to /ru.
  localePrefix: 'always',
  localeCookie: true,
  // next-intl's automatic `Link: rel="alternate"` header (SEO audit finding #9) has no
  // option to advertise a subset of `locales` — it always uses this full array, which
  // must stay all 14 codes (enabled + disabled) for the disabled-locale redirect logic
  // in src/middleware.ts to keep matching /ko/*, /tj/*, etc. That header therefore
  // always contradicted the HTML <head> hreflang tags (src/lib/seo/site-metadata.ts),
  // which correctly use only enabled locales, and always included disabled locales that
  // just redirect away. Disabled entirely — hreflang is HTML-<head>-only, driven solely
  // by buildHomepageMetadata/buildLandingMetadata. This does not affect locale
  // routing/redirects; it only turns off that one auto-generated header.
  alternateLinks: false,
});

export type Locale = (typeof routing.locales)[number];
