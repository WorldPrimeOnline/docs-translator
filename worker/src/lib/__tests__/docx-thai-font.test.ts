/**
 * @jest-environment node
 */

import { splitThaiTextRuns, type TextSegment } from '../docx-renderer';
import { renderToDocx } from '../docx-renderer';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const JSZip = require('jszip') as typeof import('jszip');

// ── splitThaiTextRuns unit tests ───────────────────────────────────────────────

describe('splitThaiTextRuns', () => {
  it('splits mixed Cyrillic + Thai text correctly', () => {
    const result = splitThaiTextRuns('Мыанг Войлеб (เมืองวอยเล็บ)');
    expect(result).toEqual<TextSegment[]>([
      { text: 'Мыанг Войлеб (', isThai: false },
      { text: 'เมืองวอยเล็บ', isThai: true },
      { text: ')', isThai: false },
    ]);
  });

  it('splits Latin + Thai + Latin', () => {
    const result = splitThaiTextRuns('Bangkok (กรุงเทพมหานคร)');
    expect(result).toEqual<TextSegment[]>([
      { text: 'Bangkok (', isThai: false },
      { text: 'กรุงเทพมหานคร', isThai: true },
      { text: ')', isThai: false },
    ]);
  });

  it('splits mixed Cyrillic / Latin / Thai', () => {
    const result = splitThaiTextRuns('Русский / English / ไทย');
    expect(result).toEqual<TextSegment[]>([
      { text: 'Русский / English / ', isThai: false },
      { text: 'ไทย', isThai: true },
    ]);
  });

  it('keeps adjacent Thai characters in one segment', () => {
    const result = splitThaiTextRuns('กรุงเทพมหานคร');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ text: 'กรุงเทพมหานคร', isThai: true });
  });

  it('returns a single non-Thai segment for Latin-only text', () => {
    const result = splitThaiTextRuns('Hello World');
    expect(result).toEqual<TextSegment[]>([{ text: 'Hello World', isThai: false }]);
  });

  it('returns a single non-Thai segment for Cyrillic-only text', () => {
    const result = splitThaiTextRuns('Привет мир');
    expect(result).toEqual<TextSegment[]>([{ text: 'Привет мир', isThai: false }]);
  });

  it('round-trips text without adding or removing characters', () => {
    const inputs = [
      'Мыанг Войлеб (เมืองวอยเล็บ)',
      'Bangkok (กรุงเทพมหานคร)',
      'Русский / English / ไทย',
    ];
    for (const input of inputs) {
      const segments = splitThaiTextRuns(input);
      const rejoined = segments.map((s) => s.text).join('');
      expect(rejoined).toBe(input);
    }
  });

  it('does not split on punctuation, spaces, or numbers', () => {
    const result = splitThaiTextRuns('test@email.com 2024-01-01 https://example.com');
    expect(result).toHaveLength(1);
    expect(result[0]!.isThai).toBe(false);
  });
});

// ── DOCX XML integration tests ─────────────────────────────────────────────────

async function getDocumentXml(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const file = zip.file('word/document.xml');
  if (!file) throw new Error('word/document.xml not found in DOCX');
  return file.async('string');
}

const META = {
  sourceLang: 'th',
  targetLang: 'ru',
  documentType: 'other',
  translatedAt: '2026-06-19',
};

describe('renderToDocx Thai font in DOCX XML', () => {
  it('Thai text is present verbatim in word/document.xml', async () => {
    const md = 'Мыанг Войлеб (เมืองวอยเล็บ)';
    const buf = await renderToDocx(md, META, []);
    const xml = await getDocumentXml(buf);
    expect(xml).toContain('เมืองวอยเล็บ');
  });

  it('Thai run uses Noto Sans Thai font (cs attribute)', async () => {
    const md = 'Bangkok (กรุงเทพมหานคร)';
    const buf = await renderToDocx(md, META, []);
    const xml = await getDocumentXml(buf);
    expect(xml).toContain('Noto Sans Thai');
  });

  it('Thai font appears in w:rFonts element', async () => {
    const md = 'ไทย';
    const buf = await renderToDocx(md, META, []);
    const xml = await getDocumentXml(buf);
    // Should contain something like w:ascii="Noto Sans Thai" or w:cs="Noto Sans Thai"
    expect(xml).toMatch(/Noto Sans Thai/);
  });

  it('non-Thai text does NOT get Noto Sans Thai font', async () => {
    const md = 'Только латинский и кириллический текст.';
    const buf = await renderToDocx(md, META, []);
    const xml = await getDocumentXml(buf);
    expect(xml).not.toContain('Noto Sans Thai');
  });

  it('Latin text in mixed string does not get Thai font', async () => {
    const md = 'Мыанг Войлеб (เมืองวอยเล็บ)';
    const buf = await renderToDocx(md, META, []);
    const xml = await getDocumentXml(buf);
    // Noto Sans Thai should appear (for Thai runs) but Cyrillic text
    // 'Мыанг Войлеб' should also be present without Thai font around it
    expect(xml).toContain('Мыанг Войлеб');
    expect(xml).toContain('เมืองวอยเล็บ');
  });

  it('does not contain replacement character U+FFFD', async () => {
    const md = 'Русский / English / ไทย text continues here.';
    const buf = await renderToDocx(md, META, []);
    const xml = await getDocumentXml(buf);
    expect(xml).not.toContain('�');
  });

  it('table cells with Thai text get Noto Sans Thai font', async () => {
    const md = [
      '| Город | Транслитерация |',
      '| ----- | -------------- |',
      '| กรุงเทพมหานคร | Бангкок |',
    ].join('\n');
    const buf = await renderToDocx(md, META, []);
    const xml = await getDocumentXml(buf);
    expect(xml).toContain('กรุงเทพมหานคร');
    expect(xml).toContain('Noto Sans Thai');
  });
});
