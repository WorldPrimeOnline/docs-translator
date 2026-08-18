/**
 * Regression guard for SEO audit finding #3 (landing page canonical/hreflang/metadata)
 * and the finding #9 minimal fix (next-intl's conflicting Link header).
 *
 * The 8 real page.tsx files import `next-intl/server` (getTranslations,
 * setRequestLocale) and src/i18n/routing.ts imports `next-intl/routing` — both ship
 * ESM-only and are unresolvable under this repo's ts-jest config, the same
 * pre-existing gap documented in src/i18n/__tests__/locales.test.ts and
 * src/app/__tests__/noindex-coverage.test.ts (widening jest.config.ts for next-intl is
 * a repo-wide change, out of scope here). This file reads source directly instead of
 * importing — still a real regression guard (fails if a page reverts to static
 * `export const metadata` or points at the wrong config/path), just not a full runtime
 * metadata-resolution check. The helper itself (buildLandingMetadata) IS fully unit
 * tested with real imports in src/lib/seo/__tests__/site-metadata.test.ts.
 */
import * as fs from 'fs';
import * as path from 'path';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, relativePath), 'utf-8');
}

const LANDING_PAGES: Array<{ file: string; path: string; configVar: string }> = [
  { file: '../[locale]/documents/page.tsx', path: '/documents', configVar: 'documentsHubConfig' },
  {
    file: '../[locale]/documents/passport-translation/page.tsx',
    path: '/documents/passport-translation',
    configVar: 'passportTranslationConfig',
  },
  {
    file: '../[locale]/documents/bank-statement-translation/page.tsx',
    path: '/documents/bank-statement-translation',
    configVar: 'bankStatementTranslationConfig',
  },
  {
    file: '../[locale]/documents/diploma-translation/page.tsx',
    path: '/documents/diploma-translation',
    configVar: 'diplomaTranslationConfig',
  },
  { file: '../[locale]/kazakhstan/page.tsx', path: '/kazakhstan', configVar: 'kazakhstanConfig' },
  {
    file: '../[locale]/kazakhstan/certified-translation/page.tsx',
    path: '/kazakhstan/certified-translation',
    configVar: 'kazakhstanCertifiedConfig',
  },
  {
    file: '../[locale]/kazakhstan/notarized-translation/page.tsx',
    path: '/kazakhstan/notarized-translation',
    configVar: 'kazakhstanNotarizedConfig',
  },
  {
    file: '../[locale]/kazakhstan/university-document-translation/page.tsx',
    path: '/kazakhstan/university-document-translation',
    configVar: 'kazakhstanUniversityConfig',
  },
];

describe('landing pages — generateMetadata wiring', () => {
  it.each(LANDING_PAGES)('$file uses generateMetadata (no leftover static export const metadata)', ({ file }) => {
    const src = readSource(file);
    expect(src).toMatch(/export async function generateMetadata/);
    expect(src).not.toMatch(/export const metadata:\s*Metadata\s*=\s*\{/);
  });

  it.each(LANDING_PAGES)('$file calls buildLandingMetadata with its own path ($path)', ({ file, path: p }) => {
    const src = readSource(file);
    expect(src).toMatch(/import\s*{\s*buildLandingMetadata\s*}\s*from\s*['"]@\/lib\/seo\/site-metadata['"]/);
    // Escape the path for use in a RegExp (it contains '/').
    const escaped = p.replace(/[/]/g, '\\/');
    expect(src).toMatch(new RegExp(`path:\\s*['"]${escaped}['"]`));
  });

  it.each(LANDING_PAGES)('$file sources title/description from its own distinct config ($configVar)', ({ file, configVar }) => {
    const src = readSource(file);
    expect(src).toContain(`title: ${configVar}.title`);
    expect(src).toContain(`description: ${configVar}.description`);
  });

  it('every landing page imports a DIFFERENT config — no two pages share the same source object', () => {
    const configVars = LANDING_PAGES.map((p) => p.configVar);
    expect(new Set(configVars).size).toBe(configVars.length);
  });

  it('no landing page references NOINDEX_METADATA (must stay indexable)', () => {
    for (const { file } of LANDING_PAGES) {
      const src = readSource(file);
      expect(src).not.toContain('NOINDEX_METADATA');
    }
  });

  it('only kazakhstan/university-document-translation excludes a locale from hreflang (verified de content gap)', () => {
    for (const { file, path: p } of LANDING_PAGES) {
      const src = readSource(file);
      if (p === '/kazakhstan/university-document-translation') {
        expect(src).toMatch(/excludeFromHreflang:\s*\['de'\]/);
      } else {
        expect(src).not.toContain('excludeFromHreflang');
      }
    }
  });
});

describe('next-intl alternate Link header (finding #9 minimal fix)', () => {
  it('src/i18n/routing.ts disables next-intl automatic alternateLinks (was contradicting HTML head hreflang)', () => {
    const src = readSource('../../i18n/routing.ts');
    expect(src).toMatch(/alternateLinks:\s*false/);
  });

  it('routing.ts still passes the full locale list (both enabled and disabled) — required for the disabled-locale redirect in middleware, unrelated to alternateLinks', () => {
    const src = readSource('../../i18n/routing.ts');
    expect(src).toMatch(/locales:\s*LOCALE_CODES/);
  });
});
