import JSZip from 'jszip';
import { renderDocxFromAst } from '@/lib/translation-ast/ast-to-docx';
import type { TranslationDocumentAst } from '@/lib/translation-ast/types';
import { resolveDocumentLanguage } from '@/lib/document-language';
import { getStaticLexicon, ENGLISH_FALLBACK_LEXICON } from '@/lib/translation-ast/lexicon';

// ── Test fixture factory ────────────────────────────────────────────────────

function makeAst(
  targetLang: string,
  overrides: Partial<TranslationDocumentAst> = {},
): TranslationDocumentAst {
  const lex = getStaticLexicon(targetLang) ?? ENGLISH_FALLBACK_LEXICON;
  return {
    schemaVersion: '1.0',
    sourceLanguage: resolveDocumentLanguage('ru'),
    targetLanguage: resolveDocumentLanguage(targetLang),
    requestedDocumentType: 'passport_id',
    detectedDocumentType: 'passport_id',
    renderingProfile: 'identity_document',
    sourcePageCount: 1,
    documentTitle: 'Test Document',
    blocks: [
      { type: 'heading', id: 'h1', level: 1, text: 'Document Title' },
      {
        type: 'key_value',
        id: 'kv1',
        fields: [
          { id: 'f1', label: 'Surname', value: 'Smith' },
          { id: 'f2', label: 'Document No.', value: 'AB123456', preserveExactly: true },
          { id: 'f3', label: 'Date of Birth', value: '1990-01-01' },
        ],
      },
      { type: 'paragraph', id: 'p1', text: 'Some translated paragraph content.' },
    ],
    visualElements: [
      { id: 've1', kind: 'stamp', markerText: lex.visualMarkers.stamp ?? '[stamp]', sourcePage: 1 },
    ],
    verificationItems: [],
    renderLexicon: lex,
    sourceWarnings: [],
    translatorNotes: [],
    ...overrides,
  };
}

async function getDocumentXml(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const file = zip.file('word/document.xml');
  if (!file) throw new Error('word/document.xml not found in DOCX');
  return file.async('string');
}

// ── Core output validation ──────────────────────────────────────────────────

describe('renderDocxFromAst — output format', () => {
  it('returns a non-empty Buffer', async () => {
    const buf = await renderDocxFromAst(makeAst('en'));
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1000);
  });

  it('starts with ZIP magic bytes (PK)', async () => {
    const buf = await renderDocxFromAst(makeAst('en'));
    expect(buf[0]).toBe(0x50); // P
    expect(buf[1]).toBe(0x4b); // K
  });

  it('contains word/document.xml', async () => {
    const buf = await renderDocxFromAst(makeAst('en'));
    const zip = await JSZip.loadAsync(buf);
    expect(zip.file('word/document.xml')).not.toBeNull();
  });
});

// ── tblGrid / tblLayout / tcW ───────────────────────────────────────────────

describe('renderDocxFromAst — table XML structure', () => {
  it('KV table has tblGrid', async () => {
    const xml = await getDocumentXml(await renderDocxFromAst(makeAst('en')));
    expect(xml).toContain('w:tblGrid');
  });

  it('KV table has tblLayout type fixed', async () => {
    const xml = await getDocumentXml(await renderDocxFromAst(makeAst('en')));
    expect(xml).toContain('w:tblLayout');
    expect(xml).toContain('fixed');
  });

  it('KV table has tcW (column widths)', async () => {
    const xml = await getDocumentXml(await renderDocxFromAst(makeAst('en')));
    expect(xml).toContain('w:tcW');
  });

  it('KV table has exactly 2 grid columns (not 4)', async () => {
    const xml = await getDocumentXml(await renderDocxFromAst(makeAst('en')));
    const gridCols = (xml.match(/w:gridCol/g) ?? []).length;
    // 2 columns for KV + 3 for visual elements table + 2 for translator = 7 total
    expect(gridCols).toBeGreaterThanOrEqual(2);
    // Verify the first tblGrid (KV table) has exactly 2 gridCol entries
    const startIdx = xml.indexOf('w:tblGrid');
    const endIdx = xml.indexOf('</w:tblGrid>', startIdx) + 12;
    const firstTblGrid = xml.substring(startIdx, endIdx);
    const kvGridCols = (firstTblGrid.match(/w:gridCol/g) ?? []).length;
    expect(kvGridCols).toBe(2);
  });

  it('data table preserves actual column count', async () => {
    const ast = makeAst('en', {
      blocks: [
        {
          type: 'table',
          id: 't1',
          title: 'Grades',
          columns: [
            { id: 'c1', header: 'Subject', semanticType: 'text' },
            { id: 'c2', header: 'Grade', semanticType: 'number' },
            { id: 'c3', header: 'Credits', semanticType: 'number' },
            { id: 'c4', header: 'Date', semanticType: 'date' },
          ],
          rows: [
            { id: 'r1', cells: { c1: 'Mathematics', c2: 'A', c3: '5', c4: '2022-06-01' } },
          ],
        },
      ],
    });
    const xml = await getDocumentXml(await renderDocxFromAst(ast));
    // The first tblGrid should have 4 columns (the data table)
    const startIdx = xml.indexOf('w:tblGrid');
    const endIdx = xml.indexOf('</w:tblGrid>', startIdx) + 12;
    const firstTblGrid = xml.substring(startIdx, endIdx);
    const cols = (firstTblGrid.match(/w:gridCol/g) ?? []).length;
    expect(cols).toBe(4);
  });
});

// ── RTL bidi properties ─────────────────────────────────────────────────────

describe('renderDocxFromAst — RTL support', () => {
  it('Arabic document contains bidi property', async () => {
    const xml = await getDocumentXml(await renderDocxFromAst(makeAst('ar')));
    // w:bidi element marks RTL paragraph
    expect(xml).toContain('bidi');
  });

  it('Hebrew document contains bidi property', async () => {
    const xml = await getDocumentXml(await renderDocxFromAst(makeAst('he')));
    expect(xml).toContain('bidi');
  });

  it('English document does NOT contain bidi paragraph property', async () => {
    const xml = await getDocumentXml(await renderDocxFromAst(makeAst('en')));
    expect(xml).not.toContain('<w:bidi/>');
  });

  it('Russian document does NOT contain bidi property', async () => {
    const xml = await getDocumentXml(await renderDocxFromAst(makeAst('ru')));
    expect(xml).not.toContain('<w:bidi/>');
  });
});

// ── No debug header / language-pair string ─────────────────────────────────

describe('renderDocxFromAst — no internal debug info', () => {
  it('does not contain → language pair string in document XML', async () => {
    const xml = await getDocumentXml(await renderDocxFromAst(makeAst('en')));
    // The old renderer put "RU → EN | passport_id | date" as the first paragraph
    expect(xml).not.toMatch(/[A-Z]{2}\s*→\s*[A-Z]{2}/);
  });

  it('does not contain internal type names (document_type, serviceLevel, fallback)', async () => {
    const xml = await getDocumentXml(await renderDocxFromAst(makeAst('en')));
    expect(xml).not.toContain('document_type');
    expect(xml).not.toContain('serviceLevel');
    expect(xml).not.toContain('fallback');
  });
});

// ── Page numbering ──────────────────────────────────────────────────────────

describe('renderDocxFromAst — page numbering', () => {
  it('contains footer with page number field', async () => {
    const buf = await renderDocxFromAst(makeAst('en'));
    const zip = await JSZip.loadAsync(buf);
    // Footer content is in word/footer*.xml (not the .rels relationship sidecar)
    const footerFiles = Object.keys(zip.files).filter(
      (f) => f.startsWith('word/footer') && !f.endsWith('.rels'),
    );
    expect(footerFiles.length).toBeGreaterThan(0);
    const footerXml = await zip.file(footerFiles[0]!)!.async('string');
    // Page number field can appear as instrText, fldChar, or PAGE keyword
    const hasPageNum =
      footerXml.includes('PAGE') || footerXml.includes('fldChar') || footerXml.includes('instrText');
    expect(hasPageNum).toBe(true);
  });
});

// ── Script-specific fonts ───────────────────────────────────────────────────

describe('renderDocxFromAst — font profiles', () => {
  it('Arabic DOCX references Arabic-capable font', async () => {
    const xml = await getDocumentXml(await renderDocxFromAst(makeAst('ar')));
    expect(xml).toContain('Arabic');
  });

  it('Chinese DOCX references CJK font', async () => {
    const xml = await getDocumentXml(await renderDocxFromAst(makeAst('zh')));
    expect(xml).toMatch(/CJK|Noto Serif CJK/);
  });

  it('Thai DOCX references Thai-capable font', async () => {
    const xml = await getDocumentXml(await renderDocxFromAst(makeAst('th')));
    expect(xml).toContain('Thai');
  });

  it('Latin/Cyrillic DOCX references Noto Serif', async () => {
    const xmlEn = await getDocumentXml(await renderDocxFromAst(makeAst('en')));
    expect(xmlEn).toContain('Noto Serif');
    const xmlRu = await getDocumentXml(await renderDocxFromAst(makeAst('ru')));
    expect(xmlRu).toContain('Noto Serif');
  });
});

// ── Translator block ────────────────────────────────────────────────────────

describe('renderDocxFromAst — translator block', () => {
  it('always contains translator block heading from lexicon', async () => {
    const lex = getStaticLexicon('en')!;
    const xml = await getDocumentXml(await renderDocxFromAst(makeAst('en')));
    expect(xml).toContain(lex.translatorBlockHeading);
  });

  it('Russian DOCX uses Russian translator heading', async () => {
    const lex = getStaticLexicon('ru')!;
    const xml = await getDocumentXml(await renderDocxFromAst(makeAst('ru')));
    // Russian heading should be present, not English
    expect(xml).toContain(lex.translatorBlockHeading);
    expect(xml).not.toContain('TRANSLATOR AND PROVIDER DETAILS');
  });

  it('Arabic DOCX uses Arabic translator heading', async () => {
    const lex = getStaticLexicon('ar')!;
    const xml = await getDocumentXml(await renderDocxFromAst(makeAst('ar')));
    expect(xml).toContain(lex.translatorBlockHeading);
  });

  it('presentation profile skips translator block', async () => {
    const ast = makeAst('en', { renderingProfile: 'presentation' });
    const lex = getStaticLexicon('en')!;
    const xml = await getDocumentXml(await renderDocxFromAst(ast));
    expect(xml).not.toContain(lex.translatorBlockHeading);
  });
});

// ── Script families ─────────────────────────────────────────────────────────

describe('renderDocxFromAst — all 5 script families generate valid DOCX', () => {
  const fixtures: Array<[string, string]> = [
    ['en', 'Latin'],
    ['ru', 'Cyrillic'],
    ['ar', 'Arabic RTL'],
    ['zh', 'Chinese CJK'],
    ['th', 'Thai'],
  ];

  it.each(fixtures)('%s (%s) produces valid ZIP buffer', async (lang) => {
    const buf = await renderDocxFromAst(makeAst(lang));
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
    expect(buf.length).toBeGreaterThan(5000);
  });
});
