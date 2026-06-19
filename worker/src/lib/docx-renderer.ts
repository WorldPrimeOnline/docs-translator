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
} from 'docx';
import { ensureVisualElementsBlock, type VisualElement } from './visual-elements';

// ── Thai font support ──────────────────────────────────────────────────────────
// U+0E00–U+0E7F: Thai Unicode block
const THAI_RANGE_RE = /[฀-๿]+/g;

export type TextSegment = {
  text: string;
  isThai: boolean;
};

export function splitThaiTextRuns(text: string): TextSegment[] {
  if (!text) return [{ text: '', isThai: false }];
  const segments: TextSegment[] = [];
  let pos = 0;
  THAI_RANGE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = THAI_RANGE_RE.exec(text)) !== null) {
    if (m.index > pos) {
      segments.push({ text: text.slice(pos, m.index), isThai: false });
    }
    segments.push({ text: m[0], isThai: true });
    pos = m.index + m[0].length;
  }
  if (pos < text.length) {
    segments.push({ text: text.slice(pos), isThai: false });
  }
  return segments.length > 0 ? segments : [{ text, isThai: false }];
}

const THAI_FONT = { ascii: 'Noto Sans Thai', hAnsi: 'Noto Sans Thai', cs: 'Noto Sans Thai' } as const;

interface RunOpts {
  bold?: boolean;
  italics?: boolean;
  size?: number;
  color?: string;
}

function makeThaiAwareRuns(text: string, opts: RunOpts = {}): TextRun[] {
  const segments = splitThaiTextRuns(text);
  return segments.map(({ text: t, isThai }) =>
    new TextRun({ text: t, ...(isThai ? { font: THAI_FONT } : {}), ...opts }),
  );
}

export interface DocxMeta {
  sourceLang: string;
  targetLang: string;
  documentType: string;
  translatedAt: string;
  filename?: string;
}

function parseInlineMarkdown(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const segRe = /(\*\*[^*]+\*\*|\*[^*]+\*|\[([^\]]{1,120})\])/g;
  let segMatch: RegExpExecArray | null;
  let pos = 0;
  segRe.lastIndex = 0;

  while ((segMatch = segRe.exec(text)) !== null) {
    if (segMatch.index > pos) {
      runs.push(...makeThaiAwareRuns(text.slice(pos, segMatch.index)));
    }
    const part = segMatch[0];
    if (part.startsWith('**') && part.endsWith('**')) {
      runs.push(...makeThaiAwareRuns(part.slice(2, -2), { bold: true }));
    } else if (part.startsWith('*') && part.endsWith('*') && !part.startsWith('**')) {
      runs.push(...makeThaiAwareRuns(part.slice(1, -1), { italics: true }));
    } else if (part.startsWith('[') && part.endsWith(']')) {
      runs.push(new TextRun({ text: part, italics: true, color: '333333' }));
    }
    pos = segMatch.index + part.length;
  }

  if (pos < text.length) {
    runs.push(...makeThaiAwareRuns(text.slice(pos)));
  }

  return runs.length > 0 ? runs : makeThaiAwareRuns(text);
}

interface ParsedTable {
  headers: string[];
  rows: string[][];
}

function parseMarkdownTable(lines: string[]): ParsedTable | null {
  if (lines.length < 2) return null;
  // Header row
  const headerLine = lines[0];
  if (!headerLine?.includes('|')) return null;
  // Separator row
  const sepLine = lines[1];
  if (!sepLine || !/^\|?[\s\-|:]+\|?$/.test(sepLine)) return null;

  const parseRow = (line: string): string[] => {
    return line
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim());
  };

  const headers = parseRow(headerLine);
  const rows = lines.slice(2).map(parseRow);
  return { headers, rows };
}

function buildDocxTable(parsed: ParsedTable): Table {
  const colCount = parsed.headers.length;
  const colWidth = Math.floor(9000 / colCount);

  const headerRow = new TableRow({
    children: parsed.headers.map(
      (h) =>
        new TableCell({
          children: [new Paragraph({ children: makeThaiAwareRuns(h, { bold: true }) })],
          width: { size: colWidth, type: WidthType.DXA },
          shading: { fill: 'E6E6E6' },
        }),
    ),
    tableHeader: true,
  });

  const dataRows = parsed.rows.map(
    (row) =>
      new TableRow({
        children: row.map(
          (cell) =>
            new TableCell({
              children: [new Paragraph({ children: parseInlineMarkdown(cell) })],
              width: { size: colWidth, type: WidthType.DXA },
            }),
        ),
      }),
  );

  return new Table({
    rows: [headerRow, ...dataRows],
    width: { size: 9000, type: WidthType.DXA },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
      left: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
      right: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
    },
  });
}

type DocxChild = Paragraph | Table;

function parseMarkdownToDocx(markdown: string): DocxChild[] {
  const lines = markdown.split('\n');
  const children: DocxChild[] = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i] ?? '';
    const line = raw.trimEnd();

    // Detect markdown table start
    if (line.includes('|') && i + 1 < lines.length) {
      const nextLine = lines[i + 1] ?? '';
      if (/^\|?[\s\-|:]+\|?$/.test(nextLine)) {
        // Collect all table lines
        const tableLines: string[] = [line];
        i++;
        while (i < lines.length && (lines[i] ?? '').includes('|')) {
          tableLines.push(lines[i] ?? '');
          i++;
        }
        const parsed = parseMarkdownTable(tableLines);
        if (parsed) {
          children.push(buildDocxTable(parsed));
        } else {
          // Fallback: render as paragraphs
          for (const tl of tableLines) {
            children.push(new Paragraph({ children: parseInlineMarkdown(tl.replace(/^\||\|$/g, '').replace(/\|/g, ' | ')), spacing: { after: 60 } }));
          }
        }
        continue;
      }
    }

    if (/^#{1}\s+/.test(line)) {
      children.push(new Paragraph({ children: makeThaiAwareRuns(line.replace(/^#+\s+/, '')), heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 } }));
    } else if (/^#{2}\s+/.test(line)) {
      children.push(new Paragraph({ children: makeThaiAwareRuns(line.replace(/^#+\s+/, '')), heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 80 } }));
    } else if (/^#{3,}\s+/.test(line)) {
      children.push(new Paragraph({ children: makeThaiAwareRuns(line.replace(/^#+\s+/, '')), heading: HeadingLevel.HEADING_3, spacing: { before: 160, after: 80 } }));
    } else if (/^[-*+]\s+/.test(line)) {
      children.push(new Paragraph({ children: parseInlineMarkdown(line.replace(/^[-*+]\s+/, '')), bullet: { level: 0 }, spacing: { after: 60 } }));
    } else if (line.trim() === '') {
      children.push(new Paragraph({ text: '', spacing: { after: 60 } }));
    } else {
      // Strip image refs, keep visual markers
      const textLine = line.replace(/!\[[^\]]*\]\([^)]+\)/g, '');
      children.push(new Paragraph({ children: parseInlineMarkdown(textLine), spacing: { after: 80 } }));
    }
    i++;
  }

  return children;
}

export async function renderToDocx(
  translatedMarkdown: string,
  meta: DocxMeta,
  visualElements?: VisualElement[],
): Promise<Buffer> {
  // Ensure visual elements block is present
  const finalMarkdown = ensureVisualElementsBlock(
    translatedMarkdown,
    visualElements ?? [],
    meta.targetLang,
  );

  const header = new Paragraph({
    children: [
      new TextRun({ text: `${meta.sourceLang.toUpperCase()} → ${meta.targetLang.toUpperCase()}`, bold: true, size: 24 }),
      new TextRun({ text: `  |  ${meta.documentType}  |  ${meta.translatedAt}`, size: 18, color: '666666' }),
    ],
    spacing: { after: 200 },
  });

  const doc = new Document({
    sections: [{
      properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
      children: [header, ...parseMarkdownToDocx(finalMarkdown)],
    }],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}
