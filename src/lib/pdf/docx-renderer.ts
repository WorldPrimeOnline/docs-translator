import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Packer,
  BorderStyle,
  Table,
  TableRow,
  TableCell,
  WidthType,
} from 'docx';

interface DocxMeta {
  sourceLang: string;
  targetLang: string;
  documentType: string;
  translatedAt: string;
}

function parseMarkdownToDocx(markdown: string): Paragraph[] {
  const lines = markdown.split('\n');
  const paragraphs: Paragraph[] = [];

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (/^#{1}\s+/.test(line)) {
      paragraphs.push(new Paragraph({
        text: line.replace(/^#+\s+/, ''),
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 240, after: 120 },
      }));
    } else if (/^#{2}\s+/.test(line)) {
      paragraphs.push(new Paragraph({
        text: line.replace(/^#+\s+/, ''),
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 80 },
      }));
    } else if (/^#{3,}\s+/.test(line)) {
      paragraphs.push(new Paragraph({
        text: line.replace(/^#+\s+/, ''),
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 160, after: 80 },
      }));
    } else if (/^[-*+]\s+/.test(line)) {
      paragraphs.push(new Paragraph({
        children: [new TextRun(line.replace(/^[-*+]\s+/, ''))],
        bullet: { level: 0 },
        spacing: { after: 60 },
      }));
    } else if (/^\d+\.\s+/.test(line)) {
      paragraphs.push(new Paragraph({
        children: [new TextRun(line.replace(/^\d+\.\s+/, ''))],
        numbering: { reference: 'default', level: 0 },
        spacing: { after: 60 },
      }));
    } else if (line.startsWith('---') || line.startsWith('===')) {
      // horizontal rule — skip
    } else if (line.trim() === '') {
      paragraphs.push(new Paragraph({ text: '', spacing: { after: 60 } }));
    } else {
      // Parse inline bold/italic
      const runs = parseInlineMarkdown(line);
      paragraphs.push(new Paragraph({
        children: runs,
        spacing: { after: 80 },
      }));
    }
  }

  return paragraphs;
}

function parseInlineMarkdown(text: string): TextRun[] {
  const runs: TextRun[] = [];
  // Handle **bold** and *italic* inline
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|[^*]+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const part = match[0];
    if (part.startsWith('**') && part.endsWith('**')) {
      runs.push(new TextRun({ text: part.slice(2, -2), bold: true }));
    } else if (part.startsWith('*') && part.endsWith('*')) {
      runs.push(new TextRun({ text: part.slice(1, -1), italics: true }));
    } else {
      runs.push(new TextRun({ text: part }));
    }
  }
  return runs.length > 0 ? runs : [new TextRun({ text })];
}

export async function renderToDocx(translatedMarkdown: string, meta: DocxMeta): Promise<Buffer> {
  const stripped = translatedMarkdown.replace(/!\[.*?\]\(.*?\)/g, '');

  const disclaimer = new Paragraph({
    children: [
      new TextRun({
        text: 'UNOFFICIAL TRANSLATION — FOR INFORMATIONAL PURPOSES ONLY',
        bold: true,
        color: '888888',
        size: 18,
      }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' },
    },
  });

  const header = new Paragraph({
    children: [
      new TextRun({
        text: `${meta.sourceLang.toUpperCase()} → ${meta.targetLang.toUpperCase()}`,
        bold: true,
        size: 24,
      }),
      new TextRun({
        text: `  |  ${meta.documentType}  |  ${meta.translatedAt}`,
        size: 18,
        color: '666666',
      }),
    ],
    spacing: { after: 200 },
  });

  const contentParagraphs = parseMarkdownToDocx(stripped);

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
        },
      },
      children: [disclaimer, header, ...contentParagraphs],
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  return Buffer.from(buffer);
}
