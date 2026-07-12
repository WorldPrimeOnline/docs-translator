import { buildHomepageMetadata, buildFallbackMetadata, SITE_URL, SITE_NAME } from '../site-metadata';

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

  it('hreflang alternates include ru, en, and x-default → ru', () => {
    const meta = buildHomepageMetadata('en');
    const languages = meta.alternates?.languages as Record<string, string>;
    expect(languages.ru).toBe(`${SITE_URL}/ru`);
    expect(languages.en).toBe(`${SITE_URL}/en`);
    expect(languages['x-default']).toBe(`${SITE_URL}/ru`);
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
