/**
 * Regression guard for SEO audit finding #5 — the legal page's generateMetadata wiring.
 *
 * src/app/[locale]/legal/[slug]/page.tsx imports `next-intl/server` and `@/i18n/routing`
 * (which imports `next-intl/routing`) — both unresolvable here for the same class of
 * reason next-intl subpaths are unresolvable under this repo's ts-jest config elsewhere
 * (locales.test.ts, landing-pages-metadata.test.ts, etc.). Source-checked instead of
 * imported. buildLegalMetadata itself IS fully unit tested with real imports in
 * src/lib/seo/__tests__/site-metadata.test.ts.
 */
import * as fs from 'fs';
import * as path from 'path';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, relativePath), 'utf-8');
}

describe('legal/[slug]/page.tsx — generateMetadata wiring', () => {
  const src = readSource('../[locale]/legal/[slug]/page.tsx');

  it('imports buildLegalMetadata from the shared helper', () => {
    expect(src).toMatch(/import\s*{\s*buildLegalMetadata\s*}\s*from\s*['"]@\/lib\/seo\/site-metadata['"]/);
  });

  it('generateMetadata delegates to buildLegalMetadata with slug + existing metaTitle/metaDescription (not invented copy)', () => {
    expect(src).toMatch(/return buildLegalMetadata\(locale,\s*{\s*slug,\s*title:\s*doc\.metaTitle,\s*description:\s*doc\.metaDescription,?\s*}\)/);
  });

  it('still returns {} for an unrecognized locale before touching legal content (unchanged guard)', () => {
    expect(src).toContain('if (!routing.locales.includes(locale as Locale)) return {};');
  });
});
