import { z } from 'zod';

// ─── Zod schemas for runtime validation ───────────────────────────────────────

const DocumentLanguageSchema = z.object({
  code: z.string(),
  normalizedCode: z.string(),
  displayName: z.string(),
  script: z.string(),
  direction: z.enum(['ltr', 'rtl']),
  localeForFormatting: z.string().optional(),
});

const HeadingBlockSchema = z.object({
  type: z.literal('heading'),
  id: z.string(),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  text: z.string(),
  sourcePage: z.number().optional(),
});

const ParagraphBlockSchema = z.object({
  type: z.literal('paragraph'),
  id: z.string(),
  text: z.string(),
  sourcePage: z.number().optional(),
});

const KeyValueFieldSchema = z.object({
  id: z.string(),
  label: z.string(),
  value: z.string(),
  sourcePage: z.number().optional(),
  preserveExactly: z.boolean().optional(),
  retainOriginal: z.boolean().optional(),
});

const KeyValueBlockSchema = z.object({
  type: z.literal('key_value'),
  id: z.string(),
  title: z.string().optional(),
  fields: z.array(KeyValueFieldSchema),
});

const TableColumnSchema = z.object({
  id: z.string(),
  header: z.string(),
  semanticType: z.enum(['text', 'date', 'number', 'money', 'code', 'percentage']).optional(),
  preferredWidthWeight: z.number().optional(),
  align: z.enum(['start', 'center', 'end']).optional(),
});

const TableRowSchema = z.object({
  id: z.string(),
  cells: z.record(z.string(), z.string()),
});

const TableBlockSchema = z.object({
  type: z.literal('table'),
  id: z.string(),
  title: z.string().optional(),
  columns: z.array(TableColumnSchema),
  rows: z.array(TableRowSchema),
});

// ListItem is recursive — use z.lazy
interface ListItemInput { id: string; text: string; children?: ListItemInput[] }
const ListItemSchema: z.ZodType<ListItemInput> = z.lazy(() =>
  z.object({
    id: z.string(),
    text: z.string(),
    children: z.array(ListItemSchema).optional(),
  }),
);

const ListBlockSchema = z.object({
  type: z.literal('list'),
  id: z.string(),
  ordered: z.boolean(),
  items: z.array(ListItemSchema),
  sourcePage: z.number().optional(),
});

// ClauseBlock is recursive — use z.lazy
interface ClauseBlockInput {
  type: 'clause'; id: string; number?: string; title?: string;
  paragraphs: string[]; children?: ClauseBlockInput[];
}
const ClauseBlockSchema: z.ZodType<ClauseBlockInput> = z.lazy(() =>
  z.object({
    type: z.literal('clause'),
    id: z.string(),
    number: z.string().optional(),
    title: z.string().optional(),
    paragraphs: z.array(z.string()),
    children: z.array(ClauseBlockSchema).optional(),
  }),
);

const SignatureBlockSchema = z.object({
  type: z.literal('signature'),
  id: z.string(),
  role: z.string().optional(),
  name: z.string().optional(),
  title: z.string().optional(),
  organization: z.string().optional(),
  date: z.string().optional(),
  visualMarker: z.string(),
  sourcePage: z.number().optional(),
});

const VisualMarkerBlockSchema = z.object({
  type: z.literal('visual_marker'),
  id: z.string(),
  markerText: z.string(),
  description: z.string().optional(),
  sourcePage: z.number().optional(),
});

const NoteBlockSchema = z.object({
  type: z.literal('note'),
  id: z.string(),
  text: z.string(),
  noteType: z.enum(['translator', 'check', 'illegible', 'general']).optional(),
});

const PageBreakBlockSchema = z.object({
  type: z.literal('page_break'),
  id: z.string(),
  afterSourcePage: z.number(),
});

const NonRecursiveBlockSchema = z.discriminatedUnion('type', [
  HeadingBlockSchema,
  ParagraphBlockSchema,
  KeyValueBlockSchema,
  TableBlockSchema,
  ListBlockSchema,
  SignatureBlockSchema,
  VisualMarkerBlockSchema,
  NoteBlockSchema,
  PageBreakBlockSchema,
]);

const TranslationBlockSchema = z.union([NonRecursiveBlockSchema, ClauseBlockSchema]);

const DocumentRenderLexiconSchema = z.object({
  translationHeading: z.string(),
  visualElementsHeading: z.string(),
  originalPageLabel: z.string(),
  elementLabel: z.string(),
  positionLabel: z.string(),
  representationLabel: z.string(),
  translatorBlockHeading: z.string(),
  translatorNameLabel: z.string(),
  translatorQualificationLabel: z.string(),
  translatorSignatureLabel: z.string(),
  translationDateLabel: z.string(),
  providerStampPlaceholder: z.string(),
  pageLabel: z.string(),
  pageOfLabel: z.string(),
  visualMarkers: z.record(z.string(), z.string()),
});

const TranslationVisualElementSchema = z.object({
  id: z.string(),
  kind: z.string(),
  markerText: z.string(),
  description: z.string().optional(),
  sourcePage: z.number().optional(),
  position: z.string().optional(),
});

const VerificationItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  value: z.string(),
  type: z.enum(['qr', 'barcode', 'url', 'code', 'mrz', 'other']),
});

const SourceWarningSchema = z.object({
  blockId: z.string().optional(),
  code: z.enum(['illegible', 'truncated', 'ambiguous', 'missing_translation', 'ocr_uncertain']),
  message: z.string(),
});

export const TranslationDocumentAstSchema = z.object({
  schemaVersion: z.literal('1.0'),
  sourceLanguage: DocumentLanguageSchema,
  targetLanguage: DocumentLanguageSchema,
  requestedDocumentType: z.string(),
  detectedDocumentType: z.string(),
  detectedSubtype: z.string().optional(),
  renderingProfile: z.string(),
  sourcePageCount: z.number(),
  documentTitle: z.string().optional(),
  documentSubtitle: z.string().optional(),
  blocks: z.array(TranslationBlockSchema),
  visualElements: z.array(TranslationVisualElementSchema),
  verificationItems: z.array(VerificationItemSchema),
  renderLexicon: DocumentRenderLexiconSchema,
  sourceWarnings: z.array(SourceWarningSchema),
  translatorNotes: z.array(z.string()),
});

export type ValidatedAstInput = z.infer<typeof TranslationDocumentAstSchema>;

// ─── Anthropic tool definition (JSON Schema) ──────────────────────────────────

export const TRANSLATION_AST_TOOL = {
  name: 'produce_translation_ast' as const,
  description: 'Produce a fully structured translation AST. All content must be in the target language. Use the most appropriate block types to represent the document structure faithfully. Never output text outside this tool call.',
  input_schema: {
    type: 'object' as const,
    required: [
      'schemaVersion', 'sourceLanguage', 'targetLanguage',
      'requestedDocumentType', 'detectedDocumentType', 'renderingProfile',
      'sourcePageCount', 'blocks', 'visualElements', 'verificationItems',
      'renderLexicon', 'sourceWarnings', 'translatorNotes',
    ] as string[],
    properties: {
      schemaVersion: { type: 'string', enum: ['1.0'] },
      sourceLanguage: {
        type: 'object',
        required: ['code', 'normalizedCode', 'displayName', 'script', 'direction'],
        properties: {
          code: { type: 'string' }, normalizedCode: { type: 'string' },
          displayName: { type: 'string' }, script: { type: 'string' },
          direction: { type: 'string', enum: ['ltr', 'rtl'] },
          localeForFormatting: { type: 'string' },
        },
      },
      targetLanguage: {
        type: 'object',
        required: ['code', 'normalizedCode', 'displayName', 'script', 'direction'],
        properties: {
          code: { type: 'string' }, normalizedCode: { type: 'string' },
          displayName: { type: 'string' }, script: { type: 'string' },
          direction: { type: 'string', enum: ['ltr', 'rtl'] },
          localeForFormatting: { type: 'string' },
        },
      },
      requestedDocumentType: { type: 'string' },
      detectedDocumentType: { type: 'string' },
      detectedSubtype: { type: 'string' },
      renderingProfile: { type: 'string' },
      sourcePageCount: { type: 'number' },
      documentTitle: { type: 'string' },
      documentSubtitle: { type: 'string' },
      blocks: {
        type: 'array',
        items: {
          type: 'object',
          required: ['type', 'id'],
          properties: {
            type: {
              type: 'string',
              enum: ['heading', 'paragraph', 'key_value', 'table', 'list',
                     'clause', 'signature', 'visual_marker', 'note', 'page_break'],
            },
            id: { type: 'string' },
          },
          additionalProperties: true,
        },
      },
      visualElements: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'kind', 'markerText'],
          properties: {
            id: { type: 'string' }, kind: { type: 'string' },
            markerText: { type: 'string' }, description: { type: 'string' },
            sourcePage: { type: 'number' }, position: { type: 'string' },
          },
        },
      },
      verificationItems: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'label', 'value', 'type'],
          properties: {
            id: { type: 'string' }, label: { type: 'string' },
            value: { type: 'string' },
            type: { type: 'string', enum: ['qr', 'barcode', 'url', 'code', 'mrz', 'other'] },
          },
        },
      },
      renderLexicon: {
        type: 'object',
        required: [
          'translationHeading', 'visualElementsHeading', 'originalPageLabel',
          'elementLabel', 'positionLabel', 'representationLabel',
          'translatorBlockHeading', 'translatorNameLabel', 'translatorQualificationLabel',
          'translatorSignatureLabel', 'translationDateLabel', 'providerStampPlaceholder',
          'pageLabel', 'pageOfLabel', 'visualMarkers',
        ],
        properties: {
          translationHeading: { type: 'string' },
          visualElementsHeading: { type: 'string' },
          originalPageLabel: { type: 'string' },
          elementLabel: { type: 'string' },
          positionLabel: { type: 'string' },
          representationLabel: { type: 'string' },
          translatorBlockHeading: { type: 'string' },
          translatorNameLabel: { type: 'string' },
          translatorQualificationLabel: { type: 'string' },
          translatorSignatureLabel: { type: 'string' },
          translationDateLabel: { type: 'string' },
          providerStampPlaceholder: { type: 'string' },
          pageLabel: { type: 'string' },
          pageOfLabel: { type: 'string' },
          visualMarkers: { type: 'object', additionalProperties: { type: 'string' } },
        },
      },
      sourceWarnings: {
        type: 'array',
        items: {
          type: 'object',
          required: ['code', 'message'],
          properties: {
            blockId: { type: 'string' },
            code: { type: 'string', enum: ['illegible', 'truncated', 'ambiguous', 'missing_translation', 'ocr_uncertain'] },
            message: { type: 'string' },
          },
        },
      },
      translatorNotes: { type: 'array', items: { type: 'string' } },
    },
  },
} as const;
