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
 *
 * IMPORTANT — only Disallow a route here if we do NOT need a crawler to read its
 * `noindex` meta tag (NOINDEX_METADATA, src/lib/seo/site-metadata.ts). Disallow blocks
 * the crawler from ever fetching the HTML, so it can never see a noindex tag on that
 * URL — combining both on the same route is self-defeating, not extra-safe.
 *
 * - /{locale}/auth/* (login, signup, forgot-password, reset-password) and
 *   /{locale}/payment/result are publicly reachable HTML — no auth gate in
 *   middleware — and rely on their own noindex meta tag. NOT disallowed here.
 * - /{locale}/dashboard and /{locale}/checkout ARE auth-gated in middleware
 *   (anonymous requests always redirect to /auth/login before any real HTML
 *   renders) — Disallow here is pure crawl-budget savings on a URL that's a
 *   redirect either way; their noindex meta tag is defense-in-depth for if
 *   that auth behavior ever regresses, not the primary mechanism.
 * - /api/* and /auth/callback (a route.ts handler, not a [locale] HTML page —
 *   never conflate the two) return no HTML at all, so noindex doesn't apply;
 *   Disallow is the only relevant mechanism, and the sole reason to block them.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/auth/', // unprefixed only — /auth/callback route handler, not [locale]/auth/*
        '/dashboard',
        '/*/dashboard',
        '/*/checkout',
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
