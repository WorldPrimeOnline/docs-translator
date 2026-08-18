/**
 * Regression guard for SEO audit finding #6 (structured data / JSON-LD cleanup):
 * the sitewide Organization/WebSite entity anchor.
 */
import { getOrganizationSchema, getWebsiteSchema, SERVICE_PROVIDER_REF, ORGANIZATION_ID, WEBSITE_ID } from '../organization';
import { SITE_URL, SITE_NAME } from '../site-metadata';

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
