import { renderHtmlFromAst, astToMarkdown } from '@/lib/translation-ast/ast-renderer';
import type { TranslationDocumentAst } from '@/lib/translation-ast/types';
import { resolveDocumentLanguage } from '@/lib/document-language';
import { getStaticLexicon } from '@/lib/translation-ast/lexicon';

function makeAst(targetLang: string, blocks: TranslationDocumentAst['blocks'] = []): TranslationDocumentAst {
  return {
    schemaVersion: '1.0',
    sourceLanguage: resolveDocumentLanguage('ru'),
    targetLanguage: resolveDocumentLanguage(targetLang),
    requestedDocumentType: 'passport_id',
    detectedDocumentType: 'passport_id',
    renderingProfile: 'identity_document',
    sourcePageCount: 1,
    blocks: blocks.length ? blocks : [
      { type: 'heading', id: 'h1', level: 1, text: 'Document Title' },
      { type: 'key_value', id: 'kv1', fields: [
        { id: 'f1', label: 'Name', value: 'John Doe' },
        { id: 'f2', label: 'Number', value: 'AB123456', preserveExactly: true },
      ]},
    ],
    visualElements: [],
    verificationItems: [],
    renderLexicon: getStaticLexicon(targetLang) ?? getStaticLexicon('en')!,
    sourceWarnings: [],
    translatorNotes: [],
  };
}

describe('renderHtmlFromAst', () => {
  describe('RTL languages get dir=rtl', () => {
    it('Arabic target → dir="rtl" on html element', () => {
      const ast = makeAst('ar');
      const html = renderHtmlFromAst(ast, { translatedAt: '2026-01-01' });
      expect(html).toContain('dir="rtl"');
    });
    it('Hebrew target → dir="rtl" on html element', () => {
      const ast = makeAst('he');
      const html = renderHtmlFromAst(ast, { translatedAt: '2026-01-01' });
      expect(html).toContain('dir="rtl"');
    });
  });

  describe('LTR languages do not get dir=rtl', () => {
    it('English target → no dir="rtl"', () => {
      const ast = makeAst('en');
      const html = renderHtmlFromAst(ast, { translatedAt: '2026-01-01' });
      expect(html).not.toContain('dir="rtl"');
    });
    it('Russian target → no dir="rtl"', () => {
      const ast = makeAst('ru');
      const html = renderHtmlFromAst(ast, { translatedAt: '2026-01-01' });
      expect(html).not.toContain('dir="rtl"');
    });
    it('Chinese target → no dir="rtl"', () => {
      const ast = makeAst('zh');
      const html = renderHtmlFromAst(ast, { translatedAt: '2026-01-01' });
      expect(html).not.toContain('dir="rtl"');
    });
  });

  describe('lexicon drives all UI strings — no hardcoded RU/EN in non-RU/EN output', () => {
    it('Arabic output uses Arabic heading, not "TRANSLATION"', () => {
      const ast = makeAst('ar');
      const html = renderHtmlFromAst(ast, { translatedAt: '2026-01-01' });
      expect(html).toContain(getStaticLexicon('ar')!.translationHeading);
      expect(html).not.toContain('TRANSLATION');
      expect(html).not.toContain('ПЕРЕВОД');
    });
    it('Korean output uses Korean heading', () => {
      const ast = makeAst('ko');
      const html = renderHtmlFromAst(ast, { translatedAt: '2026-01-01' });
      expect(html).toContain(getStaticLexicon('ko')!.translationHeading);
    });
    it('Thai output uses Thai heading', () => {
      const ast = makeAst('th');
      const html = renderHtmlFromAst(ast, { translatedAt: '2026-01-01' });
      expect(html).toContain(getStaticLexicon('th')!.translationHeading);
    });
  });

  describe('block rendering', () => {
    it('renders heading block', () => {
      const ast = makeAst('en', [{ type: 'heading', id: 'h1', level: 1, text: 'My Title' }]);
      const html = renderHtmlFromAst(ast, { translatedAt: '2026-01-01' });
      expect(html).toContain('<h1');
      expect(html).toContain('My Title');
    });
    it('renders key_value fields', () => {
      const ast = makeAst('en', [
        { type: 'key_value', id: 'kv1', fields: [{ id: 'f1', label: 'Surname', value: 'SMITH' }] },
      ]);
      const html = renderHtmlFromAst(ast, { translatedAt: '2026-01-01' });
      expect(html).toContain('Surname');
      expect(html).toContain('SMITH');
    });
    it('renders table block', () => {
      const ast = makeAst('en', [{
        type: 'table', id: 't1', title: 'Grades',
        columns: [{ id: 'c1', header: 'Subject' }, { id: 'c2', header: 'Grade' }],
        rows: [{ id: 'r1', cells: { c1: 'Math', c2: 'A' } }],
      }]);
      const html = renderHtmlFromAst(ast, { translatedAt: '2026-01-01' });
      expect(html).toContain('<table');
      expect(html).toContain('Math');
      expect(html).toContain('Grades');
    });
  });

  describe('Unicode-capable fonts', () => {
    it('uses Noto font (not a Latin-only font)', () => {
      const html = renderHtmlFromAst(makeAst('zh'), { translatedAt: '2026-01-01' });
      expect(html).toMatch(/Noto/);
    });
  });
});

describe('astToMarkdown', () => {
  it('returns a non-empty string', () => {
    const md = astToMarkdown(makeAst('en'));
    expect(typeof md).toBe('string');
    expect(md.length).toBeGreaterThan(0);
  });
  it('includes heading text', () => {
    const ast = makeAst('en', [{ type: 'heading', id: 'h1', level: 1, text: 'Main Heading' }]);
    expect(astToMarkdown(ast)).toContain('Main Heading');
  });
  it('includes key_value labels and values', () => {
    const ast = makeAst('en', [
      { type: 'key_value', id: 'kv1', fields: [{ id: 'f1', label: 'Country', value: 'Germany' }] },
    ]);
    const md = astToMarkdown(ast);
    expect(md).toContain('Country');
    expect(md).toContain('Germany');
  });
});
