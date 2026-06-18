import {
  Document,
  Footer,
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
  ShadingType,
  SimpleField,
} from 'docx';
import { ensureVisualElementsBlock, type VisualElement } from './visual-elements';
import { normalizeKvParsedTable, type LegacyTableKind } from './kv-normalizer';
import { PROVIDER_INFO } from './provider-info';

type ServiceLevel =
  | 'electronic'
  | 'official_with_translator_signature_and_provider_stamp'
  | 'notarization_through_partners';

type OutputMode =
  | 'translation_only'
  | 'translator_review_draft'
  | 'official_translation'
  | 'notarization_package';

export interface DocxMeta {
  sourceLang: string;
  targetLang: string;
  documentType: string;
  translatedAt: string;
  filename?: string;
  serviceLevel?: ServiceLevel;
  outputMode?: OutputMode;
}

// ─── Language label dictionaries (kept in sync with renderer.ts) ─────────────

const LANG_SRC: Record<string, { en: string; ru: string }> = {
  en: { en: 'English', ru: 'английского' },
  ru: { en: 'Russian', ru: 'русского' },
  zh: { en: 'Chinese', ru: 'китайского' },
  ko: { en: 'Korean', ru: 'корейского' },
  kk: { en: 'Kazakh', ru: 'казахского' },
  tj: { en: 'Tajik', ru: 'таджикского' },
  uz: { en: 'Uzbek', ru: 'узбекского' },
  tk: { en: 'Turkmen', ru: 'туркменского' },
  mn: { en: 'Mongolian', ru: 'монгольского' },
  ky: { en: 'Kyrgyz', ru: 'кыргызского' },
  es: { en: 'Spanish', ru: 'испанского' },
  th: { en: 'Thai', ru: 'тайского' },
};

const LANG_TGT: Record<string, { en: string; ru: string }> = {
  en: { en: 'English', ru: 'английский' },
  ru: { en: 'Russian', ru: 'русский' },
  zh: { en: 'Chinese', ru: 'китайский' },
  ko: { en: 'Korean', ru: 'корейский' },
  kk: { en: 'Kazakh', ru: 'казахский' },
  tj: { en: 'Tajik', ru: 'таджикский' },
  uz: { en: 'Uzbek', ru: 'узбекский' },
  tk: { en: 'Turkmen', ru: 'туркменский' },
  mn: { en: 'Mongolian', ru: 'монгольский' },
  ky: { en: 'Kyrgyz', ru: 'кыргызский' },
  es: { en: 'Spanish', ru: 'испанский' },
  th: { en: 'Thai', ru: 'тайский' },
};

// Footer page-counter labels per locale
const FOOTER_LABELS: Record<string, { prefix: string; sep: string }> = {
  en: { prefix: 'Translation page ', sep: ' of ' },
  ru: { prefix: 'Стр. перевода ', sep: ' из ' },
  kk: { prefix: 'Аударма беті ', sep: ' / ' },
  zh: { prefix: '译文第 ', sep: '页，共' },
  ko: { prefix: '번역 ', sep: '페이지 / ' },
  es: { prefix: 'Página de traducción ', sep: ' de ' },
};

function dl(targetLang: string): 'en' | 'ru' { return targetLang === 'ru' ? 'ru' : 'en'; }
function isAutoSource(lang: string): boolean { return !lang || lang === 'auto' || lang === 'auto-detect'; }

function translationHeadingText(meta: DocxMeta): string {
  const d = dl(meta.targetLang);
  const tgt = LANG_TGT[meta.targetLang]?.[d] ?? meta.targetLang.toUpperCase();
  if (isAutoSource(meta.sourceLang)) {
    return d === 'ru'
      ? `ПЕРЕВОД НА ${tgt.toUpperCase()} ЯЗЫК`
      : `TRANSLATION INTO ${tgt.toUpperCase()}`;
  }
  const src = LANG_SRC[meta.sourceLang]?.[d] ?? meta.sourceLang.toUpperCase();
  return d === 'ru'
    ? `ПЕРЕВОД С ${src.toUpperCase()} ЯЗЫКА НА ${tgt.toUpperCase()} ЯЗЫК`
    : `TRANSLATION FROM ${src.toUpperCase()} INTO ${tgt.toUpperCase()}`;
}

function certificationLabel(meta: DocxMeta): string {
  return meta.targetLang === 'ru'
    ? 'СВЕДЕНИЯ О ПЕРЕВОДЧИКЕ И ИСПОЛНИТЕЛЕ'
    : 'TRANSLATOR AND PROVIDER DETAILS';
}

function certificationRows(meta: DocxMeta): Array<[string, string]> {
  const d = dl(meta.targetLang);
  const tgt = LANG_TGT[meta.targetLang]?.[d] ?? meta.targetLang;
  const providerName = d === 'ru' ? PROVIDER_INFO.legalNameRu : PROVIDER_INFO.legalNameEn;
  const iinBin = PROVIDER_INFO.iinBin;

  if (d === 'ru') {
    const certStmt = isAutoSource(meta.sourceLang)
      ? `Подтверждаю, что данный перевод на ${tgt} язык является полным и точным.`
      : `Подтверждаю, что данный перевод с ${LANG_SRC[meta.sourceLang]?.[d] ?? meta.sourceLang} языка на ${tgt} язык является полным и точным.`;
    return [
      [certStmt, ''],
      ['Переводчик:', '______________________'],
      ['Квалификация переводчика:', '______________________'],
      ['Подпись переводчика:', '______________________'],
      ['Исполнитель:', providerName],
      ['ИИН/БИН:', iinBin],
      ['Печать Исполнителя:', '______________________'],
      ['Дата:', '______________________'],
    ];
  }
  const certStmt = isAutoSource(meta.sourceLang)
    ? `I certify that this translation into ${tgt} is complete and accurate.`
    : `I certify that this translation from ${LANG_SRC[meta.sourceLang]?.[d] ?? meta.sourceLang} into ${tgt} is complete and accurate.`;
  return [
    [certStmt, ''],
    ['Translator:', '______________________'],
    ['Translator qualification:', '______________________'],
    ['Translator signature:', '______________________'],
    ['Provider:', providerName],
    ['IIN/BIN:', iinBin],
    ["Provider's stamp:", '______________________'],
    ['Date:', '______________________'],
  ];
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function buildTranslationFooter(meta: DocxMeta): Footer {
  const labels = FOOTER_LABELS[meta.targetLang] ?? FOOTER_LABELS['en']!;
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: labels.prefix, size: 16, color: '888888' }),
          new SimpleField('PAGE'),
          new TextRun({ text: labels.sep, size: 16, color: '888888' }),
          new SimpleField('NUMPAGES'),
        ],
      }),
    ],
  });
}

// ─── Visual block heading detection ──────────────────────────────────────────

const VISUAL_BLOCK_HEADING_TEXTS = new Set([
  'Description of non-text elements in the original document',
  'Описание нетекстовых элементов оригинального документа',
  'Бастапқы құжаттың бейтекстік элементтерінің сипаттамасы',
  '原始文件中非文本元素的说明',
  '원본 문서의 비텍스트 요소 설명',
  'Descripción de elementos no textuales del documento original',
]);

// ─── Table utilities ──────────────────────────────────────────────────────────

function getColumnWidths(colCount: number): number[] {
  if (colCount === 2) return [2880, 6120]; // 32% / 68%
  return Array.from({ length: colCount }, () => Math.floor(9000 / colCount));
}

function parseInlineMarkdown(text: string, size?: number): TextRun[] {
  const runs: TextRun[] = [];
  const segRe = /(\*\*[^*]+\*\*|\*[^*]+\*|\[([^\]]{1,120})\])/g;
  let segMatch: RegExpExecArray | null;
  let pos = 0;
  segRe.lastIndex = 0;

  while ((segMatch = segRe.exec(text)) !== null) {
    if (segMatch.index > pos) {
      runs.push(new TextRun({ text: text.slice(pos, segMatch.index), size }));
    }
    const part = segMatch[0];
    if (part.startsWith('**') && part.endsWith('**')) {
      runs.push(new TextRun({ text: part.slice(2, -2), bold: true, size }));
    } else if (part.startsWith('*') && part.endsWith('*') && !part.startsWith('**')) {
      runs.push(new TextRun({ text: part.slice(1, -1), italics: true, size }));
    } else if (part.startsWith('[') && part.endsWith(']')) {
      runs.push(new TextRun({ text: part, italics: true, color: '333333', size }));
    }
    pos = segMatch.index + part.length;
  }

  if (pos < text.length) {
    runs.push(new TextRun({ text: text.slice(pos), size }));
  }

  return runs.length > 0 ? runs : [new TextRun({ text, size })];
}

interface ParsedTable {
  headers: string[];
  rows: string[][];
}

function parseMarkdownTable(lines: string[]): ParsedTable | null {
  if (lines.length < 2) return null;
  const headerLine = lines[0];
  if (!headerLine?.includes('|')) return null;
  const sepLine = lines[1];
  if (!sepLine || !/^\|?[\s\-|:]+\|?$/.test(sepLine)) return null;

  const parseRow = (line: string): string[] =>
    line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

  const headers = parseRow(headerLine);
  const rows = lines.slice(2).map(parseRow);
  return { headers, rows };
}

interface TableOpts {
  compact?: boolean;
  /**
   * When true, apply keepNext to the last ORPHAN_GUARD_ROWS data rows to prevent
   * a single row being stranded on a new page. Only safe for small KV tables.
   */
  antiOrphan?: boolean;
}

/** Maximum data rows for which anti-orphan keepNext is applied. */
const SMALL_KV_TABLE_MAX_ROWS = 16;
/** Number of trailing rows kept together to prevent orphan last row. */
const ORPHAN_GUARD_ROWS = 2;

function buildDocxTable(parsed: ParsedTable, opts: TableOpts = {}): Table {
  const colCount = parsed.headers.length;
  const colWidths = getColumnWidths(colCount);
  const isCompact = opts.compact === true;
  const fontSize = isCompact ? 16 : 20;
  const cellMargins = isCompact
    ? { top: 50, bottom: 50, left: 80, right: 80 }
    : { top: 80, bottom: 80, left: 120, right: 120 };

  const applyAntiOrphan =
    opts.antiOrphan === true &&
    parsed.rows.length >= 2 &&
    parsed.rows.length <= SMALL_KV_TABLE_MAX_ROWS;

  const orphanGuardStart = applyAntiOrphan
    ? Math.max(0, parsed.rows.length - ORPHAN_GUARD_ROWS)
    : parsed.rows.length; // effectively disabled

  const headerRow = new TableRow({
    tableHeader: true,
    children: parsed.headers.map((h, idx) =>
      new TableCell({
        children: [
          new Paragraph({
            children: [new TextRun({ text: h, bold: true, size: fontSize })],
            spacing: { before: 0, after: 0 },
            // Keep header with first data row
            keepNext: applyAntiOrphan,
          }),
        ],
        width: { size: colWidths[idx] ?? Math.floor(9000 / colCount), type: WidthType.DXA },
        margins: cellMargins,
        shading: { fill: 'F5F5F5', type: ShadingType.CLEAR },
      }),
    ),
  });

  const dataRows = parsed.rows.map((row, rowIdx) => {
    const cells = [...row];
    while (cells.length < colCount) cells.push('');
    const normalized = cells.slice(0, colCount);
    // keepNext on rows in the anti-orphan guard zone (all but the very last)
    const useKeepNext = applyAntiOrphan && rowIdx >= orphanGuardStart && rowIdx < parsed.rows.length - 1;
    return new TableRow({
      cantSplit: true,
      children: normalized.map((cell, idx) =>
        new TableCell({
          children: [
            new Paragraph({
              children: parseInlineMarkdown(cell, fontSize),
              spacing: { before: 0, after: 0 },
              keepNext: useKeepNext || undefined,
            }),
          ],
          width: { size: colWidths[idx] ?? Math.floor(9000 / colCount), type: WidthType.DXA },
          margins: cellMargins,
        }),
      ),
    });
  });

  return new Table({
    rows: [headerRow, ...dataRows],
    width: { size: 9000, type: WidthType.DXA },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' },
      left: { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' },
      right: { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' },
    },
  });
}

// ─── Certification block ──────────────────────────────────────────────────────

function buildCertificationTable(meta: DocxMeta): Table {
  const rows = certificationRows(meta);
  const docxRows = rows.map(([label, value]) => {
    const isFullWidth = !value;
    if (isFullWidth) {
      return new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            columnSpan: 2,
            children: [
              new Paragraph({
                children: [new TextRun({ text: label, italics: true, size: 20 })],
                spacing: { before: 40, after: 40 },
              }),
            ],
            width: { size: 9000, type: WidthType.DXA },
            margins: { top: 60, bottom: 60, left: 120, right: 120 },
          }),
        ],
      });
    }
    return new TableRow({
      cantSplit: true,
      children: [
        new TableCell({
          children: [
            new Paragraph({
              children: [new TextRun({ text: label, bold: true, size: 20 })],
              spacing: { before: 0, after: 0 },
            }),
          ],
          width: { size: 4000, type: WidthType.DXA },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          shading: { fill: 'F9F9F9', type: ShadingType.CLEAR },
        }),
        new TableCell({
          children: [
            new Paragraph({
              children: [new TextRun({ text: value, size: 20 })],
              spacing: { before: 0, after: 0 },
            }),
          ],
          width: { size: 5000, type: WidthType.DXA },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
        }),
      ],
    });
  });

  return new Table({
    rows: docxRows,
    width: { size: 9000, type: WidthType.DXA },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' },
      left: { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' },
      right: { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' },
    },
  });
}

// ─── Markdown → DOCX children ─────────────────────────────────────────────────

type DocxChild = Paragraph | Table;

function parseMarkdownToDocx(markdown: string): DocxChild[] {
  const lines = markdown.split('\n');
  const children: DocxChild[] = [];
  let i = 0;
  let inVisualSection = false;

  while (i < lines.length) {
    const raw = lines[i] ?? '';
    const line = raw.trimEnd();

    if (/^#{1,3}\s+/.test(line)) {
      const headingText = line.replace(/^#+\s+/, '');
      inVisualSection = VISUAL_BLOCK_HEADING_TEXTS.has(headingText);
    }

    // Markdown table
    if (line.includes('|') && i + 1 < lines.length) {
      const nextLine = lines[i + 1] ?? '';
      if (/^\|?[\s\-|:]+\|?$/.test(nextLine)) {
        const tableLines: string[] = [line];
        i++;
        while (i < lines.length && (lines[i] ?? '').includes('|')) {
          tableLines.push(lines[i] ?? '');
          i++;
        }
        const parsed = parseMarkdownTable(tableLines);
        if (parsed) {
          const tableKind: LegacyTableKind = inVisualSection ? 'visual_elements' : 'unknown';
          const finalParsed = normalizeKvParsedTable(parsed, { kind: tableKind });
          const isKvTable = finalParsed.headers.length === 2 && !inVisualSection;
          children.push(buildDocxTable(finalParsed, { compact: inVisualSection, antiOrphan: isKvTable }));
        } else {
          for (const tl of tableLines) {
            children.push(
              new Paragraph({
                children: parseInlineMarkdown(tl.replace(/^\||\|$/g, '').replace(/\|/g, ' | ')),
                spacing: { after: 60 },
              }),
            );
          }
        }
        continue;
      }
    }

    if (/^-{3,}$/.test(line.trim()) || /^\*{3,}$/.test(line.trim()) || /^_{3,}$/.test(line.trim())) {
      children.push(new Paragraph({ text: '', spacing: { before: 80, after: 80 } }));
      i++;
      continue;
    }

    if (/^#{1}\s+/.test(line)) {
      children.push(
        new Paragraph({
          text: line.replace(/^#+\s+/, ''),
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 240, after: 120 },
        }),
      );
    } else if (/^#{2}\s+/.test(line)) {
      children.push(
        new Paragraph({
          text: line.replace(/^#+\s+/, ''),
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 80 },
          keepNext: true,
        }),
      );
    } else if (/^#{3,}\s+/.test(line)) {
      children.push(
        new Paragraph({
          text: line.replace(/^#+\s+/, ''),
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 160, after: 80 },
        }),
      );
    } else if (/^[-*+]\s+/.test(line)) {
      children.push(
        new Paragraph({
          children: parseInlineMarkdown(line.replace(/^[-*+]\s+/, '')),
          bullet: { level: 0 },
          spacing: { after: 60 },
        }),
      );
    } else if (line.trim() === '') {
      children.push(new Paragraph({ text: '', spacing: { after: 60 } }));
    } else {
      const textLine = line.replace(/!\[[^\]]*\]\([^)]+\)/g, '');
      children.push(
        new Paragraph({
          children: parseInlineMarkdown(textLine),
          spacing: { after: 80 },
        }),
      );
    }
    i++;
  }

  return children;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function renderToDocx(
  translatedMarkdown: string,
  meta: DocxMeta,
  visualElements?: VisualElement[],
): Promise<Buffer> {
  const isPresentation = meta.documentType === 'presentation';
  const sl = meta.serviceLevel ?? 'electronic';
  const showCert =
    !isPresentation &&
    (sl === 'official_with_translator_signature_and_provider_stamp' ||
      sl === 'notarization_through_partners');

  const finalMarkdown = ensureVisualElementsBlock(
    translatedMarkdown,
    visualElements ?? [],
    meta.targetLang,
  );

  const bodyChildren = parseMarkdownToDocx(finalMarkdown);
  const sectionChildren: DocxChild[] = [];

  if (!isPresentation) {
    sectionChildren.push(
      new Paragraph({
        children: [
          new TextRun({
            text: translationHeadingText(meta),
            bold: true,
            size: 28,
            allCaps: true,
          }),
        ],
        alignment: AlignmentType.LEFT,
        spacing: { before: 0, after: 200 },
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 6, color: '222222', space: 4 },
        },
      }),
    );
  }

  sectionChildren.push(...bodyChildren);

  if (showCert) {
    sectionChildren.push(
      new Paragraph({
        text: '',
        spacing: { before: 240, after: 120 },
        border: {
          top: { style: BorderStyle.SINGLE, size: 6, color: '222222', space: 4 },
        },
      }),
    );
    sectionChildren.push(
      new Paragraph({
        children: [new TextRun({ text: certificationLabel(meta), bold: true, size: 24, allCaps: true })],
        spacing: { before: 0, after: 120 },
      }),
    );
    sectionChildren.push(buildCertificationTable(meta));

    if (sl === 'notarization_through_partners') {
      const note =
        meta.targetLang === 'ru'
          ? 'Нотариальное удостоверение подписи переводчика оформляется отдельно при наличии партнёрского процесса.'
          : "Notarization of the translator's signature is arranged separately where a partner process is available.";
      sectionChildren.push(
        new Paragraph({
          children: [new TextRun({ text: note, italics: true, color: '555555', size: 18 })],
          spacing: { before: 120, after: 0 },
        }),
      );
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1134, bottom: 1134, left: 1020, right: 1020 },
          },
        },
        footers: { default: buildTranslationFooter(meta) },
        children: sectionChildren,
      },
    ],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}
