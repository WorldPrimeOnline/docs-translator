import { normalizeSourceTextForPricing } from '../normalize';

describe('normalizeSourceTextForPricing', () => {
  it('leaves plain prose essentially unchanged (character count matches)', () => {
    const text = 'Это обычный документ с русским текстом. It also has English sentences.';
    const { normalizedText, characterCount } = normalizeSourceTextForPricing(text);
    expect(normalizedText).toContain('обычный документ');
    expect(characterCount).toBe(Array.from(normalizedText).length);
    expect(characterCount).toBeGreaterThan(0);
  });

  it('strips markdown table syntax but keeps cell content', () => {
    const markdown = '| Имя | Возраст |\n| --- | --- |\n| Иван | 30 |';
    const { normalizedText } = normalizeSourceTextForPricing(markdown);
    expect(normalizedText).not.toContain('|');
    expect(normalizedText).not.toContain('---');
    expect(normalizedText).toContain('Иван');
    expect(normalizedText).toContain('30');
  });

  it('strips heading markers but keeps the heading text', () => {
    const { normalizedText } = normalizeSourceTextForPricing('# Заголовок документа\n\nТекст.');
    expect(normalizedText).not.toContain('#');
    expect(normalizedText).toContain('Заголовок документа');
  });

  it('strips a standalone page-separator line', () => {
    const { normalizedText } = normalizeSourceTextForPricing('Страница один.\n\n---\n\nСтраница два.');
    expect(normalizedText).not.toMatch(/-{3,}/);
    expect(normalizedText).toContain('Страница один');
    expect(normalizedText).toContain('Страница два');
  });

  it('handles a short passport-style document (few characters)', () => {
    const { characterCount } = normalizeSourceTextForPricing('Иванов Иван Иванович');
    expect(characterCount).toBe(20);
  });

  it('handles a multi-page-style document (many characters, whitespace collapsed)', () => {
    const bigText = Array.from({ length: 50 }, () => 'Абзац текста документа.').join('\n\n\n   ');
    const { normalizedText, characterCount } = normalizeSourceTextForPricing(bigText);
    expect(normalizedText).not.toMatch(/\s{2,}/);
    expect(characterCount).toBeGreaterThan(500);
  });

  it('handles a mixed PDF-style document (some pages textful, some mostly empty)', () => {
    const mixed = 'Реальный текст страницы 1.\n\n\n\n\nСтраница 2 текст.';
    const { normalizedText } = normalizeSourceTextForPricing(mixed);
    expect(normalizedText).toBe('Реальный текст страницы 1. Страница 2 текст.');
  });

  it('correctly counts Cyrillic script', () => {
    expect(normalizeSourceTextForPricing('Привет').characterCount).toBe(6);
  });
  it('correctly counts Latin script', () => {
    expect(normalizeSourceTextForPricing('Hello').characterCount).toBe(5);
  });
  it('correctly counts Chinese script (each character is one code point)', () => {
    expect(normalizeSourceTextForPricing('你好世界').characterCount).toBe(4);
  });
  it('correctly counts Korean script', () => {
    expect(normalizeSourceTextForPricing('안녕하세요').characterCount).toBe(5);
  });
  it('correctly counts Arabic script', () => {
    expect(normalizeSourceTextForPricing('مرحبا').characterCount).toBe(5);
  });

  it('strips zero-width characters (ZWSP, ZWNJ, ZWJ, BOM) without affecting real character count', () => {
    const withZeroWidth = 'Hello' + '\u200B' + 'World' + '\u200C' + '\u200D' + '\uFEFF';
    const { normalizedText, characterCount } = normalizeSourceTextForPricing(withZeroWidth);
    expect(normalizedText).toBe('HelloWorld');
    expect(characterCount).toBe(10);
  });

  it('never counts WPO-generated content that should not appear in SOURCE analysis (defensive — this text simply passes through unchanged since it is not source-side markup)', () => {
    // Source-side analysis never sees translator/verification blocks in practice (those are
    // output artifacts) — this just confirms normal text unrelated to those markers passes
    // through normally, without special-casing breaking anything.
    const { normalizedText } = normalizeSourceTextForPricing('Обычный текст документа.');
    expect(normalizedText).toBe('Обычный текст документа.');
  });
});
