/**
 * Regression guard for SEO audit finding #7 (duplicate legal URLs): /{locale}/privacy
 * and /{locale}/tos used to be standalone 200 pages duplicating /{locale}/legal/privacy
 * and /{locale}/legal/terms. Both page.tsx files were deleted; next.config.ts now
 * 308-redirects every locale (enabled and disabled) straight to its /legal/*
 * equivalent, enumerated from the same LOCALES source of truth as sitemap.ts/robots.ts.
 */
import { LOCALES, DEFAULT_LOCALE } from '@/i18n/locales';

type RedirectRule = {
  source: string;
  destination: string;
  permanent: boolean;
  has?: Array<{ type: string; value: string }>;
};

function loadLegalRedirects(): RedirectRule[] {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../../next.config');
  const config = (mod.default ?? mod) as { redirects: () => Promise<RedirectRule[]> };
  return config.redirects() as unknown as RedirectRule[];
}

describe('next.config redirects — /privacy and /tos legal aliases', () => {
  let rules: RedirectRule[];

  beforeAll(async () => {
    rules = await loadLegalRedirects();
  });

  function findRule(source: string): RedirectRule | undefined {
    return rules.find((r) => r.source === source && !r.has);
  }

  it.each(LOCALES.filter((l) => l.enabled).map((l) => l.code))(
    '/%s/privacy -> /%s/legal/privacy (same locale preserved), permanent',
    (code) => {
      const rule = findRule(`/${code}/privacy`);
      expect(rule).toBeDefined();
      expect(rule!.destination).toBe(`/${code}/legal/privacy`);
      expect(rule!.permanent).toBe(true); // 308, not a temporary 307
    },
  );

  it.each(LOCALES.filter((l) => l.enabled).map((l) => l.code))(
    '/%s/tos -> /%s/legal/terms (same locale preserved), permanent',
    (code) => {
      const rule = findRule(`/${code}/tos`);
      expect(rule).toBeDefined();
      expect(rule!.destination).toBe(`/${code}/legal/terms`);
      expect(rule!.permanent).toBe(true);
    },
  );

  it.each(LOCALES.filter((l) => !l.enabled).map((l) => l.code))(
    'disabled locale /%s/privacy -> /ru/legal/privacy directly (single hop, no chain through middleware)',
    (code) => {
      expect(DEFAULT_LOCALE).toBe('ru'); // sanity — this test's expectation depends on it
      const rule = findRule(`/${code}/privacy`);
      expect(rule).toBeDefined();
      expect(rule!.destination).toBe('/ru/legal/privacy');
      expect(rule!.permanent).toBe(true);
    },
  );

  it.each(LOCALES.filter((l) => !l.enabled).map((l) => l.code))(
    'disabled locale /%s/tos -> /ru/legal/terms directly (single hop, no chain through middleware)',
    (code) => {
      const rule = findRule(`/${code}/tos`);
      expect(rule).toBeDefined();
      expect(rule!.destination).toBe('/ru/legal/terms');
      expect(rule!.permanent).toBe(true);
    },
  );

  it('generates exactly 2 locale-prefixed rules per locale (privacy + tos), no more, no less', () => {
    const legalAliasRules = rules.filter((r) => /^\/[a-z]{2}\/(privacy|tos)$/.test(r.source) && !r.has);
    expect(legalAliasRules).toHaveLength(LOCALES.length * 2);
  });

  it('no rule redirects an enabled locale to a different locale (no accidental fallback to ru)', () => {
    for (const { code } of LOCALES.filter((l) => l.enabled)) {
      const privacyRule = findRule(`/${code}/privacy`);
      const tosRule = findRule(`/${code}/tos`);
      expect(privacyRule!.destination.startsWith(`/${code}/`)).toBe(true);
      expect(tosRule!.destination.startsWith(`/${code}/`)).toBe(true);
    }
  });
});

/**
 * Regression guard for the final residual SEO audit (P2 finding #4): the enumerated
 * rules above only match locale-prefixed sources. A bare unprefixed /privacy or /tos
 * request fell through to next-intl middleware's own locale-detection redirect (307,
 * adds /ru) before ever reaching a 308 rule — a two-hop chain instead of the documented
 * single hop. These two dedicated rules match the bare path directly.
 */
describe('next.config redirects — bare /privacy and /tos (no locale prefix)', () => {
  let rules: RedirectRule[];

  beforeAll(async () => {
    rules = await loadLegalRedirects();
  });

  function findRule(source: string): RedirectRule | undefined {
    return rules.find((r) => r.source === source && !r.has);
  }

  it('/privacy -> /ru/legal/privacy, permanent', () => {
    const rule = findRule('/privacy');
    expect(rule).toBeDefined();
    expect(rule!.destination).toBe(`/${DEFAULT_LOCALE}/legal/privacy`);
    expect(rule!.permanent).toBe(true);
  });

  it('/tos -> /ru/legal/terms, permanent', () => {
    const rule = findRule('/tos');
    expect(rule).toBeDefined();
    expect(rule!.destination).toBe(`/${DEFAULT_LOCALE}/legal/terms`);
    expect(rule!.permanent).toBe(true);
  });

  it('exists as exactly one rule each — no duplicate bare-path rules', () => {
    expect(rules.filter((r) => r.source === '/privacy' && !r.has)).toHaveLength(1);
    expect(rules.filter((r) => r.source === '/tos' && !r.has)).toHaveLength(1);
  });

  it('does not disturb the locale-prefixed rules (still exactly 2 rules per locale, plus these 2 bare ones)', () => {
    const allAliasRules = rules.filter((r) => /\/(privacy|tos)$/.test(r.source) && !r.has);
    expect(allAliasRules).toHaveLength(LOCALES.length * 2 + 2);
  });
});
