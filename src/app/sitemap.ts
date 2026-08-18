import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo/site-metadata';
import { LOCALES } from '@/i18n/locales';
import { LEGAL_SLUGS } from '@/lib/legal/types';

const ENABLED_LOCALES = LOCALES.filter((l) => l.enabled).map((l) => l.code);

/**
 * Public, indexable, canonical page paths (relative to a locale prefix).
 * Excludes: auth/dashboard/checkout/payment (private/transactional), /start
 * (pre-checkout wizard entry point, not an SEO landing page), and /privacy
 * + /tos (duplicate-content aliases of /legal/privacy and /legal/terms —
 * see SEO audit finding #7; not resolved yet, so left out of the sitemap).
 */
const PUBLIC_PATHS = [
  '',
  '/documents',
  '/documents/passport-translation',
  '/documents/bank-statement-translation',
  '/documents/diploma-translation',
  '/kazakhstan',
  '/kazakhstan/certified-translation',
  '/kazakhstan/notarized-translation',
  '/kazakhstan/university-document-translation',
  '/contacts',
  '/partners',
];

/**
 * Locales whose legal content in src/lib/legal/index.ts's loadDocs() has a real,
 * locale-specific case. `de`, `tr`, and `th` are enabled locales but fall through
 * to loadDocs()'s English default — including their /legal/* pages here would
 * sitemap near-duplicate English content under 3 extra locale URLs (SEO audit
 * finding #5). Excluded until real translations exist for those three.
 */
const LOCALES_WITHOUT_LEGAL_TRANSLATION = new Set(['de', 'tr', 'th']);
const LEGAL_LOCALES = ENABLED_LOCALES.filter((code) => !LOCALES_WITHOUT_LEGAL_TRANSLATION.has(code));

/**
 * Single locale/page exclusion (SEO audit finding #3 fix): messages/de/landing-pages.json
 * is missing 18 keys under kazakhstanUniversity (docs list + all 4 pain points) —
 * verified via a full key-diff against en. The page renders 200, but with the raw i18n
 * key path visible in place of that missing text (e.g. literal "kazakhstanUniversity.
 * painHeadline" in the rendered HTML), not real German content — not something to
 * submit to Google as an indexable canonical page. Same exclusion is applied to this
 * page's hreflang alternates (src/app/[locale]/kazakhstan/university-document-translation
 * /page.tsx). Translation work to fill the gap is out of scope here.
 */
const EXCLUDED_LOCALE_PATHS: ReadonlySet<string> = new Set(['de:/kazakhstan/university-document-translation']);

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];

  for (const locale of ENABLED_LOCALES) {
    for (const path of PUBLIC_PATHS) {
      if (EXCLUDED_LOCALE_PATHS.has(`${locale}:${path}`)) continue;
      entries.push({ url: `${SITE_URL}/${locale}${path}` });
    }
  }

  for (const locale of LEGAL_LOCALES) {
    for (const slug of LEGAL_SLUGS) {
      entries.push({ url: `${SITE_URL}/${locale}/legal/${slug}` });
    }
  }

  return entries;
}
