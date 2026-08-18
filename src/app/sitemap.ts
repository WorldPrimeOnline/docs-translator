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

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];

  for (const locale of ENABLED_LOCALES) {
    for (const path of PUBLIC_PATHS) {
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
