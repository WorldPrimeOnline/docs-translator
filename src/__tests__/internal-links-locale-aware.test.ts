/**
 * Regression guard for SEO audit finding #8 (internal links losing locale prefix,
 * falling through to a middleware redirect that lands on /ru regardless of the
 * user's actual locale).
 *
 * All fixed files are 'use client' components or import next-intl/server —
 * unresolvable here for the same class of reason next-intl subpaths are unresolvable
 * under this repo's ts-jest config, documented repeatedly elsewhere (locales.test.ts,
 * noindex-coverage.test.ts, landing-pages-metadata.test.ts). Source-checked instead of
 * imported/rendered — confirms WIRING (correct import source, correct branching for the
 * one already-prefixed-path case). Real RUNTIME semantics (actual rendered href values,
 * absence of a redirect hop) are verified separately against a production build — see
 * the fix's report for those results; that's the only way to get true evidence for
 * client components tangled in next-intl's request context.
 */
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.join(__dirname, '..', '..');

function readSource(relativeToRepoRoot: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativeToRepoRoot), 'utf-8');
}

const LOCALE_AWARE_LINK_ONLY_FILES = [
  'src/components/navbar.tsx',
  'src/components/landing/HeroSection.tsx',
  'src/components/landing/FinalCTASection.tsx',
  'src/components/landing/PricingSection.tsx',
  'src/app/[locale]/documents/page.tsx',
  'src/app/[locale]/page.tsx',
  'src/app/[locale]/not-found.tsx',
  'src/app/[locale]/error.tsx',
  'src/app/[locale]/auth/forgot-password/page.tsx',
  'src/app/[locale]/auth/signup/page.tsx',
];

describe('finding #8 — Link import source', () => {
  it.each(LOCALE_AWARE_LINK_ONLY_FILES)('%s imports Link from @/i18n/navigation, not next/link', (file) => {
    const src = readSource(file);
    expect(src).toMatch(/import\s*{[^}]*\bLink\b[^}]*}\s*from\s*['"]@\/i18n\/navigation['"]/);
    expect(src).not.toMatch(/import\s+Link\s+from\s+['"]next\/link['"]/);
  });

  it('already-correct files (fixed before this task) still import Link from @/i18n/navigation', () => {
    for (const file of [
      'src/app/[locale]/layout.tsx',
      'src/app/[locale]/auth/layout.tsx',
      'src/app/[locale]/payment/result/page.tsx',
      'src/components/order/CheckoutClient.tsx',
    ]) {
      const src = readSource(file);
      expect(src).toMatch(/import\s*{[^}]*\bLink\b[^}]*}\s*from\s*['"]@\/i18n\/navigation['"]/);
    }
  });
});

describe('finding #8 — router.push/replace locale awareness', () => {
  it('dashboard/page.tsx uses the locale-aware router (logout -> home preserves locale)', () => {
    const src = readSource('src/app/[locale]/dashboard/page.tsx');
    expect(src).toMatch(/import\s*{\s*useRouter\s*}\s*from\s*['"]@\/i18n\/navigation['"]/);
    expect(src).toContain("router.push('/')");
  });

  it('StagingPaymentBypassButton.tsx uses the locale-aware router', () => {
    const src = readSource('src/components/payment/StagingPaymentBypassButton.tsx');
    expect(src).toMatch(/import\s*{\s*useRouter\s*}\s*from\s*['"]@\/i18n\/navigation['"]/);
  });

  it('reset-password/page.tsx uses the locale-aware router for its plain "/dashboard" push', () => {
    const src = readSource('src/app/[locale]/auth/reset-password/page.tsx');
    expect(src).toMatch(/import\s*{\s*Link,\s*useRouter\s*}\s*from\s*['"]@\/i18n\/navigation['"]/);
    expect(src).toContain("router.push('/dashboard')");
  });

  it('login/page.tsx uses TWO routers deliberately: raw next/navigation for the already-prefixed `next` continuation URL, locale-aware for the plain "/dashboard" fallback', () => {
    const src = readSource('src/app/[locale]/auth/login/page.tsx');
    expect(src).toMatch(/import\s*{\s*useRouter,\s*useSearchParams\s*}\s*from\s*['"]next\/navigation['"]/);
    expect(src).toMatch(/import\s*{\s*Link,\s*useRouter as useLocaleRouter\s*}\s*from\s*['"]@\/i18n\/navigation['"]/);
    expect(src).toMatch(/if\s*\(next\)\s*{\s*router\.push\(next\);\s*}\s*else\s*{\s*localeRouter\.push\('\/dashboard'\);\s*}/);
  });

  it('OrderWizard.tsx is unchanged — already locale-aware via manual /${locale}/... construction, deliberately using the raw router since it builds an already-prefixed path itself', () => {
    const src = readSource('src/components/order/OrderWizard.tsx');
    expect(src).toMatch(/import\s*{\s*useRouter\s*}\s*from\s*['"]next\/navigation['"]/);
    expect(src).toContain('const checkoutPath = `/${locale}/checkout');
  });
});

describe('finding #8 — documented exceptions (left unchanged deliberately)', () => {
  it('root-level not-found.tsx and error.tsx still use next/link — no reliable locale context outside [locale]/layout.tsx\'s NextIntlClientProvider', () => {
    for (const file of ['src/app/not-found.tsx', 'src/app/error.tsx']) {
      const src = readSource(file);
      expect(src).toMatch(/import\s+Link\s+from\s+['"]next\/link['"]/);
    }
  });

  it('language-switcher.tsx still does a raw window.location.href locale switch (deliberate full-reload mechanism, not this bug pattern)', () => {
    const src = readSource('src/components/language-switcher.tsx');
    expect(src).toContain('window.location.href');
  });

  it('the OAuth callback route handler is not locale-prefixed (intentional, matches middleware.ts\'s explicit /auth/callback skip)', () => {
    const src = readSource('src/app/auth/callback/route.ts');
    expect(src).toContain('/auth/login?error=auth_callback_error');
  });
});

describe('finding #8 — special routes and legal aliases safety', () => {
  it('no fixed file introduced a link to the disabled-locale codes', () => {
    const disabledCodes = ['ko', 'tj', 'tk', 'mn', 'es'];
    for (const file of [...LOCALE_AWARE_LINK_ONLY_FILES, 'src/app/[locale]/dashboard/page.tsx', 'src/components/payment/StagingPaymentBypassButton.tsx', 'src/app/[locale]/auth/login/page.tsx', 'src/app/[locale]/auth/reset-password/page.tsx']) {
      const src = readSource(file);
      for (const code of disabledCodes) {
        expect(src).not.toMatch(new RegExp(`href=["'\`]/${code}/`));
      }
    }
  });

  it('no fixed file links to the retired /privacy or /tos aliases (finding #7)', () => {
    for (const file of LOCALE_AWARE_LINK_ONLY_FILES) {
      const src = readSource(file);
      expect(src).not.toMatch(/href=\{?["'`]\/(?:privacy|tos)["'`]/);
    }
  });

  it('mailto/tel/external links in touched files are untouched (still raw <a>, not wrapped in the locale-aware Link)', () => {
    // business-profile email link lives in [locale]/layout.tsx footer — untouched by this fix.
    const src = readSource('src/app/[locale]/layout.tsx');
    expect(src).toContain('href={`mailto:');
  });
});
