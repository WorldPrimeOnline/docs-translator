import { resolveDocumentLanguage, resolveTextDirection, resolveScriptProfile } from '@/lib/document-language';

describe('resolveDocumentLanguage', () => {
  describe('BCP-47 normalization', () => {
    it('normalizes en-US → en', () => {
      expect(resolveDocumentLanguage('en-US').normalizedCode).toBe('en');
    });
    it('normalizes zh-Hans → zh-hans', () => {
      expect(resolveDocumentLanguage('zh-Hans').normalizedCode).toBe('zh-hans');
    });
    it('normalizes pt-BR → pt', () => {
      expect(resolveDocumentLanguage('pt-BR').normalizedCode).toBe('pt');
    });
    it('preserves zh-cn', () => {
      expect(resolveDocumentLanguage('zh-CN').normalizedCode).toBe('zh-cn');
    });
  });

  describe('script assignment — 9 script families', () => {
    it('assigns latin to en', () => expect(resolveDocumentLanguage('en').script).toBe('latin'));
    it('assigns latin to de', () => expect(resolveDocumentLanguage('de').script).toBe('latin'));
    it('assigns latin to it', () => expect(resolveDocumentLanguage('it').script).toBe('latin'));
    it('assigns latin to tr', () => expect(resolveDocumentLanguage('tr').script).toBe('latin'));
    it('assigns cyrillic to ru', () => expect(resolveDocumentLanguage('ru').script).toBe('cyrillic'));
    it('assigns cyrillic to kk', () => expect(resolveDocumentLanguage('kk').script).toBe('cyrillic'));
    it('assigns arabic to ar', () => expect(resolveDocumentLanguage('ar').script).toBe('arabic'));
    it('assigns arabic to fa', () => expect(resolveDocumentLanguage('fa').script).toBe('arabic'));
    it('assigns hebrew to he', () => expect(resolveDocumentLanguage('he').script).toBe('hebrew'));
    it('assigns chinese to zh', () => expect(resolveDocumentLanguage('zh').script).toBe('chinese'));
    it('assigns chinese to zh-hans', () => expect(resolveDocumentLanguage('zh-hans').script).toBe('chinese'));
    it('assigns japanese to ja', () => expect(resolveDocumentLanguage('ja').script).toBe('japanese'));
    it('assigns korean to ko', () => expect(resolveDocumentLanguage('ko').script).toBe('korean'));
    it('assigns thai to th', () => expect(resolveDocumentLanguage('th').script).toBe('thai'));
    it('assigns devanagari to hi', () => expect(resolveDocumentLanguage('hi').script).toBe('devanagari'));
  });

  describe('direction', () => {
    it('ltr for latin', () => expect(resolveDocumentLanguage('en').direction).toBe('ltr'));
    it('ltr for cyrillic', () => expect(resolveDocumentLanguage('ru').direction).toBe('ltr'));
    it('rtl for arabic', () => expect(resolveDocumentLanguage('ar').direction).toBe('rtl'));
    it('rtl for hebrew', () => expect(resolveDocumentLanguage('he').direction).toBe('rtl'));
    it('ltr for chinese', () => expect(resolveDocumentLanguage('zh').direction).toBe('ltr'));
    it('ltr for thai', () => expect(resolveDocumentLanguage('th').direction).toBe('ltr'));
  });

  describe('unknown/auto codes', () => {
    it('returns unknown script for unknown code', () => expect(resolveDocumentLanguage('xyz').script).toBe('unknown'));
    it('returns ltr for unknown code', () => expect(resolveDocumentLanguage('xyz').direction).toBe('ltr'));
    it('handles auto gracefully', () => {
      const lang = resolveDocumentLanguage('auto');
      expect(lang.script).toBe('unknown');
      expect(lang.direction).toBe('ltr');
    });
    it('never throws on empty string', () => {
      expect(() => resolveDocumentLanguage('')).not.toThrow();
    });
  });
});

describe('resolveTextDirection', () => {
  it('returns rtl for ar', () => expect(resolveTextDirection('ar')).toBe('rtl'));
  it('returns rtl for he', () => expect(resolveTextDirection('he')).toBe('rtl'));
  it('returns ltr for ru', () => expect(resolveTextDirection('ru')).toBe('ltr'));
  it('returns ltr for zh', () => expect(resolveTextDirection('zh')).toBe('ltr'));
  it('returns ltr for auto', () => expect(resolveTextDirection('auto')).toBe('ltr'));
});

describe('resolveScriptProfile', () => {
  it('returns no-word-spaces for zh (CJK)', () => {
    const p = resolveScriptProfile('zh');
    expect(p.hasWordSpaces).toBe(false);
    expect(p.estimatedCharsPerWord).toBe(2);
  });
  it('returns no-word-spaces for ja', () => expect(resolveScriptProfile('ja').hasWordSpaces).toBe(false));
  it('returns no-word-spaces for th', () => expect(resolveScriptProfile('th').hasWordSpaces).toBe(false));
  it('returns word-spaces for ar', () => expect(resolveScriptProfile('ar').hasWordSpaces).toBe(true));
  it('returns word-spaces for ru', () => expect(resolveScriptProfile('ru').hasWordSpaces).toBe(true));
  it('minQualityChars is lower for CJK', () => {
    const zh = resolveScriptProfile('zh');
    const en = resolveScriptProfile('en');
    expect(zh.minQualityChars).toBeLessThan(en.minQualityChars);
  });
});
