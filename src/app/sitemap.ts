import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo/site-metadata';
import { LOCALES } from '@/i18n/locales';
import { LEGAL_SLUGS } from '@/lib/legal/types';
import { LEGAL_SUPPORTED_LOCALES } from '@/lib/legal';

const ENABLED_LOCALES = LOCALES.filter((l) => l.enabled).map((l) => l.code);

/**
 * Public, indexable, canonical page paths (relative to a locale prefix).
 * Excludes: auth/dashboard/checkout/payment (private/transactional), /start
 * (pre-checkout wizard entry point, not an SEO landing page). /privacy and /tos
 * (formerly duplicate-content pages alongside /legal/privacy and /legal/terms,
 * SEO audit finding #7) no longer exist at all — they 308-redirect to their
 * /legal/* equivalent (next.config.ts), so there's nothing to list or exclude here.
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
 * Legal locale support is now a single source of truth (LEGAL_SUPPORTED_LOCALES,
 * src/lib/legal/index.ts) shared with buildLegalMetadata (src/lib/seo/site-metadata.ts,
 * canonical/hreflang/noindex) — this file no longer keeps its own separate list, so the
 * two can't drift apart (SEO audit finding #5). `de`, `tr`, and `th` are enabled
 * locales but have no content/{locale}.ts file — loadDocs() falls through to English
 * for all 7 slugs — so they're excluded here exactly as they were before, just from
 * the shared list instead of a locally duplicated one.
 */
const LEGAL_LOCALES = ENABLED_LOCALES.filter((code) => LEGAL_SUPPORTED_LOCALES.includes(code));

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
