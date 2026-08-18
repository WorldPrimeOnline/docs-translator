import { SITE_URL, SITE_NAME } from './site-metadata';

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
 * Deliberately minimal — name + url + @id only. logo/contactPoint/email/legalName are
 * real, public facts (business-profile.ts) that could be added later, but adding them
 * now isn't needed to fix the stale-domain/brand defect this task targets, and this
 * project's SEO fixes have consistently kept structured data to the minimum that's
 * actually true and useful rather than filling in every optional Schema.org field.
 */
export const ORGANIZATION_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;

export function getOrganizationSchema(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': ORGANIZATION_ID,
    name: SITE_NAME,
    url: SITE_URL,
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
