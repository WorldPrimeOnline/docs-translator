import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  Packer,
} from 'docx';

interface DocxMeta {
  sourceLang: string;
  targetLang: string;
  documentType: string;
  translatedAt: string;
}

function parseInlineMarkdown(text: string): TextRun[] {
  const runs: TextRun[] = [];
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

function parseMarkdownToDocx(markdown: string): Paragraph[] {
  const lines = markdown.split('\n');
  const paragraphs: Paragraph[] = [];

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (/^#{1}\s+/.test(line)) {
      paragraphs.push(new Paragraph({ text: line.replace(/^#+\s+/, ''), heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 } }));
    } else if (/^#{2}\s+/.test(line)) {
      paragraphs.push(new Paragraph({ text: line.replace(/^#+\s+/, ''), heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 80 } }));
    } else if (/^#{3,}\s+/.test(line)) {
      paragraphs.push(new Paragraph({ text: line.replace(/^#+\s+/, ''), heading: HeadingLevel.HEADING_3, spacing: { before: 160, after: 80 } }));
    } else if (/^[-*+]\s+/.test(line)) {
      paragraphs.push(new Paragraph({ children: [new TextRun(line.replace(/^[-*+]\s+/, ''))], bullet: { level: 0 }, spacing: { after: 60 } }));
    } else if (line.startsWith('---') || line.startsWith('===')) {
      // skip horizontal rules
    } else if (line.trim() === '') {
      paragraphs.push(new Paragraph({ text: '', spacing: { after: 60 } }));
    } else {
      // Strip inline image refs and replace with neutral marker
      const textLine = line.replace(/!\[[^\]]*\]\([^)]+\)/g, '[image]');
      paragraphs.push(new Paragraph({ children: parseInlineMarkdown(textLine), spacing: { after: 80 } }));
    }
  }

  return paragraphs;
}

export async function renderToDocx(
  translatedMarkdown: string,
  meta: DocxMeta,
): Promise<Buffer> {
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

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
        },
      },
      children: [header, ...parseMarkdownToDocx(translatedMarkdown)],
    }],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}
