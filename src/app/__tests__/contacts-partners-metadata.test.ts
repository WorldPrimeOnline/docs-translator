/**
 * Regression guard for the final residual SEO audit (P1 findings #1/#2): /contacts and
 * /partners had generateMetadata returning only {title, description} — no canonical,
 * hreflang, or OG/Twitter — despite being listed in sitemap.ts as indexable canonical
 * URLs for all 9 enabled locales. Both pages now delegate to buildLandingMetadata, the
 * same helper already used by the 8 landing pages (finding #3), giving them self-
 * canonical + hreflang for every enabled locale + x-default + minimal OG/Twitter.
 *
 * Both pages import `next-intl/server` — unresolvable under this repo's ts-jest config
 * (same pre-existing gap as landing-pages-metadata.test.ts, legal-page-metadata.test.ts).
 * Source-checked instead of imported. buildLandingMetadata itself IS fully unit tested
 * with real imports in src/lib/seo/__tests__/site-metadata.test.ts — those hreflang/
 * canonical/disabled-locale/OG assertions apply here unchanged since both pages reuse
 * the exact same helper, not a reimplementation.
 */
import * as fs from 'fs';
import * as path from 'path';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, relativePath), 'utf-8');
}

const PAGES: Array<{ file: string; path: string; namespace: string }> = [
  { file: '../[locale]/contacts/page.tsx', path: '/contacts', namespace: 'contactsPage' },
  { file: '../[locale]/partners/page.tsx', path: '/partners', namespace: 'partnersPage' },
];

describe('contacts/partners — generateMetadata wiring', () => {
  it.each(PAGES)('$file imports buildLandingMetadata from the shared helper', ({ file }) => {
    const src = readSource(file);
    expect(src).toMatch(/import\s*{\s*buildLandingMetadata\s*}\s*from\s*['"]@\/lib\/seo\/site-metadata['"]/);
  });

  it.each(PAGES)('$file delegates to buildLandingMetadata with its own path ($path)', ({ file, path: p }) => {
    const src = readSource(file);
    const escaped = p.replace(/[/]/g, '\\/');
    expect(src).toMatch(new RegExp(`return buildLandingMetadata\\(locale,\\s*{[\\s\\S]*?path:\\s*['"]${escaped}['"]`));
  });

  it.each(PAGES)('$file sources title/description from real getTranslations($namespace) calls, not invented copy', ({ file, namespace }) => {
    const src = readSource(file);
    expect(src).toMatch(new RegExp(`getTranslations\\(['"]${namespace}['"]\\)`));
    expect(src).toMatch(/title:\s*t\('metaTitle'\)/);
    expect(src).toMatch(/description:\s*t\('metaDescription'\)/);
  });

  it.each(PAGES)('$file no longer returns a bare {title, description} object literal', ({ file }) => {
    const src = readSource(file);
    expect(src).not.toMatch(/return\s*{\s*title:\s*t\('metaTitle'\),\s*description:\s*t\('metaDescription'\),?\s*};/);
  });
});
