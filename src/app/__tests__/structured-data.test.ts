/**
 * Regression guard for SEO audit finding #6 (structured data / JSON-LD cleanup) — the
 * root layout's sitewide Organization/WebSite wiring.
 *
 * src/app/layout.tsx imports `next/font/google` (build-time-only, not a real resolvable
 * package outside Next's own build pipeline) and `next/headers` (server-only, not
 * mockable under plain ts-jest) — unresolvable here for the same class of reason
 * next-intl subpaths are (see src/i18n/__tests__/locales.test.ts,
 * src/app/__tests__/noindex-coverage.test.ts). Source-checked instead of imported.
 * getOrganizationSchema/getWebsiteSchema themselves ARE fully unit tested with real
 * imports in src/lib/seo/__tests__/organization.test.ts.
 */
import * as fs from 'fs';
import * as path from 'path';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, relativePath), 'utf-8');
}

describe('root layout — sitewide Organization/WebSite JSON-LD', () => {
  const src = readSource('../layout.tsx');

  it('imports getOrganizationSchema and getWebsiteSchema from the single organization.ts source of truth', () => {
    expect(src).toMatch(
      /import\s*{\s*getOrganizationSchema,\s*getWebsiteSchema\s*}\s*from\s*['"]@\/lib\/seo\/organization['"]/,
    );
  });

  it('renders both schemas via the shared StructuredData component', () => {
    expect(src).toMatch(/import\s*{\s*StructuredData\s*}\s*from\s*['"]@\/components\/landing\/StructuredData['"]/);
    expect(src).toMatch(/<StructuredData\s+schemas=\{\[getOrganizationSchema\(\),\s*getWebsiteSchema\(\)\]\}\s*\/>/);
  });

  it('does not reference the stale wpo.online domain or old brand name', () => {
    expect(src).not.toMatch(/wpo\.online/);
    expect(src).not.toMatch(/WPO Online Translations/);
  });
});
