import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Packer,
  BorderStyle,
  ImageRun,
} from 'docx';

interface DocxMeta {
  sourceLang: string;
  targetLang: string;
  documentType: string;
  translatedAt: string;
}

function parseMarkdownToDocx(markdown: string, images: Record<string, string>): Paragraph[] {
  const lines = markdown.split('\n');
  const paragraphs: Paragraph[] = [];

  for (const raw of lines) {
    const line = raw.trimEnd();

    // Standalone image line: ![alt](id)
    const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imgMatch) {
      const [, , id] = imgMatch;
      const uri = id ? images[id] : undefined;
      if (uri) {
        const base64 = uri.replace(/^data:[^;]+;base64,/, '');
        const isJpeg = uri.startsWith('data:image/jpeg');
        try {
          paragraphs.push(new Paragraph({
            children: [
              new ImageRun({
                data: Buffer.from(base64, 'base64'),
                transformation: { width: 500, height: 280 },
                type: isJpeg ? 'jpg' : 'png',
              }),
            ],
            spacing: { after: 120 },
          }));
        } catch {
          // skip malformed image
        }
      }
      continue;
    }

    if (/^#{1}\s+/.test(line)) {
      paragraphs.push(new Paragraph({ text: line.replace(/^#+\s+/, ''), heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 } }));
    } else if (/^#{2}\s+/.test(line)) {
      paragraphs.push(new Paragraph({ text: line.replace(/^#+\s+/, ''), heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 80 } }));
    } else if (/^#{3,}\s+/.test(line)) {
      paragraphs.push(new Paragraph({ text: line.replace(/^#+\s+/, ''), heading: HeadingLevel.HEADING_3, spacing: { before: 160, after: 80 } }));
    } else if (/^[-*+]\s+/.test(line)) {
      paragraphs.push(new Paragraph({ children: [new TextRun(line.replace(/^[-*+]\s+/, ''))], bullet: { level: 0 }, spacing: { after: 60 } }));
    } else if (line.startsWith('---') || line.startsWith('===')) {
      // skip
    } else if (line.trim() === '') {
      paragraphs.push(new Paragraph({ text: '', spacing: { after: 60 } }));
    } else {
      // Strip any remaining inline image refs before text parsing
      const textLine = line.replace(/!\[([^\]]*)\]\([^)]+\)/g, '[$1]');
      paragraphs.push(new Paragraph({ children: parseInlineMarkdown(textLine), spacing: { after: 80 } }));
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

export async function renderToDocx(
  translatedMarkdown: string,
  meta: DocxMeta,
  images: Record<string, string> = {},
): Promise<Buffer> {
  const stripped = translatedMarkdown;

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

  const contentParagraphs = parseMarkdownToDocx(stripped, images);

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
        },
      },
      children: [header, ...contentParagraphs],
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  return Buffer.from(buffer);
}
