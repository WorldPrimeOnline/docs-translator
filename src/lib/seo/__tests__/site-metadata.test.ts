import { buildHomepageMetadata, buildFallbackMetadata, buildLandingMetadata, buildLegalMetadata, SITE_URL, SITE_NAME } from '../site-metadata';
import { LOCALES } from '@/i18n/locales';
import { LEGAL_SUPPORTED_LOCALES } from '@/lib/legal';

const FORBIDDEN_PATTERNS = [
  /AI\s+Document\s+Translation/i,
  /AI[\s-]powered\s+document\s+translation/i,
  /AI\s+translator/i,
  /перевод\s+документов\s+на\s+базе\s+ИИ/i,
];

function assertNoForbiddenPositioning(value: unknown): void {
  const text = JSON.stringify(value);
  for (const pattern of FORBIDDEN_PATTERNS) {
    expect(text).not.toMatch(pattern);
  }
}

describe('buildHomepageMetadata', () => {
  it('ru — exact brand-approved title and description', () => {
    const meta = buildHomepageMetadata('ru');
    expect(meta.title).toBe('WPO Translations — перевод документов онлайн');
    expect(meta.description).toBe(
      'Перевод документов для виз, учёбы, банков, миграции и релокации. Электронный, официальный и нотариальный перевод через партнёров. Цена рассчитывается онлайн.',
    );
  });

  it('en — exact brand-approved title and description', () => {
    const meta = buildHomepageMetadata('en');
    expect(meta.title).toBe('WPO Translations — Online Document Translation');
    expect(meta.description).toBe(
      'Document translation for visas, education, banking, immigration and relocation. Electronic, official and notarized services with online pricing.',
    );
  });

  it('ru — Open Graph fields localized', () => {
    const meta = buildHomepageMetadata('ru');
    const og = meta.openGraph as Record<string, unknown>;
    expect(og.title).toBe(meta.title);
    expect(og.description).toBe(meta.description);
    expect(og.siteName).toBe(SITE_NAME);
    expect(og.url).toBe(`${SITE_URL}/ru`);
    expect(og.locale).toBe('ru_RU');
  });

  it('en — Open Graph fields localized', () => {
    const meta = buildHomepageMetadata('en');
    const og = meta.openGraph as Record<string, unknown>;
    expect(og.title).toBe(meta.title);
    expect(og.description).toBe(meta.description);
    expect(og.url).toBe(`${SITE_URL}/en`);
    expect(og.locale).toBe('en_US');
  });

  it('ru/en — Twitter card fields localized', () => {
    for (const locale of ['ru', 'en']) {
      const meta = buildHomepageMetadata(locale);
      const twitter = meta.twitter as Record<string, unknown>;
      expect(twitter.title).toBe(meta.title);
      expect(twitter.description).toBe(meta.description);
      expect(twitter.card).toBe('summary_large_image');
    }
  });

  it('canonical URL matches locale', () => {
    expect((buildHomepageMetadata('ru').alternates?.canonical)).toBe(`${SITE_URL}/ru`);
    expect((buildHomepageMetadata('en').alternates?.canonical)).toBe(`${SITE_URL}/en`);
  });

  describe('hreflang (SEO audit residual finding #3 — all 9 enabled locales, not just ru/en)', () => {
    const ENABLED_LOCALE_CODES = LOCALES.filter((l) => l.enabled).map((l) => l.code);
    const DISABLED_LOCALE_CODES = LOCALES.filter((l) => !l.enabled).map((l) => l.code);

    it('includes every enabled locale, self-referencing that locale\'s homepage', () => {
      const meta = buildHomepageMetadata('en');
      const languages = meta.alternates?.languages as Record<string, string>;
      expect(ENABLED_LOCALE_CODES.length).toBe(9); // sanity — locked expectation
      for (const code of ENABLED_LOCALE_CODES) {
        expect(languages[code]).toBe(`${SITE_URL}/${code}`);
      }
    });

    it('x-default points at the default-locale (ru) homepage', () => {
      const meta = buildHomepageMetadata('en');
      const languages = meta.alternates?.languages as Record<string, string>;
      expect(languages['x-default']).toBe(`${SITE_URL}/ru`);
    });

    it('never includes a disabled locale', () => {
      const meta = buildHomepageMetadata('ru');
      const languages = meta.alternates?.languages as Record<string, string>;
      expect(DISABLED_LOCALE_CODES.length).toBeGreaterThan(0); // sanity
      for (const code of DISABLED_LOCALE_CODES) {
        expect(languages[code]).toBeUndefined();
      }
    });

    it('exactly 10 entries — 9 enabled locales + x-default, no more no less', () => {
      const meta = buildHomepageMetadata('ru');
      const languages = meta.alternates?.languages as Record<string, string>;
      expect(Object.keys(languages)).toHaveLength(ENABLED_LOCALE_CODES.length + 1);
    });

    it('is identical regardless of which locale is requesting it (same alternates graph on every homepage)', () => {
      const ru = buildHomepageMetadata('ru').alternates?.languages;
      const de = buildHomepageMetadata('de').alternates?.languages;
      expect(ru).toEqual(de);
    });
  });

  it('unknown locale falls back to English copy, never the old AI wording', () => {
    const meta = buildHomepageMetadata('kk');
    expect(meta.title).toBe('WPO Translations — Online Document Translation');
    assertNoForbiddenPositioning(meta);
  });

  it('no forbidden AI-translator positioning anywhere in ru/en metadata', () => {
    assertNoForbiddenPositioning(buildHomepageMetadata('ru'));
    assertNoForbiddenPositioning(buildHomepageMetadata('en'));
  });
});

describe('buildLandingMetadata', () => {
  const ENABLED_LOCALE_CODES = LOCALES.filter((l) => l.enabled).map((l) => l.code);
  const DISABLED_LOCALE_CODES = LOCALES.filter((l) => !l.enabled).map((l) => l.code);

  const passportInput = {
    path: '/documents/passport-translation',
    title: 'Passport Translation — Any Language, Online — WPO Translations',
    description: 'Translate a passport or ID card online.',
  };
  const bankStatementInput = {
    path: '/documents/bank-statement-translation',
    title: 'Bank Statement Translation for Visa & Immigration — WPO Translations',
    description: 'Translate bank statements online for visa applications.',
  };

  describe('canonical', () => {
    it.each(['ru', 'en', 'kk'])('uses SITE_URL + locale + path for %s', (locale) => {
      const meta = buildLandingMetadata(locale, passportInput);
      expect(meta.alternates?.canonical).toBe(`${SITE_URL}/${locale}/documents/passport-translation`);
    });

    it('never contains vercel.app or the old domain', () => {
      const meta = buildLandingMetadata('ru', passportInput);
      const canonical = String(meta.alternates?.canonical);
      expect(canonical).not.toMatch(/vercel\.app/);
      expect(canonical).not.toContain('docs-translator');
    });

    it('has no query params', () => {
      const meta = buildLandingMetadata('ru', passportInput);
      expect(String(meta.alternates?.canonical)).not.toContain('?');
    });
  });

  describe('hreflang', () => {
    it('includes every enabled locale, self-referencing the same page path', () => {
      const meta = buildLandingMetadata('ru', passportInput);
      const languages = meta.alternates?.languages as Record<string, string>;
      for (const code of ENABLED_LOCALE_CODES) {
        expect(languages[code]).toBe(`${SITE_URL}/${code}/documents/passport-translation`);
      }
    });

    it('never includes a disabled locale', () => {
      const meta = buildLandingMetadata('ru', passportInput);
      const languages = meta.alternates?.languages as Record<string, string>;
      expect(DISABLED_LOCALE_CODES.length).toBeGreaterThan(0); // sanity
      for (const code of DISABLED_LOCALE_CODES) {
        expect(languages[code]).toBeUndefined();
      }
    });

    it('x-default points at the default-locale version of the SAME page, not the homepage or another landing page', () => {
      const meta = buildLandingMetadata('en', passportInput);
      const languages = meta.alternates?.languages as Record<string, string>;
      expect(languages['x-default']).toBe(`${SITE_URL}/ru/documents/passport-translation`);
    });

    it('excludeFromHreflang removes only the specified locale, keeps every other enabled locale', () => {
      const meta = buildLandingMetadata('ru', {
        path: '/kazakhstan/university-document-translation',
        title: 'x',
        description: 'y',
        excludeFromHreflang: ['de'],
      });
      const languages = meta.alternates?.languages as Record<string, string>;
      expect(languages.de).toBeUndefined();
      for (const code of ENABLED_LOCALE_CODES.filter((c) => c !== 'de')) {
        expect(languages[code]).toBe(`${SITE_URL}/${code}/kazakhstan/university-document-translation`);
      }
    });

    it('two different pages never share a hreflang path (no cross-linking passport with the /documents hub)', () => {
      const passport = buildLandingMetadata('ru', passportInput);
      const hub = buildLandingMetadata('ru', { path: '/documents', title: 'x', description: 'y' });
      const passportLangs = passport.alternates?.languages as Record<string, string>;
      const hubLangs = hub.alternates?.languages as Record<string, string>;
      expect(passportLangs.ru).not.toBe(hubLangs.ru);
    });
  });

  describe('noindexForLocales — per-locale content-gap noindex (e.g. de/kazakhstanUniversity)', () => {
    const universityInput = {
      path: '/kazakhstan/university-document-translation',
      title: 'Academic Document Translation for University Applications — Kazakhstan — WPO Translations',
      description: 'y',
      excludeFromHreflang: ['de'],
      noindexForLocales: ['de'],
    };

    it('sets robots index:false, follow:true for the listed locale', () => {
      const meta = buildLandingMetadata('de', universityInput);
      expect(meta.robots).toEqual({ index: false, follow: true });
    });

    it('does not set robots at all for locales not in the list (stays indexable)', () => {
      for (const locale of ['ru', 'en', 'kk', 'zh', 'uz', 'ky', 'tr', 'th']) {
        const meta = buildLandingMetadata(locale, universityInput);
        expect(meta.robots).toBeUndefined();
      }
    });

    it('canonical stays self-referencing even when noindexed — never cross-language-canonicalized to en/ru', () => {
      const meta = buildLandingMetadata('de', universityInput);
      expect(meta.alternates?.canonical).toBe(
        `${SITE_URL}/de/kazakhstan/university-document-translation`,
      );
    });

    it('a page with no noindexForLocales never sets robots for any locale', () => {
      for (const locale of ['ru', 'en', 'de']) {
        const meta = buildLandingMetadata(locale, passportInput);
        expect(meta.robots).toBeUndefined();
      }
    });
  });

  describe('page-specific metadata', () => {
    it('different pages produce different title/description (not one collapsed fallback)', () => {
      const passport = buildLandingMetadata('en', passportInput);
      const bankStatement = buildLandingMetadata('en', bankStatementInput);
      expect(passport.title).not.toBe(bankStatement.title);
      expect(passport.description).not.toBe(bankStatement.description);
    });

    it('title/description do not vary by locale (documented single-source fallback, not invented per-locale copy)', () => {
      const ru = buildLandingMetadata('ru', passportInput);
      const en = buildLandingMetadata('en', passportInput);
      const kk = buildLandingMetadata('kk', passportInput);
      expect(ru.title).toBe(passportInput.title);
      expect(en.title).toBe(passportInput.title);
      expect(kk.title).toBe(passportInput.title);
    });
  });

  describe('Open Graph / Twitter', () => {
    it('OG url is the locale-aware canonical URL, not a fixed one', () => {
      const meta = buildLandingMetadata('kk', passportInput);
      const og = meta.openGraph as Record<string, unknown>;
      expect(og.url).toBe(`${SITE_URL}/kk/documents/passport-translation`);
      expect(og.title).toBe(passportInput.title);
      expect(og.siteName).toBe(SITE_NAME);
    });

    it('Twitter card fields match title/description', () => {
      const meta = buildLandingMetadata('en', passportInput);
      const twitter = meta.twitter as Record<string, unknown>;
      expect(twitter.card).toBe('summary_large_image');
      expect(twitter.title).toBe(passportInput.title);
    });
  });

  it('does not set robots (must stay indexable — no accidental noindex)', () => {
    const meta = buildLandingMetadata('ru', passportInput);
    expect(meta.robots).toBeUndefined();
  });
});

describe('buildLegalMetadata', () => {
  const ALL_LEGAL_SLUGS = ['offer', 'privacy', 'personal-data-consent', 'refund-policy', 'disclaimer', 'terms', 'partners'];
  const UNSUPPORTED_ENABLED_LOCALES = ['de', 'tr', 'th'];
  const DISABLED_LOCALES = ['ko', 'tj', 'tk', 'mn', 'es'];

  const privacyInput = { slug: 'privacy', title: 'Privacy Policy — WPO Translations', description: 'x' };
  const termsInput = { slug: 'terms', title: 'Terms of Use — WPO Translations', description: 'y' };

  it('LEGAL_SUPPORTED_LOCALES is exactly ru en kk zh uz ky — no de/tr/th, no disabled locales', () => {
    expect([...LEGAL_SUPPORTED_LOCALES].sort()).toEqual(['en', 'kk', 'ky', 'ru', 'uz', 'zh'].sort());
    for (const code of UNSUPPORTED_ENABLED_LOCALES) expect(LEGAL_SUPPORTED_LOCALES).not.toContain(code);
    for (const code of DISABLED_LOCALES) expect(LEGAL_SUPPORTED_LOCALES).not.toContain(code);
  });

  describe('supported locale (ru, en, kk representative)', () => {
    it.each(['ru', 'en', 'kk'])('%s/legal/privacy — self-canonical, indexable (no robots field)', (locale) => {
      const meta = buildLegalMetadata(locale, privacyInput);
      expect(meta.alternates?.canonical).toBe(`${SITE_URL}/${locale}/legal/privacy`);
      expect(meta.robots).toBeUndefined();
    });

    it.each(['ru', 'en', 'kk'])('%s/legal/privacy — hreflang contains only LEGAL_SUPPORTED_LOCALES + x-default, self-reference present', (locale) => {
      const meta = buildLegalMetadata(locale, privacyInput);
      const languages = meta.alternates?.languages as Record<string, string>;
      expect(languages).toBeDefined();
      for (const code of LEGAL_SUPPORTED_LOCALES) {
        expect(languages[code]).toBe(`${SITE_URL}/${code}/legal/privacy`);
      }
      expect(languages[locale]).toBe(`${SITE_URL}/${locale}/legal/privacy`); // self-reference
      expect(languages['x-default']).toBe(`${SITE_URL}/ru/legal/privacy`);
      expect(Object.keys(languages)).toHaveLength(LEGAL_SUPPORTED_LOCALES.length + 1); // +1 for x-default
    });

    it('hreflang never includes de/tr/th or any disabled locale', () => {
      const meta = buildLegalMetadata('ru', privacyInput);
      const languages = meta.alternates?.languages as Record<string, string>;
      for (const code of [...UNSUPPORTED_ENABLED_LOCALES, ...DISABLED_LOCALES]) {
        expect(languages[code]).toBeUndefined();
      }
    });
  });

  describe('unsupported-but-enabled locale (de, tr, th) — verified 100% English fallback for every slug', () => {
    it.each(UNSUPPORTED_ENABLED_LOCALES)('%s/legal/privacy — noindex, follow', (locale) => {
      const meta = buildLegalMetadata(locale, privacyInput);
      expect(meta.robots).toEqual({ index: false, follow: true });
    });

    it.each(UNSUPPORTED_ENABLED_LOCALES)('%s/legal/privacy — self-canonical (never cross-language-canonicalized to en/ru)', (locale) => {
      const meta = buildLegalMetadata(locale, privacyInput);
      expect(meta.alternates?.canonical).toBe(`${SITE_URL}/${locale}/legal/privacy`);
    });

    it.each(UNSUPPORTED_ENABLED_LOCALES)('%s/legal/privacy — no hreflang block at all (not a real translation, participates in neither direction)', (locale) => {
      const meta = buildLegalMetadata(locale, privacyInput);
      expect(meta.alternates?.languages).toBeUndefined();
    });

    it.each(UNSUPPORTED_ENABLED_LOCALES)('%s applies to every legal slug, not just privacy', (locale) => {
      for (const slug of ALL_LEGAL_SLUGS) {
        const meta = buildLegalMetadata(locale, { slug, title: 'x', description: 'y' });
        expect(meta.robots).toEqual({ index: false, follow: true });
      }
    });
  });

  describe('same-slug integrity', () => {
    it('privacy hreflang alternates all end in /legal/privacy', () => {
      const meta = buildLegalMetadata('ru', privacyInput);
      const languages = meta.alternates?.languages as Record<string, string>;
      for (const url of Object.values(languages)) {
        expect(url.endsWith('/legal/privacy')).toBe(true);
      }
    });

    it('terms hreflang alternates all end in /legal/terms, never /legal/privacy', () => {
      const meta = buildLegalMetadata('ru', termsInput);
      const languages = meta.alternates?.languages as Record<string, string>;
      for (const url of Object.values(languages)) {
        expect(url.endsWith('/legal/terms')).toBe(true);
        expect(url.endsWith('/legal/privacy')).toBe(false);
      }
    });
  });

  it('no query params, no old/staging/vercel domain in canonical or hreflang', () => {
    const meta = buildLegalMetadata('ru', privacyInput);
    const json = JSON.stringify(meta.alternates);
    expect(json).not.toContain('?');
    expect(json).not.toMatch(/vercel\.app|docs-translator|staging/);
  });
});

describe('buildFallbackMetadata', () => {
  it('is locale-aware for ru/en and has no Open Graph (leaves fallback-to-title behavior intact)', () => {
    const ru = buildFallbackMetadata('ru');
    const en = buildFallbackMetadata('en');
    expect(ru.title).not.toBe(en.title);
    expect(ru.openGraph).toBeUndefined();
    expect(en.openGraph).toBeUndefined();
  });

  it('never falls back to the removed AI-translator wording', () => {
    assertNoForbiddenPositioning(buildFallbackMetadata('ru'));
    assertNoForbiddenPositioning(buildFallbackMetadata('en'));
    assertNoForbiddenPositioning(buildFallbackMetadata('kk'));
    assertNoForbiddenPositioning(buildFallbackMetadata('unknown-locale'));
  });
});
