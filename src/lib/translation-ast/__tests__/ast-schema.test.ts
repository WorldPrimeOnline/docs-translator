import { TranslationDocumentAstSchema } from '@/lib/translation-ast/tool-schema';

const baseAst = {
  schemaVersion: '1.0',
  sourceLanguage: { code: 'ru', normalizedCode: 'ru', displayName: 'Russian', script: 'cyrillic', direction: 'ltr' },
  targetLanguage: { code: 'en', normalizedCode: 'en', displayName: 'English', script: 'latin', direction: 'ltr' },
  requestedDocumentType: 'passport_id',
  detectedDocumentType: 'passport_id',
  renderingProfile: 'identity_document',
  sourcePageCount: 1,
  blocks: [
    { type: 'heading', id: 'h1', level: 1, text: 'Passport' },
    { type: 'key_value', id: 'kv1', fields: [{ id: 'f1', label: 'Name', value: 'John Doe' }] },
  ],
  visualElements: [],
  verificationItems: [],
  renderLexicon: {
    translationHeading: 'TRANSLATION', visualElementsHeading: 'Visual Elements',
    originalPageLabel: 'Page', elementLabel: 'Element', positionLabel: 'Position', representationLabel: 'Repr',
    translatorBlockHeading: 'Translator', translatorNameLabel: 'Name', translatorQualificationLabel: 'Qualification',
    translatorSignatureLabel: 'Signature', translationDateLabel: 'Date', providerStampPlaceholder: '[stamp]',
    pageLabel: 'Page', pageOfLabel: 'of', visualMarkers: { stamp: '[stamp]' },
  },
  sourceWarnings: [],
  translatorNotes: [],
};

describe('TranslationDocumentAstSchema Zod validation', () => {
  it('parses a valid minimal AST', () => {
    expect(() => TranslationDocumentAstSchema.parse(baseAst)).not.toThrow();
  });

  it('rejects wrong schemaVersion', () => {
    expect(() => TranslationDocumentAstSchema.parse({ ...baseAst, schemaVersion: '2.0' })).toThrow();
  });

  it('rejects missing required fields', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { blocks: _blocks, ...noBlocks } = baseAst;
    expect(() => TranslationDocumentAstSchema.parse(noBlocks)).toThrow();
  });

  it('rejects invalid block type', () => {
    const bad = { ...baseAst, blocks: [{ type: 'invalid_block', id: 'x1' }] };
    expect(() => TranslationDocumentAstSchema.parse(bad)).toThrow();
  });

  it('accepts recursive clause blocks', () => {
    const withClause = {
      ...baseAst,
      blocks: [
        {
          type: 'clause', id: 'c1', number: '1', paragraphs: ['First paragraph.'],
          children: [
            { type: 'clause', id: 'c1.1', number: '1.1', paragraphs: ['Sub-clause.'] },
          ],
        },
      ],
    };
    expect(() => TranslationDocumentAstSchema.parse(withClause)).not.toThrow();
  });

  it('accepts recursive list items', () => {
    const withList = {
      ...baseAst,
      blocks: [{
        type: 'list', id: 'l1', ordered: false,
        items: [{
          id: 'i1', text: 'Parent item',
          children: [{ id: 'i1.1', text: 'Child item' }],
        }],
      }],
    };
    expect(() => TranslationDocumentAstSchema.parse(withList)).not.toThrow();
  });

  it('validates all 10 block types', () => {
    const fullBlocks = {
      ...baseAst,
      blocks: [
        { type: 'heading', id: 'b1', level: 2, text: 'Heading' },
        { type: 'paragraph', id: 'b2', text: 'Paragraph text.' },
        { type: 'key_value', id: 'b3', fields: [{ id: 'f1', label: 'L', value: 'V' }] },
        { type: 'table', id: 'b4', columns: [{ id: 'c1', header: 'Col' }], rows: [{ id: 'r1', cells: { c1: 'val' } }] },
        { type: 'list', id: 'b5', ordered: true, items: [{ id: 'i1', text: 'Item' }] },
        { type: 'clause', id: 'b6', paragraphs: ['Clause text.'] },
        { type: 'signature', id: 'b7', visualMarker: '[signature]' },
        { type: 'visual_marker', id: 'b8', markerText: '[stamp]' },
        { type: 'note', id: 'b9', text: 'Translator note.', noteType: 'translator' },
        { type: 'page_break', id: 'b10', afterSourcePage: 1 },
      ],
    };
    expect(() => TranslationDocumentAstSchema.parse(fullBlocks)).not.toThrow();
  });

  it('rejects verificationItem with invalid type', () => {
    const bad = {
      ...baseAst,
      verificationItems: [{ id: 'v1', label: 'QR', value: 'http://example.com', type: 'invalid_type' }],
    };
    expect(() => TranslationDocumentAstSchema.parse(bad)).toThrow();
  });
});
