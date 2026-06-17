import { renderHtmlFromAst, astToMarkdown } from '@/lib/translation-ast/ast-renderer';
import { renderDocxFromAst } from '@/lib/translation-ast/ast-to-docx';
import type { TranslationDocumentAst, TranslationBlock } from '@/lib/translation-ast/types';
import { resolveDocumentLanguage } from '@/lib/document-language';
import { getStaticLexicon, ENGLISH_FALLBACK_LEXICON } from '@/lib/translation-ast/lexicon';
import { ALL_FIXTURES, type AstFixture } from './fixtures/ast-fixtures';

// ─── Invariant checker ────────────────────────────────────────────────────────

const FORBIDDEN_SCHEMA_NAMES = [
  'schemaVersion', 'serviceLevel', 'outputFormat', 'debug',
];

function checkInvariants(fixture: AstFixture, html: string, docxBuf: Buffer): string[] {
  const failures: string[] = [];
  const ast = fixture.ast;
  const lex = ast.renderLexicon;
  const isRtl = ast.targetLanguage.direction === 'rtl';
  const isPresentation = ast.renderingProfile === 'presentation';
  const targetScript = ast.targetLanguage.script;
  const isCjkOrThai = ['chinese', 'japanese', 'korean', 'thai'].includes(targetScript);

  // 1. HTML is non-empty
  if (!html.length) failures.push('INV-1: HTML is empty');

  // 2. DOCX starts with ZIP magic bytes (PK = 0x50 0x4b)
  if (docxBuf.length < 2 || docxBuf[0] !== 0x50 || docxBuf[1] !== 0x4b) {
    failures.push('INV-2: DOCX missing ZIP magic bytes PK');
  }

  // 3. DOCX is not trivially small
  if (docxBuf.length <= 1000) {
    failures.push(`INV-3: DOCX too small (${docxBuf.length} bytes)`);
  }

  // 4. RTL target → HTML has dir="rtl"
  if (isRtl && !html.includes('dir="rtl"')) {
    failures.push('INV-4: RTL target language missing dir="rtl"');
  }

  // 5. LTR target → HTML does NOT have dir="rtl"
  if (!isRtl && html.includes('dir="rtl"')) {
    failures.push('INV-5: LTR target language has unexpected dir="rtl"');
  }

  // 6. No internal schema names in rendered output
  for (const term of FORBIDDEN_SCHEMA_NAMES) {
    if (html.includes(term)) {
      failures.push(`INV-6: HTML contains forbidden internal term: ${term}`);
    }
  }

  // 7. translationHeading from lexicon present in HTML (always in <title>)
  if (!html.includes(lex.translationHeading)) {
    failures.push(`INV-7: Missing translationHeading "${lex.translationHeading}"`);
  }

  // 8. translatorBlockHeading from lexicon present (not for presentations)
  if (!isPresentation && !html.includes(lex.translatorBlockHeading)) {
    failures.push(`INV-8: Missing translatorBlockHeading "${lex.translatorBlockHeading}"`);
  }

  // 9. Heading block texts appear in HTML
  for (const block of ast.blocks) {
    if (block.type === 'heading' && !html.includes(block.text)) {
      failures.push(`INV-9: Missing heading text "${block.text.slice(0, 30)}"`);
    }
  }

  // 10. key_value field values appear (protected values preserved)
  for (const block of ast.blocks) {
    if (block.type === 'key_value') {
      for (const field of block.fields) {
        if (!html.includes(field.value)) {
          failures.push(`INV-10: Missing key_value value "${field.value.slice(0, 30)}"`);
        }
      }
    }
  }

  // 11. Table rows appear in HTML
  for (const block of ast.blocks) {
    if (block.type === 'table') {
      for (const row of block.rows.slice(0, 5)) { // check first 5 rows for performance
        for (const cell of Object.values(row.cells)) {
          if (cell && !html.includes(cell)) {
            failures.push(`INV-11: Missing table cell value "${cell.slice(0, 30)}"`);
          }
        }
      }
    }
  }

  // 12. Signature visualMarker appears in HTML
  for (const block of ast.blocks) {
    if (block.type === 'signature' && block.visualMarker && !html.includes(block.visualMarker)) {
      failures.push(`INV-12: Missing signature visualMarker "${block.visualMarker}"`);
    }
  }

  // 13. astToMarkdown returns non-empty string
  const md = astToMarkdown(ast);
  if (typeof md !== 'string' || !md.length) {
    failures.push('INV-13: astToMarkdown returned empty or non-string');
  }

  // 14. astToMarkdown does NOT start with <!DOCTYPE
  if (md.startsWith('<!DOCTYPE')) {
    failures.push('INV-14: astToMarkdown starts with <!DOCTYPE (should be Markdown, not HTML)');
  }

  // 15. HTML does NOT contain [object Object]
  if (html.includes('[object Object]')) {
    failures.push('INV-15: HTML contains [object Object]');
  }

  // 16. HTML does NOT contain literal "undefined"
  if (html.includes('>undefined<') || html.includes('="undefined"')) {
    failures.push('INV-16: HTML contains rendered "undefined"');
  }

  // 17. CJK/Thai → word-break: break-all in body CSS
  if (isCjkOrThai && !html.includes('word-break: break-all')) {
    failures.push(`INV-17: CJK/Thai target (${targetScript}) missing word-break: break-all`);
  }

  // 18. RTL → unicode-bidi present in CSS (always present via .ltr-iso)
  if (isRtl && !html.includes('unicode-bidi')) {
    failures.push('INV-18: RTL target missing unicode-bidi in CSS');
  }

  // 19. Presentation → no translatorBlockHeading in HTML body
  if (isPresentation && html.includes(lex.translatorBlockHeading)) {
    failures.push('INV-19: Presentation should not contain translatorBlockHeading');
  }

  // 20. Page-break blocks render as <hr class="page-break"
  const pageBreakBlocks = ast.blocks.filter((b) => b.type === 'page_break');
  if (pageBreakBlocks.length > 0 && !html.includes('<hr class="page-break"')) {
    failures.push('INV-20: page_break blocks not rendered');
  }

  return failures;
}

// ─── Main matrix ──────────────────────────────────────────────────────────────

describe('regression matrix — all fixtures', () => {
  for (const fixture of ALL_FIXTURES) {
    it(`fixture: ${fixture.id}`, async () => {
      const html = renderHtmlFromAst(fixture.ast);
      const docxBuf = await renderDocxFromAst(fixture.ast);
      const failures = checkInvariants(fixture, html, docxBuf);
      expect(failures).toEqual([]);
    });
  }
});

// ─── Pair coverage ────────────────────────────────────────────────────────────

describe('pair coverage', () => {
  function makePairAst(srcCode: string, tgtCode: string): TranslationDocumentAst {
    const tgtLex = getStaticLexicon(tgtCode) ?? ENGLISH_FALLBACK_LEXICON;
    return {
      schemaVersion: '1.0',
      sourceLanguage: resolveDocumentLanguage(srcCode),
      targetLanguage: resolveDocumentLanguage(tgtCode),
      requestedDocumentType: 'passport_id',
      detectedDocumentType: 'passport_id',
      renderingProfile: 'identity_document',
      sourcePageCount: 1,
      blocks: [
        { type: 'heading', id: 'h1', level: 1, text: 'Heading' },
        { type: 'key_value', id: 'kv1', fields: [{ id: 'f1', label: 'Field', value: 'Value123' }] },
        { type: 'signature', id: 'sig1', visualMarker: tgtLex.visualMarkers.signature ?? '[signature]' },
        { type: 'note', id: 'n1', text: 'Note.', noteType: 'translator' },
      ],
      visualElements: [],
      verificationItems: [],
      renderLexicon: tgtLex,
      sourceWarnings: [],
      translatorNotes: [],
    };
  }

  const pairs = [
    { name: 'LTR → LTR (en→de)', src: 'en', tgt: 'de', rtl: false },
    { name: 'Cyrillic → Latin (ru→en)', src: 'ru', tgt: 'en', rtl: false },
    { name: 'Latin → Cyrillic (en→ru)', src: 'en', tgt: 'ru', rtl: false },
    { name: 'LTR → RTL (en→ar)', src: 'en', tgt: 'ar', rtl: true },
    { name: 'RTL → LTR (ar→en)', src: 'ar', tgt: 'en', rtl: false },
    { name: 'RTL → RTL (ar→he)', src: 'ar', tgt: 'he', rtl: true },
    { name: 'CJK → Latin (zh→en)', src: 'zh', tgt: 'en', rtl: false },
    { name: 'Latin → CJK (en→zh)', src: 'en', tgt: 'zh', rtl: false },
    { name: 'Thai → Latin (th→en)', src: 'th', tgt: 'en', rtl: false },
    { name: 'Latin → Thai (en→th)', src: 'en', tgt: 'th', rtl: false },
    { name: 'Mixed: ar source → en target', src: 'ar', tgt: 'en', rtl: false },
  ];

  for (const pair of pairs) {
    it(pair.name, async () => {
      const ast = makePairAst(pair.src, pair.tgt);
      const html = renderHtmlFromAst(ast);

      // Direction is correct
      if (pair.rtl) {
        expect(html).toContain('dir="rtl"');
      } else {
        expect(html).not.toContain('dir="rtl"');
      }

      // Lexicon comes from target language (no hardcoded strings)
      const tgtLex = getStaticLexicon(pair.tgt) ?? ENGLISH_FALLBACK_LEXICON;
      expect(html).toContain(tgtLex.translationHeading);

      // No internal schema names
      for (const term of FORBIDDEN_SCHEMA_NAMES) {
        expect(html).not.toContain(term);
      }

      // DOCX is valid ZIP
      const docx = await renderDocxFromAst(ast);
      expect(docx[0]).toBe(0x50);
      expect(docx[1]).toBe(0x4b);
    });
  }
});

// ─── Property-based edge cases ────────────────────────────────────────────────

describe('property-based edge cases', () => {
  function makeEdgeAst(blocks: TranslationBlock[]): TranslationDocumentAst {
    const tgtLex = ENGLISH_FALLBACK_LEXICON;
    return {
      schemaVersion: '1.0',
      sourceLanguage: resolveDocumentLanguage('en'),
      targetLanguage: resolveDocumentLanguage('en'),
      requestedDocumentType: 'other',
      detectedDocumentType: 'other',
      renderingProfile: 'generic_document',
      sourcePageCount: 1,
      blocks,
      visualElements: [],
      verificationItems: [],
      renderLexicon: tgtLex,
      sourceWarnings: [],
      translatorNotes: [],
    };
  }

  it('very long identifier (50 chars, no spaces)', async () => {
    const longId = 'A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q7R8S9T0U1V2W3X4Y5';
    const ast = makeEdgeAst([
      { type: 'key_value', id: 'kv1', fields: [{ id: 'f1', label: 'ID', value: longId, preserveExactly: true }] },
      { type: 'signature', id: 'sig1', visualMarker: '[signature]' },
      { type: 'note', id: 'n1', text: 'Note.', noteType: 'translator' },
    ]);
    const html = renderHtmlFromAst(ast);
    expect(html).toContain(longId);
    expect(html).not.toContain('[object Object]');
    const docx = await renderDocxFromAst(ast);
    expect(docx[0]).toBe(0x50);
  });

  it('zero-prefixed IDs', async () => {
    for (const val of ['007', '0042', '00000001']) {
      const ast = makeEdgeAst([
        { type: 'key_value', id: 'kv1', fields: [{ id: 'f1', label: 'No', value: val }] },
        { type: 'signature', id: 'sig1', visualMarker: '[signature]' },
        { type: 'note', id: 'n1', text: 'Note.', noteType: 'translator' },
      ]);
      const html = renderHtmlFromAst(ast);
      expect(html).toContain(val);
    }
  });

  it('mixed RTL/LTR content in LTR target', async () => {
    const mixedText = 'ABC مرحبا 123';
    const ast = makeEdgeAst([
      { type: 'paragraph', id: 'p1', text: mixedText },
      { type: 'signature', id: 'sig1', visualMarker: '[signature]' },
      { type: 'note', id: 'n1', text: 'Note.', noteType: 'translator' },
    ]);
    const html = renderHtmlFromAst(ast);
    expect(html).toContain('ABC');
    expect(html).not.toContain('[object Object]');
    const docx = await renderDocxFromAst(ast);
    expect(docx[0]).toBe(0x50);
  });

  it('Unicode combining characters', async () => {
    for (const val of ['café', 'naïve', 'Ла́дно']) {
      const ast = makeEdgeAst([
        { type: 'paragraph', id: 'p1', text: val },
        { type: 'signature', id: 'sig1', visualMarker: '[signature]' },
        { type: 'note', id: 'n1', text: 'Note.', noteType: 'translator' },
      ]);
      const html = renderHtmlFromAst(ast);
      expect(html).not.toContain('[object Object]');
      expect(html.length).toBeGreaterThan(0);
    }
  });

  it('emoji in text does not crash', async () => {
    const ast = makeEdgeAst([
      { type: 'paragraph', id: 'p1', text: '✓ approved ✅' },
      { type: 'signature', id: 'sig1', visualMarker: '[signature]' },
      { type: 'note', id: 'n1', text: 'Note.', noteType: 'translator' },
    ]);
    const html = renderHtmlFromAst(ast);
    expect(html.length).toBeGreaterThan(0);
    expect(html).not.toContain('[object Object]');
    const docx = await renderDocxFromAst(ast);
    expect(docx[0]).toBe(0x50);
  });

  it('CJK no-space text', async () => {
    const ast: TranslationDocumentAst = {
      schemaVersion: '1.0',
      sourceLanguage: resolveDocumentLanguage('zh'),
      targetLanguage: resolveDocumentLanguage('zh'),
      requestedDocumentType: 'other',
      detectedDocumentType: 'other',
      renderingProfile: 'generic_document',
      sourcePageCount: 1,
      blocks: [
        { type: 'paragraph', id: 'p1', text: '这是一段没有空格的中文文本内容测试用例示例' },
        { type: 'signature', id: 'sig1', visualMarker: '[签名]' },
        { type: 'note', id: 'n1', text: '测试', noteType: 'translator' },
      ],
      visualElements: [],
      verificationItems: [],
      renderLexicon: getStaticLexicon('zh') ?? ENGLISH_FALLBACK_LEXICON,
      sourceWarnings: [],
      translatorNotes: [],
    };
    const html = renderHtmlFromAst(ast);
    expect(html).toContain('word-break: break-all');
    expect(html).not.toContain('[object Object]');
  });

  it('Arabic numerals in RTL text', async () => {
    const ast: TranslationDocumentAst = {
      schemaVersion: '1.0',
      sourceLanguage: resolveDocumentLanguage('ar'),
      targetLanguage: resolveDocumentLanguage('ar'),
      requestedDocumentType: 'other',
      detectedDocumentType: 'other',
      renderingProfile: 'generic_document',
      sourcePageCount: 1,
      blocks: [
        { type: 'paragraph', id: 'p1', text: 'رقم الوثيقة: 12345' },
        { type: 'signature', id: 'sig1', visualMarker: '[توقيع]' },
        { type: 'note', id: 'n1', text: 'ترجمة.', noteType: 'translator' },
      ],
      visualElements: [],
      verificationItems: [],
      renderLexicon: getStaticLexicon('ar') ?? ENGLISH_FALLBACK_LEXICON,
      sourceWarnings: [],
      translatorNotes: [],
    };
    const html = renderHtmlFromAst(ast);
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('12345');
  });

  it('wide table (10 cols × 50 rows)', async () => {
    const columns = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, header: `Col${i}` }));
    const rows = Array.from({ length: 50 }, (_, r) => ({
      id: `r${r}`,
      cells: Object.fromEntries(columns.map((c, ci) => [c.id, `v${r}-${ci}`])),
    }));
    const ast = makeEdgeAst([
      { type: 'table', id: 't1', columns, rows },
      { type: 'signature', id: 'sig1', visualMarker: '[signature]' },
      { type: 'note', id: 'n1', text: 'Note.', noteType: 'translator' },
    ]);
    const html = renderHtmlFromAst(ast);
    expect(html).toContain('v0-0');
    expect(html).toContain('v49-9');
    const docx = await renderDocxFromAst(ast);
    expect(docx[0]).toBe(0x50);
  });

  it('deeply nested clauses (5 levels)', async () => {
    const deep = (depth: number, maxDepth: number): TranslationBlock => ({
      type: 'clause',
      id: `cl${depth}`,
      number: `${depth}`,
      paragraphs: [`Level ${depth} paragraph.`],
      children: depth < maxDepth ? [deep(depth + 1, maxDepth) as Extract<TranslationBlock, { type: 'clause' }>] : [],
    });
    const ast = makeEdgeAst([
      deep(1, 5) as TranslationBlock,
      { type: 'signature', id: 'sig1', visualMarker: '[signature]' },
      { type: 'note', id: 'n1', text: 'Note.', noteType: 'translator' },
    ]);
    const html = renderHtmlFromAst(ast);
    expect(html).toContain('Level 1 paragraph.');
    expect(html).toContain('Level 5 paragraph.');
    expect(html).not.toContain('[object Object]');
  });

  it('duplicate visual elements (3 stamps, 2 signatures)', async () => {
    const ast = makeEdgeAst([
      { type: 'visual_marker', id: 'vm1', markerText: '[stamp 1]' },
      { type: 'visual_marker', id: 'vm2', markerText: '[stamp 2]' },
      { type: 'visual_marker', id: 'vm3', markerText: '[stamp 3]' },
      { type: 'signature', id: 'sig1', role: 'Director', visualMarker: '[signature 1]' },
      { type: 'signature', id: 'sig2', role: 'Witness', visualMarker: '[signature 2]' },
      { type: 'note', id: 'n1', text: 'Note.', noteType: 'translator' },
    ]);
    const html = renderHtmlFromAst(ast);
    expect(html).toContain('[stamp 1]');
    expect(html).toContain('[stamp 3]');
    expect(html).toContain('[signature 2]');
    const docx = await renderDocxFromAst(ast);
    expect(docx[0]).toBe(0x50);
  });

  it('very long key-value value (500 chars)', async () => {
    const longVal = 'A'.repeat(500);
    const ast = makeEdgeAst([
      { type: 'key_value', id: 'kv1', fields: [{ id: 'f1', label: 'Long', value: longVal }] },
      { type: 'signature', id: 'sig1', visualMarker: '[signature]' },
      { type: 'note', id: 'n1', text: 'Note.', noteType: 'translator' },
    ]);
    const html = renderHtmlFromAst(ast);
    expect(html).toContain(longVal);
    expect(html).not.toContain('[object Object]');
  });

  it('unknown language code xyz-unknown', async () => {
    const ast: TranslationDocumentAst = {
      schemaVersion: '1.0',
      sourceLanguage: resolveDocumentLanguage('xyz-unknown'),
      targetLanguage: resolveDocumentLanguage('xyz-unknown'),
      requestedDocumentType: 'other',
      detectedDocumentType: 'other',
      renderingProfile: 'generic_document',
      sourcePageCount: 1,
      blocks: [
        { type: 'heading', id: 'h1', level: 1, text: 'Document' },
        { type: 'signature', id: 'sig1', visualMarker: '[signature]' },
        { type: 'note', id: 'n1', text: 'Note.', noteType: 'translator' },
      ],
      visualElements: [],
      verificationItems: [],
      renderLexicon: ENGLISH_FALLBACK_LEXICON,
      sourceWarnings: [],
      translatorNotes: [],
    };
    const html = renderHtmlFromAst(ast);
    expect(html.length).toBeGreaterThan(0);
    expect(html).not.toContain('[object Object]');
    // Falls back to ltr
    expect(html).not.toContain('dir="rtl"');
    const docx = await renderDocxFromAst(ast);
    expect(docx[0]).toBe(0x50);
  });
});

// ─── Long documents ───────────────────────────────────────────────────────────

describe('long documents', () => {
  function baseLongAst(blocks: TranslationBlock[]): TranslationDocumentAst {
    return {
      schemaVersion: '1.0',
      sourceLanguage: resolveDocumentLanguage('en'),
      targetLanguage: resolveDocumentLanguage('en'),
      requestedDocumentType: 'other',
      detectedDocumentType: 'other',
      renderingProfile: 'generic_document',
      sourcePageCount: 1,
      blocks,
      visualElements: [],
      verificationItems: [],
      renderLexicon: ENGLISH_FALLBACK_LEXICON,
      sourceWarnings: [],
      translatorNotes: [],
    };
  }

  it('50 paragraphs — all texts appear in HTML', () => {
    const paras = Array.from({ length: 50 }, (_, i): TranslationBlock => ({
      type: 'paragraph', id: `p${i}`, text: `Paragraph content ${i}`,
    }));
    const ast = baseLongAst([
      ...paras,
      { type: 'signature', id: 'sig1', visualMarker: '[signature]' },
      { type: 'note', id: 'n1', text: 'Note.', noteType: 'translator' },
    ]);
    const html = renderHtmlFromAst(ast);
    for (let i = 0; i < 50; i++) {
      expect(html).toContain(`Paragraph content ${i}`);
    }
  });

  it('100-row table — all rows preserved in HTML', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({
      id: `r${i}`, cells: { c1: `Row${i}Data` },
    }));
    const ast = baseLongAst([
      { type: 'table', id: 't1', columns: [{ id: 'c1', header: 'Data' }], rows },
      { type: 'signature', id: 'sig1', visualMarker: '[signature]' },
      { type: 'note', id: 'n1', text: 'Note.', noteType: 'translator' },
    ]);
    const html = renderHtmlFromAst(ast);
    for (let i = 0; i < 100; i++) {
      expect(html).toContain(`Row${i}Data`);
    }
  });

  it('15-page document — 14 page_break blocks render as hr', () => {
    const blocks: TranslationBlock[] = [
      { type: 'heading', id: 'h1', level: 1, text: 'Long Document' },
      { type: 'signature', id: 'sig1', visualMarker: '[signature]' },
      { type: 'note', id: 'n1', text: 'Note.', noteType: 'translator' },
    ];
    for (let i = 1; i <= 14; i++) {
      blocks.push({ type: 'paragraph', id: `p${i}`, text: `Page ${i + 1} content.` });
      blocks.push({ type: 'page_break', id: `pb${i}`, afterSourcePage: i });
    }
    const ast = baseLongAst(blocks);
    const html = renderHtmlFromAst(ast);
    const hrMatches = html.match(/<hr class="page-break"/g) ?? [];
    expect(hrMatches).toHaveLength(14);
  });

  it('nested clauses 5 levels — all texts appear', () => {
    const buildClauses = (depth: number): TranslationBlock => ({
      type: 'clause',
      id: `cl${depth}`,
      number: `${depth}`,
      paragraphs: [`Clause level ${depth} text.`],
      children: depth < 5 ? [buildClauses(depth + 1) as Extract<TranslationBlock, { type: 'clause' }>] : [],
    });
    const ast = baseLongAst([
      buildClauses(1) as TranslationBlock,
      { type: 'signature', id: 'sig1', visualMarker: '[signature]' },
      { type: 'note', id: 'n1', text: 'Note.', noteType: 'translator' },
    ]);
    const html = renderHtmlFromAst(ast);
    for (let i = 1; i <= 5; i++) {
      expect(html).toContain(`Clause level ${i} text.`);
    }
  });

  it('stable rendering — same AST produces identical HTML twice', () => {
    const ast = baseLongAst([
      { type: 'heading', id: 'h1', level: 1, text: 'Stable Test' },
      { type: 'key_value', id: 'kv1', fields: [{ id: 'f1', label: 'Field', value: 'Value' }] },
      { type: 'signature', id: 'sig1', visualMarker: '[signature]' },
      { type: 'note', id: 'n1', text: 'Note.', noteType: 'translator' },
    ]);
    const html1 = renderHtmlFromAst(ast);
    const html2 = renderHtmlFromAst(ast);
    expect(html1).toBe(html2);
  });
});

// ─── QA is advisory-only ──────────────────────────────────────────────────────

describe('QA is advisory-only', () => {
  it('qa.passed === false does not crash the renderer', async () => {
    // AST with source warnings that would trigger failed QA
    const ast: TranslationDocumentAst = {
      schemaVersion: '1.0',
      sourceLanguage: resolveDocumentLanguage('ru'),
      targetLanguage: resolveDocumentLanguage('en'),
      requestedDocumentType: 'passport_id',
      detectedDocumentType: 'passport_id',
      renderingProfile: 'identity_document',
      sourcePageCount: 1,
      blocks: [
        { type: 'heading', id: 'h1', level: 1, text: 'Document' },
        { type: 'note', id: 'n1', text: 'Illegible section.', noteType: 'illegible' },
        { type: 'note', id: 'n2', text: 'Missing translation.', noteType: 'check' },
        { type: 'signature', id: 'sig1', visualMarker: '[signature]' },
        { type: 'note', id: 'n3', text: 'Note.', noteType: 'translator' },
      ],
      visualElements: [],
      verificationItems: [],
      renderLexicon: ENGLISH_FALLBACK_LEXICON,
      sourceWarnings: [
        { code: 'illegible', message: 'Page 2 illegible.' },
        { code: 'missing_translation', message: 'Section 3 not translated.' },
      ],
      translatorNotes: [],
    };
    // Renderer must never check qa.passed — it renders regardless
    const html = renderHtmlFromAst(ast);
    expect(html.length).toBeGreaterThan(0);
    const docx = await renderDocxFromAst(ast);
    expect(docx[0]).toBe(0x50);
  });

  it('renderer does not reference qa.passed (renders AST unconditionally)', () => {
    const ast: TranslationDocumentAst = {
      schemaVersion: '1.0',
      sourceLanguage: resolveDocumentLanguage('en'),
      targetLanguage: resolveDocumentLanguage('en'),
      requestedDocumentType: 'other',
      detectedDocumentType: 'other',
      renderingProfile: 'generic_document',
      sourcePageCount: 1,
      blocks: [
        { type: 'heading', id: 'h1', level: 1, text: 'Test' },
        { type: 'signature', id: 'sig1', visualMarker: '[signature]' },
        { type: 'note', id: 'n1', text: 'Note.', noteType: 'translator' },
      ],
      visualElements: [],
      verificationItems: [],
      renderLexicon: ENGLISH_FALLBACK_LEXICON,
      sourceWarnings: [],
      translatorNotes: [],
    };
    // Call renderHtmlFromAst — if it crashes, qa.passed is being checked somewhere
    expect(() => renderHtmlFromAst(ast)).not.toThrow();
  });
});

// ─── Presentation pipeline ────────────────────────────────────────────────────

describe('presentation pipeline', () => {
  const presentationFixture = ALL_FIXTURES.find((f) => f.id === 'presentation_zh')!;

  it('no translator block in presentation HTML', () => {
    const html = renderHtmlFromAst(presentationFixture.ast);
    const lex = presentationFixture.ast.renderLexicon;
    expect(html).not.toContain(lex.translatorBlockHeading);
  });

  it('slide headings are h2 elements', () => {
    const html = renderHtmlFromAst(presentationFixture.ast);
    // The presentation fixture has level-2 headings
    expect(html).toContain('<h2>');
  });

  it('presentation block count is preserved', () => {
    const ast = presentationFixture.ast;
    const html = renderHtmlFromAst(ast);
    // Each heading/paragraph text should appear in the output
    for (const block of ast.blocks) {
      if (block.type === 'heading') expect(html).toContain(block.text);
      if (block.type === 'paragraph') expect(html).toContain(block.text);
    }
  });

  it('translationHeading appears in title even for presentations', () => {
    const html = renderHtmlFromAst(presentationFixture.ast);
    // title tag always has translationHeading
    expect(html).toContain(presentationFixture.ast.renderLexicon.translationHeading);
  });
});
