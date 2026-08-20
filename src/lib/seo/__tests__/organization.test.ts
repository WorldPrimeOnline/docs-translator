/**
 * Regression guard for SEO audit finding #6 (structured data / JSON-LD cleanup):
 * the sitewide Organization/WebSite entity anchor.
 */
import { getOrganizationSchema, getWebsiteSchema, getBreadcrumbListSchema, SERVICE_PROVIDER_REF, ORGANIZATION_ID, WEBSITE_ID } from '../organization';
import { SITE_URL, SITE_NAME } from '../site-metadata';
import { BUSINESS_PROFILE } from '@/lib/business-profile';

describe('getOrganizationSchema', () => {
  const org = getOrganizationSchema();

  it('has correct @context/@type/@id/name/url', () => {
    expect(org['@context']).toBe('https://schema.org');
    expect(org['@type']).toBe('Organization');
    expect(org['@id']).toBe(`${SITE_URL}/#organization`);
    expect(org.name).toBe(SITE_NAME);
    expect(org.url).toBe(SITE_URL);
  });

  it('name is the current brand, not the stale "WPO Online Translations"', () => {
    expect(org.name).toBe('WPO Translations');
    expect(org.name).not.toBe('WPO Online Translations');
  });

  it('url is the canonical www host — never the apex, wpo.online, or a vercel.app domain', () => {
    expect(org.url).toBe('https://www.wpotranslations.org');
    expect(org.url).not.toBe('https://wpotranslations.org');
    expect(JSON.stringify(org)).not.toMatch(/wpo\.online|vercel\.app/);
  });

  it('does not include fabricated fields (no fake rating/review/award/certification)', () => {
    const keys = Object.keys(org);
    for (const forbidden of ['aggregateRating', 'review', 'award', 'hasCredential', 'employee']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  // 2026-08-20 SEO audit P0 fix: every page's header/footer logo renders "World Prime
  // Online" while every <title>/OG/JSON-LD name says "WPO Translations" — two strings
  // with no structured link between them. alternateName/legalName close that gap.
  it('alternateName ties the header/footer brand string ("World Prime Online") to name', () => {
    expect(org.alternateName).toBe('World Prime Online');
  });

  it('legalName comes from business-profile.ts — the single source of truth, not invented here', () => {
    expect(org.legalName).toBe(BUSINESS_PROFILE.legalName);
    expect(org.legalName).toBe('ТОО World Prime Online');
  });

  it('logo points at the same file the contacts page already displays as the provider logo', () => {
    expect(org.logo).toBe(`${SITE_URL}/logo/logo.png`);
  });

  it('still has no sameAs — no confirmed official profile URL exists anywhere in the codebase; never invent one', () => {
    expect(Object.keys(org)).not.toContain('sameAs');
  });
});

describe('getWebsiteSchema', () => {
  const site = getWebsiteSchema();

  it('has correct @context/@type/@id/name/url', () => {
    expect(site['@context']).toBe('https://schema.org');
    expect(site['@type']).toBe('WebSite');
    expect(site['@id']).toBe(`${SITE_URL}/#website`);
    expect(site.name).toBe(SITE_NAME);
    expect(site.url).toBe(SITE_URL);
  });

  it('does not include a SearchAction (no real public site search exists)', () => {
    expect(Object.keys(site)).not.toContain('potentialAction');
  });
});

describe('getBreadcrumbListSchema (2026-08-20 SEO audit P1)', () => {
  const breadcrumb = [
    { label: 'WPO Translations', href: '/' },
    { label: 'Kazakhstan', href: '/kazakhstan' },
    { label: 'Translation with Agent Stamp', href: '/kazakhstan/certified-translation' },
  ];

  it('builds a valid BreadcrumbList with absolute, locale-prefixed URLs', () => {
    const schema = getBreadcrumbListSchema(breadcrumb, 'ru');
    expect(schema).not.toBeNull();
    expect(schema!['@context']).toBe('https://schema.org');
    expect(schema!['@type']).toBe('BreadcrumbList');
    const items = schema!.itemListElement as Array<Record<string, unknown>>;
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({ '@type': 'ListItem', position: 1, name: 'WPO Translations', item: `${SITE_URL}/ru` });
    expect(items[2]).toEqual({
      '@type': 'ListItem',
      position: 3,
      name: 'Translation with Agent Stamp',
      item: `${SITE_URL}/ru/kazakhstan/certified-translation`,
    });
  });

  it('changes locale in every item URL, not just the first', () => {
    const schema = getBreadcrumbListSchema(breadcrumb, 'de');
    const items = schema!.itemListElement as Array<Record<string, unknown>>;
    for (const item of items) {
      expect(String(item.item)).toContain(`${SITE_URL}/de`);
    }
  });

  it('returns null for a lone single-item breadcrumb (no real trail) — same guard as the visible UI', () => {
    expect(getBreadcrumbListSchema([{ label: 'WPO Translations', href: '/' }], 'ru')).toBeNull();
  });

  it('returns null for an empty breadcrumb', () => {
    expect(getBreadcrumbListSchema([], 'ru')).toBeNull();
  });
});

describe('SERVICE_PROVIDER_REF', () => {
  it('references the Organization by @id, matching ORGANIZATION_ID exactly', () => {
    expect(SERVICE_PROVIDER_REF).toEqual({ '@id': ORGANIZATION_ID });
    expect(ORGANIZATION_ID).toBe(getOrganizationSchema()['@id']);
  });

  it('ORGANIZATION_ID and WEBSITE_ID are distinct, both under the canonical host', () => {
    expect(ORGANIZATION_ID).not.toBe(WEBSITE_ID);
    expect(ORGANIZATION_ID.startsWith(SITE_URL)).toBe(true);
    expect(WEBSITE_ID.startsWith(SITE_URL)).toBe(true);
  });
});
