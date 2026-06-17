import { getStaticLexicon, validateLexicon, mergeLexiconWithFallback, ENGLISH_FALLBACK_LEXICON } from '@/lib/translation-ast/lexicon';

describe('getStaticLexicon', () => {
  it('returns pack for en', () => expect(getStaticLexicon('en')).not.toBeNull());
  it('returns pack for ru', () => expect(getStaticLexicon('ru')).not.toBeNull());
  it('returns pack for kk', () => expect(getStaticLexicon('kk')).not.toBeNull());
  it('returns pack for zh', () => expect(getStaticLexicon('zh')).not.toBeNull());
  it('returns pack for zh-CN (normalized)', () => expect(getStaticLexicon('zh-CN')).not.toBeNull());
  it('returns pack for ar', () => expect(getStaticLexicon('ar')).not.toBeNull());
  it('returns pack for he', () => expect(getStaticLexicon('he')).not.toBeNull());
  it('returns pack for th', () => expect(getStaticLexicon('th')).not.toBeNull());
  it('returns pack for ko', () => expect(getStaticLexicon('ko')).not.toBeNull());
  it('returns pack for ja', () => expect(getStaticLexicon('ja')).not.toBeNull());
  it('returns null for unknown language', () => expect(getStaticLexicon('sw')).toBeNull());
  it('returns null for empty string', () => expect(getStaticLexicon('')).toBeNull());
});

describe('static packs — no hardcoded Russian/English strings in non-RU/EN packs', () => {
  const nonEnRuCodes = ['ar', 'he', 'th', 'ko', 'ja', 'zh', 'kk'];
  it.each(nonEnRuCodes)('%s pack does not contain English "TRANSLATION" heading', (code) => {
    const pack = getStaticLexicon(code);
    expect(pack).not.toBeNull();
    expect(pack!.translationHeading).not.toBe('TRANSLATION');
  });
  it.each(nonEnRuCodes)('%s pack does not contain Russian "ПЕРЕВОД" heading', (code) => {
    const pack = getStaticLexicon(code);
    expect(pack!.translationHeading).not.toBe('ПЕРЕВОД');
  });
});

describe('static packs — RTL packs have RTL-appropriate content', () => {
  it('Arabic pack contains Arabic characters', () => {
    const pack = getStaticLexicon('ar')!;
    expect(/[؀-ۿ]/.test(pack.translationHeading)).toBe(true);
  });
  it('Hebrew pack contains Hebrew characters', () => {
    const pack = getStaticLexicon('he')!;
    expect(/[֐-׿]/.test(pack.translationHeading)).toBe(true);
  });
});

describe('validateLexicon', () => {
  it('returns true for a valid pack', () => {
    expect(validateLexicon(getStaticLexicon('en'))).toBe(true);
  });
  it('returns false for null', () => expect(validateLexicon(null)).toBe(false));
  it('returns false for empty object', () => expect(validateLexicon({})).toBe(false));
  it('returns false for object missing required keys', () => {
    expect(validateLexicon({ translationHeading: 'X' })).toBe(false);
  });
  it('returns true when all required keys present', () => {
    const minimal = {
      translationHeading: 'T', visualElementsHeading: 'V', translatorBlockHeading: 'B',
      translatorNameLabel: 'N', translatorSignatureLabel: 'S', translationDateLabel: 'D',
      pageLabel: 'P', pageOfLabel: 'of',
      originalPageLabel: 'O', elementLabel: 'E', positionLabel: 'Pos', representationLabel: 'R',
      translatorQualificationLabel: 'Q', providerStampPlaceholder: '[stamp]',
      visualMarkers: {},
    };
    expect(validateLexicon(minimal)).toBe(true);
  });
});

describe('mergeLexiconWithFallback', () => {
  it('provided keys override fallback', () => {
    const merged = mergeLexiconWithFallback({ translationHeading: 'CUSTOM' }, ENGLISH_FALLBACK_LEXICON);
    expect(merged.translationHeading).toBe('CUSTOM');
    expect(merged.pageLabel).toBe(ENGLISH_FALLBACK_LEXICON.pageLabel);
  });
  it('visualMarkers are merged not replaced', () => {
    const merged = mergeLexiconWithFallback(
      { visualMarkers: { stamp: 'CUSTOM_STAMP' } },
      ENGLISH_FALLBACK_LEXICON,
    );
    expect(merged.visualMarkers.stamp).toBe('CUSTOM_STAMP');
    expect(merged.visualMarkers.signature).toBe(ENGLISH_FALLBACK_LEXICON.visualMarkers.signature);
  });
});
