import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo/site-metadata';

/**
 * Was a static public/robots.txt with a literal, independently-hardcoded domain in its
 * Sitemap: directive — the same class of drift that caused the sitemap old-domain
 * incident (SEO audit finding #1). Converted to reuse SITE_URL, the single source of
 * truth already used by src/app/sitemap.ts and src/lib/seo/site-metadata.ts.
 *
 * Disallow rules are locale-prefix-aware (SEO audit finding #4): localePrefix is
 * 'always' (src/i18n/routing.ts), so every real private route is /{locale}/dashboard,
 * /{locale}/auth/..., etc., not the bare /dashboard the previous static file assumed.
 * The `/*\/...` wildcard patterns match any locale prefix without hardcoding the
 * locale list, so this file doesn't need updating when locales are enabled/disabled.
 * The unprefixed rules are kept for the routes that genuinely aren't locale-prefixed:
 * /api/* (skipped by i18n in middleware) and /auth/callback (outside [locale]).
 *
 * robots.txt is defense-in-depth for crawl budget only — it is not the only
 * protection against indexing. Explicit `noindex` metadata (NOINDEX_METADATA,
 * src/lib/seo/site-metadata.ts) is set directly on each of these route's
 * layout/page, and auth/access control is enforced independently in middleware.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/auth/',
        '/*/auth/',
        '/dashboard',
        '/*/dashboard',
        '/*/checkout',
        '/*/payment',
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
