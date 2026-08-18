/**
 * Regression guard for SEO audit finding #11 (explicit noindex on private/service
 * surfaces, not just robots.txt). One route per real category is checked directly;
 * public pages are checked to make sure noindex was not set too high (e.g. accidentally
 * on [locale]/layout.tsx or the root layout).
 *
 * Files that import next-intl/server (getTranslations, setRequestLocale) or
 * @/i18n/navigation (createNavigation → next-intl/navigation) cannot be imported
 * directly here — those next-intl subpaths ship ESM-only and are unresolvable under
 * this repo's ts-jest config, a pre-existing gap documented in
 * src/i18n/__tests__/locales.test.ts (widening jest.config.ts for next-intl is a
 * repo-wide change, out of scope for this task). For those files this test reads the
 * source directly instead of importing it — still a real regression guard (it fails if
 * NOINDEX_METADATA is added to or removed from the wrong file), just not a full
 * runtime metadata-resolution check.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { Metadata } from 'next';
import { NOINDEX_METADATA, buildHomepageMetadata, buildFallbackMetadata } from '@/lib/seo/site-metadata';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, relativePath), 'utf-8');
}

describe('NOINDEX_METADATA', () => {
  it('is index:false, follow:false', () => {
    expect(NOINDEX_METADATA).toEqual({ robots: { index: false, follow: false } });
  });
});

describe('private/service routes — directly importable (no next-intl in the file)', () => {
  it('dashboard/layout.tsx sets NOINDEX_METADATA', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../[locale]/dashboard/layout') as { metadata: Metadata };
    expect(mod.metadata).toEqual(NOINDEX_METADATA);
  });

  it('start/layout.tsx sets NOINDEX_METADATA', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../[locale]/start/layout') as { metadata: Metadata };
    expect(mod.metadata).toEqual(NOINDEX_METADATA);
  });

  it('payment/layout.tsx sets NOINDEX_METADATA', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../[locale]/payment/layout') as { metadata: Metadata };
    expect(mod.metadata).toEqual(NOINDEX_METADATA);
  });
});

describe('private/service routes — source-checked (file imports next-intl, unresolvable in jest)', () => {
  it('auth/layout.tsx wires up NOINDEX_METADATA', () => {
    const src = readSource('../[locale]/auth/layout.tsx');
    expect(src).toMatch(/import\s*{\s*NOINDEX_METADATA\s*}\s*from\s*['"]@\/lib\/seo\/site-metadata['"]/);
    expect(src).toMatch(/export const metadata:\s*Metadata\s*=\s*NOINDEX_METADATA/);
  });

  it('checkout/page.tsx wires up NOINDEX_METADATA', () => {
    const src = readSource('../[locale]/checkout/page.tsx');
    expect(src).toMatch(/import\s*{\s*NOINDEX_METADATA\s*}\s*from\s*['"]@\/lib\/seo\/site-metadata['"]/);
    expect(src).toMatch(/export const metadata:\s*Metadata\s*=\s*NOINDEX_METADATA/);
  });
});

describe('public pages — noindex not set too high, remain indexable', () => {
  it('buildHomepageMetadata does not set robots (no noindex)', () => {
    expect(buildHomepageMetadata('ru').robots).toBeUndefined();
    expect(buildHomepageMetadata('en').robots).toBeUndefined();
  });

  it('buildFallbackMetadata (root layout fallback) does not set robots (no noindex)', () => {
    expect(buildFallbackMetadata('ru').robots).toBeUndefined();
  });

  it('[locale]/layout.tsx does not reference NOINDEX_METADATA (would noindex the entire site)', () => {
    const src = readSource('../[locale]/layout.tsx');
    expect(src).not.toContain('NOINDEX_METADATA');
  });

  it('root layout.tsx does not reference NOINDEX_METADATA', () => {
    const src = readSource('../layout.tsx');
    expect(src).not.toContain('NOINDEX_METADATA');
  });

  it.each([
    '../[locale]/page.tsx',
    '../[locale]/documents/page.tsx',
    '../[locale]/documents/passport-translation/page.tsx',
    '../[locale]/kazakhstan/page.tsx',
    '../[locale]/kazakhstan/notarized-translation/page.tsx',
    '../[locale]/contacts/page.tsx',
    '../[locale]/partners/page.tsx',
    '../[locale]/legal/[slug]/page.tsx',
  ])('%s does not reference NOINDEX_METADATA', (relativePath) => {
    const src = readSource(relativePath);
    expect(src).not.toContain('NOINDEX_METADATA');
    expect(src).not.toMatch(/index:\s*false/);
  });
});
