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

export interface DocxMeta {
  sourceLang: string;
  targetLang: string;
  documentType: string;
  translatedAt: string;
  filename?: string;
}

function parseInlineMarkdown(text: string): TextRun[] {
  const runs: TextRun[] = [];
  // First pass: split on bold/italic/marker
  const segRe = /(\*\*[^*]+\*\*|\*[^*]+\*|\[([^\]]{1,120})\])/g;
  let segMatch: RegExpExecArray | null;
  let pos = 0;
  segRe.lastIndex = 0;

  while ((segMatch = segRe.exec(text)) !== null) {
    if (segMatch.index > pos) {
      runs.push(new TextRun({ text: text.slice(pos, segMatch.index) }));
    }
    const part = segMatch[0];
    if (part.startsWith('**') && part.endsWith('**')) {
      runs.push(new TextRun({ text: part.slice(2, -2), bold: true }));
    } else if (part.startsWith('*') && part.endsWith('*') && !part.startsWith('**')) {
      runs.push(new TextRun({ text: part.slice(1, -1), italics: true }));
    } else if (part.startsWith('[') && part.endsWith(']')) {
      // Visual marker — render as italic
      runs.push(new TextRun({ text: part, italics: true, color: '333333' }));
    }
    pos = segMatch.index + part.length;
  }

  if (pos < text.length) {
    runs.push(new TextRun({ text: text.slice(pos) }));
  }

  return runs.length > 0 ? runs : [new TextRun({ text })];
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
          children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
          width: { size: colWidth, type: WidthType.DXA },
          shading: { fill: 'F5F5F5' },
        }),
    ),
    tableHeader: true,
  });

  const dataRows = parsed.rows.map((row) => {
    const cells = [...row];
    while (cells.length < colCount) cells.push('');
    const normalized = cells.slice(0, colCount);
    return new TableRow({
      children: normalized.map(
        (cell) =>
          new TableCell({
            children: [new Paragraph({ children: parseInlineMarkdown(cell) })],
            width: { size: colWidth, type: WidthType.DXA },
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

    if (/^-{3,}$/.test(line.trim()) || /^\*{3,}$/.test(line.trim()) || /^_{3,}$/.test(line.trim())) {
      children.push(new Paragraph({ text: '', spacing: { before: 80, after: 80 } }));
      i++;
      continue;
    }

    if (/^#{1}\s+/.test(line)) {
      children.push(new Paragraph({ text: line.replace(/^#+\s+/, ''), heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 } }));
    } else if (/^#{2}\s+/.test(line)) {
      children.push(new Paragraph({ text: line.replace(/^#+\s+/, ''), heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 80 } }));
    } else if (/^#{3,}\s+/.test(line)) {
      children.push(new Paragraph({ text: line.replace(/^#+\s+/, ''), heading: HeadingLevel.HEADING_3, spacing: { before: 160, after: 80 } }));
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

  const doc = new Document({
    sections: [{
      properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
      children: [...parseMarkdownToDocx(finalMarkdown)],
    }],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}
