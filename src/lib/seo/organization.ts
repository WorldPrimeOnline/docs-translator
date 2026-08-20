import { SITE_URL, SITE_NAME } from './site-metadata';
import { BUSINESS_PROFILE } from '@/lib/business-profile';
import type { BreadcrumbItem } from '@/lib/landing-pages/types';

/**
 * Sitewide entity anchor (SEO audit finding #6). Rendered once, in the root layout
 * (src/app/layout.tsx), on every page. Landing-page Service schemas
 * (src/lib/landing-pages/{documents,kazakhstan}.ts) reference it via
 * SERVICE_PROVIDER_REF instead of each page duplicating its own copy of the
 * Organization object — 6 of 7 previously duplicated a stale, non-resolving domain
 * (wpo.online) and an old brand name (WPO Online Translations); the 7th had the
 * current brand but the apex host instead of www. Both are unified here to the single
 * source of truth already used for canonical/OG (SITE_URL, SITE_NAME).
 *
 * 2026-08-20 SEO audit P0 fix: added legalName/alternateName/logo. Root cause this
 * addresses — every page's visible header/footer logo (wpo-logo.tsx) renders "World
 * Prime Online" (the legal entity name), while every <title>/OG/JSON-LD name says
 * "WPO Translations" (the product brand) — two different strings with zero structured
 * link between them anywhere, a plausible contributor to Google conflating "WPO" with
 * the unrelated, far more authoritative WIPO entity. alternateName ties the two
 * strings together explicitly; legalName is the real registered entity name from
 * business-profile.ts (single source of truth, same file the footer/contacts page
 * already read from — not invented here). logo points at the same file the contacts
 * page already displays as the provider logo. No visible page content changes.
 *
 * sameAs deliberately omitted: no confirmed official WPO social/business-listing
 * profile URL exists anywhere in this codebase (grepped for LinkedIn/Instagram/
 * Facebook/2GIS/Google Business/etc. — zero matches) — inventing one would be worse
 * than omitting it. Add sameAs only once a real, confirmed profile URL is provided.
 */
export const ORGANIZATION_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;

export function getOrganizationSchema(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': ORGANIZATION_ID,
    name: SITE_NAME,
    alternateName: 'World Prime Online',
    legalName: BUSINESS_PROFILE.legalName,
    url: SITE_URL,
    logo: `${SITE_URL}/logo/logo.png`,
  };
}

export function getWebsiteSchema(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': WEBSITE_ID,
    name: SITE_NAME,
    url: SITE_URL,
  };
}

/**
 * Use as `provider: SERVICE_PROVIDER_REF` on any Service schema instead of embedding a
 * separate Organization object per page — references the single sitewide Organization
 * node (getOrganizationSchema(), rendered in the root layout on the same page) by @id.
 */
export const SERVICE_PROVIDER_REF: Record<string, unknown> = { '@id': ORGANIZATION_ID };

/**
 * BreadcrumbList JSON-LD (2026-08-20 SEO audit P1) — built from the same breadcrumb
 * array every landing page already renders visibly (HeroSection.tsx), never a
 * separately-invented trail. Same >1-item guard as the visible breadcrumb (a lone
 * "Home" crumb isn't a real trail). Absolute URLs via SITE_URL + locale, matching the
 * convention every other schema/canonical/hreflang builder in this file already uses.
 */
export function getBreadcrumbListSchema(breadcrumb: BreadcrumbItem[], locale: string): Record<string, unknown> | null {
  if (breadcrumb.length < 2) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: breadcrumb.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.label,
      item: `${SITE_URL}/${locale}${item.href === '/' ? '' : item.href}`,
    })),
  };
}
