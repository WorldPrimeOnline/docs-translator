/**
 * Regression guard for SEO audit finding #6 (structured data / JSON-LD cleanup).
 * Real imports — unlike the page.tsx files, these landing-page config modules have no
 * next-intl dependency, so they're fully importable and executable here.
 */
import {
  passportTranslationConfig,
  bankStatementTranslationConfig,
  diplomaTranslationConfig,
  documentsHubConfig,
} from '../documents';
import {
  kazakhstanConfig,
  kazakhstanCertifiedConfig,
  kazakhstanNotarizedConfig,
  kazakhstanUniversityConfig,
} from '../kazakhstan';
import { ORGANIZATION_ID, SERVICE_PROVIDER_REF } from '@/lib/seo/organization';
import { SITE_URL } from '@/lib/seo/site-metadata';
import type { LandingPageConfig } from '../types';

const CONFIGS_WITH_SERVICE_SCHEMA: Array<{ name: string; config: LandingPageConfig }> = [
  { name: 'passportTranslationConfig', config: passportTranslationConfig },
  { name: 'bankStatementTranslationConfig', config: bankStatementTranslationConfig },
  { name: 'diplomaTranslationConfig', config: diplomaTranslationConfig },
  { name: 'kazakhstanConfig', config: kazakhstanConfig },
  { name: 'kazakhstanCertifiedConfig', config: kazakhstanCertifiedConfig },
  { name: 'kazakhstanNotarizedConfig', config: kazakhstanNotarizedConfig },
  { name: 'kazakhstanUniversityConfig', config: kazakhstanUniversityConfig },
];

describe('landing page Service JSON-LD', () => {
  it('every config with structuredData actually has exactly one Service entry (sanity check on the inventory above)', () => {
    for (const { config } of CONFIGS_WITH_SERVICE_SCHEMA) {
      expect(config.structuredData).toBeDefined();
      expect(config.structuredData).toHaveLength(1);
      expect(config.structuredData?.[0]?.['@type']).toBe('Service');
    }
  });

  it.each(CONFIGS_WITH_SERVICE_SCHEMA)('$name: valid @context/@type', ({ config }) => {
    const schema = config.structuredData![0]!;
    expect(schema['@context']).toBe('https://schema.org');
    expect(schema['@type']).toBe('Service');
  });

  it.each(CONFIGS_WITH_SERVICE_SCHEMA)('$name: provider references the sitewide Organization via @id', ({ config }) => {
    const schema = config.structuredData![0]!;
    expect(schema.provider).toEqual(SERVICE_PROVIDER_REF);
    expect((schema.provider as Record<string, unknown>)['@id']).toBe(ORGANIZATION_ID);
  });

  it.each(CONFIGS_WITH_SERVICE_SCHEMA)('$name: no stale domain or brand anywhere in the schema', ({ config }) => {
    const json = JSON.stringify(config.structuredData);
    expect(json).not.toMatch(/wpo\.online/);
    expect(json).not.toMatch(/WPO Online Translations/);
    expect(json).not.toMatch(/docs-translator/);
    expect(json).not.toMatch(/vercel\.app/);
  });

  it.each(CONFIGS_WITH_SERVICE_SCHEMA)('$name: service name matches the page (contains "WPO Translations", not the old brand)', ({ config }) => {
    const schema = config.structuredData![0]!;
    expect(schema.name as string).toContain('WPO Translations');
  });

  it('every Service.name is distinct across all 7 pages (page-specific, not collapsed to one fallback)', () => {
    const names = CONFIGS_WITH_SERVICE_SCHEMA.map(({ config }) => config.structuredData![0]!.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('no Service schema embeds an absolute URL that is not the canonical production host (none currently set url/mainEntityOfPage/offers)', () => {
    for (const { config } of CONFIGS_WITH_SERVICE_SCHEMA) {
      const schema = config.structuredData![0]!;
      const json = JSON.stringify(schema);
      const urls = json.match(/https?:\/\/[^"]+/g) ?? [];
      for (const url of urls) {
        expect(url.startsWith(SITE_URL) || url === 'https://schema.org').toBe(true);
      }
    }
  });

  it('documents hub page has no structuredData — pre-existing gap, not a new schema added by this fix', () => {
    expect(documentsHubConfig.structuredData).toBeUndefined();
  });
});
