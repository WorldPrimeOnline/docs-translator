import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  Packer,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType,
  PageNumber,
  Footer,
  TableLayoutType,
} from 'docx';
import type {
  TranslationDocumentAst,
  TranslationBlock,
  ClauseBlock,
  ListItem,
  DocumentRenderLexicon,
} from './types';
import { getScriptRenderProfile } from './script-render-profile';

type DocxChild = Paragraph | Table;

const TOTAL_WIDTH_DXA = 9000;
const MIN_COL_WIDTH_DXA = 800;
const BLANK = '_______________';
const MONOSPACE_FONT = 'Liberation Mono';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRun(
  text: string,
  opts: {
    bold?: boolean;
    italic?: boolean;
    isRtl?: boolean;
    font?: string;
    size?: number;
    color?: string;
    mono?: boolean;
  } = {},
): TextRun {
  return new TextRun({
    text,
    bold: opts.bold,
    italics: opts.italic,
    rightToLeft: opts.isRtl,
    font: opts.mono ? MONOSPACE_FONT : opts.font,
    size: opts.size,
    color: opts.color,
  });
}

function makePara(
  children: TextRun[],
  opts: {
    isRtl?: boolean;
    heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel];
    indent?: number;
    spacingBefore?: number;
    spacingAfter?: number;
    alignment?: (typeof AlignmentType)[keyof typeof AlignmentType];
  } = {},
): Paragraph {
  return new Paragraph({
    children,
    bidirectional: opts.isRtl,
    heading: opts.heading,
    alignment: opts.alignment ?? (opts.isRtl ? AlignmentType.RIGHT : undefined),
    indent: opts.indent != null ? { left: opts.indent } : undefined,
    spacing: {
      before: opts.spacingBefore,
      after: opts.spacingAfter ?? 80,
    },
  });
}

function tableBorders() {
  return {
    top: { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' },
    left: { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' },
    right: { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' },
    insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' },
  };
}

function colWeight(semanticType?: string): number {
  switch (semanticType) {
    case 'money':
    case 'number':
    case 'percentage':
      return 1.0;
    case 'date':
    case 'code':
      return 1.2;
    case 'text':
      return 2.0;
    default:
      return 1.5;
  }
}

function allocateColumnWidths(weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => Math.round((w / total) * TOTAL_WIDTH_DXA));
  // Enforce minimum width
  const clamped = raw.map((w) => Math.max(w, MIN_COL_WIDTH_DXA));
  // Re-scale to exactly TOTAL_WIDTH_DXA
  const clampedTotal = clamped.reduce((a, b) => a + b, 0);
  if (clampedTotal === TOTAL_WIDTH_DXA) return clamped;
  const scale = TOTAL_WIDTH_DXA / clampedTotal;
  const scaled = clamped.map((w, i) =>
    i === clamped.length - 1
      ? TOTAL_WIDTH_DXA - clamped.slice(0, -1).reduce((a, b) => a + Math.round(b * scale), 0)
      : Math.round(w * scale),
  );
  return scaled;
}

// ── List rendering ────────────────────────────────────────────────────────────

function renderListItems(items: ListItem[], ordered: boolean, depth: number, font: string, isRtl: boolean): DocxChild[] {
  const result: DocxChild[] = [];
  items.forEach((item) => {
    const prefix = ordered ? `${depth + 1}. ` : '• ';
    result.push(makePara(
      [makeRun(prefix + item.text, { font, isRtl })],
      { isRtl, indent: depth * 360, spacingAfter: 60 },
    ));
    if (item.children?.length) {
      result.push(...renderListItems(item.children, ordered, depth + 1, font, isRtl));
    }
  });
  return result;
}

// ── Clause rendering ──────────────────────────────────────────────────────────

function renderClause(clause: ClauseBlock, depth: number, font: string, isRtl: boolean): DocxChild[] {
  const result: DocxChild[] = [];
  const label = [clause.number, clause.title].filter(Boolean).join(' ');
  if (label) {
    result.push(makePara(
      [makeRun(label, { bold: true, font, isRtl })],
      { isRtl, indent: depth * 720, spacingBefore: 120, spacingAfter: 60 },
    ));
  }
  for (const para of clause.paragraphs) {
    result.push(makePara(
      [makeRun(para, { font, isRtl })],
      { isRtl, indent: depth * 720 + (label ? 360 : 0), spacingAfter: 80 },
    ));
  }
  if (clause.children?.length) {
    for (const child of clause.children) {
      result.push(...renderClause(child, depth + 1, font, isRtl));
    }
  }
  return result;
}

// ── KV Table ─────────────────────────────────────────────────────────────────

function buildKvTable(
  fields: TranslationDocumentAst['blocks'][number] extends { type: 'key_value' } ? TranslationDocumentAst['blocks'][number]['fields'] : never,
  font: string,
  isRtl: boolean,
): Table {
  const labelWidth = 3600;
  const valueWidth = 5400;

  const rows = (fields as Array<{ label: string; value: string; preserveExactly?: boolean }>).map(
    (f) =>
      new TableRow({
        children: [
          new TableCell({
            width: { size: labelWidth, type: WidthType.DXA },
            shading: { fill: 'F5F5F5' },
            children: [
              makePara([makeRun(f.label, { bold: true, font, isRtl })], { isRtl }),
            ],
          }),
          new TableCell({
            width: { size: valueWidth, type: WidthType.DXA },
            children: [
              makePara(
                [makeRun(f.value, { font: f.preserveExactly ? MONOSPACE_FONT : font, isRtl: f.preserveExactly ? false : isRtl })],
                { isRtl: f.preserveExactly ? false : isRtl },
              ),
            ],
          }),
        ],
      }),
  );

  return new Table({
    columnWidths: [labelWidth, valueWidth],
    layout: TableLayoutType.FIXED,
    width: { size: TOTAL_WIDTH_DXA, type: WidthType.DXA },
    borders: tableBorders(),
    rows,
  });
}

// ── Data Table ────────────────────────────────────────────────────────────────

function buildDataTable(
  block: Extract<TranslationDocumentAst['blocks'][number], { type: 'table' }>,
  font: string,
  isRtl: boolean,
): Table {
  const weights = block.columns.map((c) => colWeight(c.semanticType));
  const colWidths = allocateColumnWidths(weights);

  const headerRow = new TableRow({
    tableHeader: true,
    children: block.columns.map(
      (col, i) =>
        new TableCell({
          width: { size: colWidths[i] ?? MIN_COL_WIDTH_DXA, type: WidthType.DXA },
          shading: { fill: 'F5F5F5' },
          children: [makePara([makeRun(col.header, { bold: true, font, isRtl })], { isRtl })],
        }),
    ),
  });

  const dataRows = block.rows.map(
    (row) =>
      new TableRow({
        cantSplit: false,
        children: block.columns.map((col, i) => {
          const isCode = col.semanticType === 'code';
          const isNum = col.semanticType === 'money' || col.semanticType === 'number' || col.semanticType === 'percentage';
          const cellFont = isCode || isNum ? MONOSPACE_FONT : font;
          const cellRtl = isCode || isNum ? false : isRtl;
          const align = isNum ? AlignmentType.RIGHT : undefined;
          return new TableCell({
            width: { size: colWidths[i] ?? MIN_COL_WIDTH_DXA, type: WidthType.DXA },
            children: [
              makePara([makeRun(row.cells[col.id] ?? '', { font: cellFont, isRtl: cellRtl })], {
                isRtl: cellRtl,
                alignment: align,
              }),
            ],
          });
        }),
      }),
  );

  return new Table({
    columnWidths: colWidths,
    layout: TableLayoutType.FIXED,
    width: { size: TOTAL_WIDTH_DXA, type: WidthType.DXA },
    borders: tableBorders(),
    rows: [headerRow, ...dataRows],
  });
}

// ── Block dispatch ────────────────────────────────────────────────────────────

function renderBlock(block: TranslationBlock, font: string, isRtl: boolean): DocxChild[] {
  switch (block.type) {
    case 'heading': {
      const lvl = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][block.level - 1]!;
      return [makePara([makeRun(block.text, { bold: true, font, isRtl })], {
        isRtl,
        heading: lvl,
        spacingBefore: block.level === 1 ? 240 : 160,
        spacingAfter: 120,
      })];
    }

    case 'paragraph':
      return [makePara([makeRun(block.text, { font, isRtl })], { isRtl })];

    case 'key_value': {
      const result: DocxChild[] = [];
      if (block.title) {
        result.push(makePara([makeRun(block.title, { bold: true, font, isRtl })], {
          isRtl, heading: HeadingLevel.HEADING_3, spacingBefore: 120, spacingAfter: 80,
        }));
      }
      result.push(buildKvTable(block.fields as never, font, isRtl));
      result.push(makePara([], { spacingAfter: 80 }));
      return result;
    }

    case 'table': {
      const result: DocxChild[] = [];
      if (block.title) {
        result.push(makePara([makeRun(block.title, { bold: true, font, isRtl })], {
          isRtl, heading: HeadingLevel.HEADING_3, spacingBefore: 120, spacingAfter: 80,
        }));
      }
      result.push(buildDataTable(block, font, isRtl));
      result.push(makePara([], { spacingAfter: 80 }));
      return result;
    }

    case 'list':
      return renderListItems(block.items, block.ordered, 0, font, isRtl);

    case 'clause':
      return renderClause(block as ClauseBlock, 0, font, isRtl);

    case 'signature': {
      const result: DocxChild[] = [];
      result.push(makePara([makeRun(block.visualMarker, { italic: true, font, isRtl })], { isRtl }));
      if (block.role) result.push(makePara([makeRun(block.role, { bold: true, font, isRtl })], { isRtl }));
      if (block.name) result.push(makePara([makeRun(block.name, { font, isRtl })], { isRtl }));
      if (block.organization) result.push(makePara([makeRun(block.organization, { font, isRtl })], { isRtl }));
      if (block.date) result.push(makePara([makeRun(block.date, { mono: true })], { isRtl: false }));
      return result;
    }

    case 'visual_marker': {
      const isMrz = (block.markerText + ' ' + (block.description ?? '')).toLowerCase().includes('mrz')
        || (block.markerText + ' ' + (block.description ?? '')).toLowerCase().includes('machine-readable');
      return [makePara(
        [makeRun(block.markerText + (block.description ? ': ' + block.description : ''), {
          italic: !isMrz,
          mono: isMrz,
          isRtl: isMrz ? false : isRtl,
          color: '333333',
        })],
        { isRtl: isMrz ? false : isRtl },
      )];
    }

    case 'note':
      return [makePara([makeRun(block.text, { italic: true, font, color: '666666', isRtl })], { isRtl })];

    case 'page_break':
      return [new Paragraph({ pageBreakBefore: false, children: [], spacing: { after: 0 } })];

    default:
      return [];
  }
}

// ── Visual elements section ───────────────────────────────────────────────────

function buildVisualSection(ast: TranslationDocumentAst, font: string, isRtl: boolean): DocxChild[] {
  if (!ast.visualElements.length && !ast.verificationItems.length) return [];
  const lex = ast.renderLexicon;
  const result: DocxChild[] = [
    makePara([makeRun(lex.visualElementsHeading, { bold: true, font, isRtl })], {
      isRtl, heading: HeadingLevel.HEADING_2, spacingBefore: 240, spacingAfter: 120,
    }),
  ];

  if (ast.visualElements.length) {
    const hdrRow = new TableRow({
      tableHeader: true,
      children: [lex.elementLabel, lex.representationLabel, lex.originalPageLabel].map(
        (h) =>
          new TableCell({
            width: { size: 3000, type: WidthType.DXA },
            shading: { fill: 'F5F5F5' },
            children: [makePara([makeRun(h, { bold: true, font, isRtl })], { isRtl })],
          }),
      ),
    });
    const dataRows = ast.visualElements.map(
      (el) =>
        new TableRow({
          children: [
            new TableCell({ width: { size: 3000, type: WidthType.DXA }, children: [makePara([makeRun(el.markerText, { italic: true, font, isRtl })], { isRtl })] }),
            new TableCell({ width: { size: 3000, type: WidthType.DXA }, children: [makePara([makeRun(el.description ?? '', { font, isRtl })], { isRtl })] }),
            new TableCell({ width: { size: 3000, type: WidthType.DXA }, children: [makePara([makeRun(el.sourcePage != null ? String(el.sourcePage) : '', { mono: true })], { isRtl: false })] }),
          ],
        }),
    );
    result.push(new Table({ columnWidths: [3000, 3000, 3000], layout: TableLayoutType.FIXED, width: { size: 9000, type: WidthType.DXA }, borders: tableBorders(), rows: [hdrRow, ...dataRows] }));
  }

  if (ast.verificationItems.length) {
    for (const vi of ast.verificationItems) {
      result.push(makePara([
        makeRun(vi.label + ': ', { bold: true, font, isRtl }),
        makeRun(vi.value, { mono: true, isRtl: false }),
      ], { isRtl }));
    }
  }

  return result;
}

// ── Translator block ──────────────────────────────────────────────────────────

function buildTranslatorBlock(lex: DocumentRenderLexicon, font: string, isRtl: boolean): DocxChild[] {
  const fields: [string, string][] = [
    [lex.translatorNameLabel, BLANK],
    [lex.translatorQualificationLabel, BLANK],
    [lex.translatorSignatureLabel, BLANK],
    [lex.translationDateLabel, BLANK],
    [lex.providerStampPlaceholder, BLANK],
  ];

  const rows = fields.map(
    ([label, value]) =>
      new TableRow({
        children: [
          new TableCell({
            width: { size: 3600, type: WidthType.DXA },
            shading: { fill: 'F5F5F5' },
            children: [makePara([makeRun(label, { bold: true, font, isRtl })], { isRtl })],
          }),
          new TableCell({
            width: { size: 5400, type: WidthType.DXA },
            children: [makePara([makeRun(value, { font, isRtl })], { isRtl })],
          }),
        ],
      }),
  );

  return [
    makePara([makeRun(lex.translatorBlockHeading, { bold: true, font, isRtl })], {
      isRtl, heading: HeadingLevel.HEADING_2, spacingBefore: 480, spacingAfter: 160,
    }),
    new Table({
      columnWidths: [3600, 5400],
      layout: TableLayoutType.FIXED,
      width: { size: TOTAL_WIDTH_DXA, type: WidthType.DXA },
      borders: tableBorders(),
      rows,
    }),
  ];
}

// ── Footer with page numbers ──────────────────────────────────────────────────

function buildFooter(lex: DocumentRenderLexicon, font: string): Footer {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: lex.pageLabel + ' ', font }),
          new TextRun({ children: [PageNumber.CURRENT], font }),
          new TextRun({ text: ' ' + lex.pageOfLabel + ' ', font }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], font }),
        ],
      }),
    ],
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface AstDocxOptions {
  translatedAt?: string;
  filename?: string;
  serviceLevel?: string;
}

export async function renderDocxFromAst(
  ast: TranslationDocumentAst,
  _opts: AstDocxOptions = {},
): Promise<Buffer> {
  const lex = ast.renderLexicon;
  const scriptProfile = getScriptRenderProfile(ast.targetLanguage.script);
  const font = scriptProfile.fontFamily;
  const isRtl = scriptProfile.direction === 'rtl';
  const isPresentation = ast.renderingProfile === 'presentation';

  const bodyChildren: DocxChild[] = [];

  // Title paragraph
  bodyChildren.push(
    makePara([makeRun(lex.translationHeading, { bold: true, font, isRtl, size: 28 })], {
      isRtl,
      heading: HeadingLevel.HEADING_1,
      spacingBefore: 0,
      spacingAfter: 200,
    }),
  );

  if (ast.documentTitle) {
    bodyChildren.push(
      makePara([makeRun(ast.documentTitle, { font, isRtl, size: 22 })], {
        isRtl,
        spacingAfter: 200,
      }),
    );
  }

  // Content blocks
  for (const block of ast.blocks) {
    bodyChildren.push(...renderBlock(block, font, isRtl));
  }

  // Visual elements section
  bodyChildren.push(...buildVisualSection(ast, font, isRtl));

  // Translator block (not for presentations)
  if (!isPresentation) {
    bodyChildren.push(...buildTranslatorBlock(lex, font, isRtl));
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, bottom: 1800, left: 1440, right: 1440 },
          },
        },
        footers: {
          default: buildFooter(lex, font),
        },
        children: bodyChildren,
      },
    ],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}
