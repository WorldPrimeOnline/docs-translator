import { marked } from 'marked';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

interface RenderMeta {
  sourceLang: string;
  targetLang: string;
  documentType: string;
  translatedAt: string;
}

function cleanMarkdown(md: string): string {
  return md.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\n{3,}/g, '\n\n');
}

/** Produces an HTML buffer from the translated markdown. */
export async function renderToPdf(
  translatedMarkdown: string,
  meta: RenderMeta,
): Promise<Buffer> {
  const body = await marked.parse(cleanMarkdown(translatedMarkdown));
  const contentHtml = `<div class="page">${body}</div>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Translation — ${meta.sourceLang} → ${meta.targetLang}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: A4; margin: 20mm 15mm; }
  body {
    font-family: "Times New Roman", Times, serif;
    font-size: 11pt;
    line-height: 1.7;
    color: #111;
    max-width: 780px;
    margin: 0 auto;
    padding: 24px 40px;
  }
  img { display: none; }
  .meta {
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-size: 8.5pt;
    color: #999;
    text-align: center;
    margin-bottom: 24px;
    padding-bottom: 10px;
    border-bottom: 1px solid #ddd;
  }
  .page { padding: 4mm 0; }
  h1 { font-size: 14pt; margin: 18px 0 10px; text-transform: uppercase; letter-spacing: 0.03em; }
  h2 { font-size: 12pt; margin: 16px 0 8px; }
  h3 { font-size: 11pt; margin: 12px 0 6px; }
  p { margin: 5px 0; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; }
  th, td { border: 1px solid #bbb; padding: 5px 10px; text-align: left; vertical-align: top; }
  th { background: #f5f5f5; font-weight: 600; width: 40%; }
  td { width: 60%; }
  ul, ol { margin: 6px 0 6px 22px; }
  li { margin: 3px 0; }
  strong { font-weight: 700; }
  em { font-style: italic; }
  @media print { body { padding: 0; max-width: 100%; } }
</style>
</head>
<body>
  <div class="meta">${meta.sourceLang} → ${meta.targetLang} &nbsp;·&nbsp; ${meta.documentType} &nbsp;·&nbsp; ${meta.translatedAt}</div>
  ${contentHtml}
</body>
</html>`;

  return Buffer.from(html, 'utf-8');
}

/** Produces a real PDF buffer using pdf-lib (Latin characters only). */
export async function renderToPdfBuffer(
  translatedMarkdown: string,
  meta: RenderMeta,
): Promise<Buffer> {
  function winAnsiSafe(s: string): string {
    return s.replace(/[^\x20-\x7E\xA0-\xFF]/g, (ch) => {
      const replacements: Record<string, string> = {
        '→': '->', '←': '<-', '↑': '^', '↓': 'v',
        '–': '-', '—': '-', '‘': "'", '“': '"', '”': '"',
      };
      return replacements[ch] ?? '?';
    });
  }

  const stripped = winAnsiSafe(translatedMarkdown.replace(/!\[.*?\]\(.*?\)/g, ''));

  const pdfDoc = await PDFDocument.create();
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const PAGE_W = 595;
  const PAGE_H = 842;
  const MARGIN = 56;
  const LINE_H = 16;
  const CONTENT_W = PAGE_W - MARGIN * 2;

  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  function newPage() {
    page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  }

  function ensureSpace(needed: number) {
    if (y - needed < MARGIN) newPage();
  }

  function drawText(text: string, size: number, font: typeof regularFont, color = rgb(0.07, 0.07, 0.07)) {
    const words = text.split(' ');
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > CONTENT_W) {
        ensureSpace(LINE_H);
        page.drawText(line, { x: MARGIN, y, size, font, color });
        y -= LINE_H;
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) {
      ensureSpace(LINE_H);
      page.drawText(line, { x: MARGIN, y, size, font, color });
      y -= LINE_H;
    }
  }

  drawText('UNOFFICIAL TRANSLATION — FOR INFORMATIONAL PURPOSES ONLY', 8, regularFont, rgb(0.5, 0.5, 0.5));
  y -= 4;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
  y -= 12;
  drawText(`${meta.sourceLang.toUpperCase()} -> ${meta.targetLang.toUpperCase()}  |  ${meta.documentType}  |  ${meta.translatedAt}`, 9, regularFont, rgb(0.4, 0.4, 0.4));
  y -= 16;

  for (const rawLine of stripped.split('\n')) {
    const line = rawLine.trimEnd();

    if (/^#{1}\s+/.test(line)) {
      y -= 8;
      ensureSpace(LINE_H * 2);
      drawText(line.replace(/^#+\s+/, ''), 14, boldFont);
      y -= 4;
    } else if (/^#{2}\s+/.test(line)) {
      y -= 4;
      drawText(line.replace(/^#+\s+/, ''), 12, boldFont);
      y -= 2;
    } else if (/^#{3,}\s+/.test(line)) {
      drawText(line.replace(/^#+\s+/, ''), 11, boldFont);
    } else if (/^[-*+]\s+/.test(line)) {
      const text = line.replace(/^[-*+]\s+/, '');
      ensureSpace(LINE_H);
      page.drawText('•', { x: MARGIN, y, size: 10, font: regularFont, color: rgb(0.07, 0.07, 0.07) });
      const words = text.split(' ');
      let l = '';
      for (const w of words) {
        const cand = l ? `${l} ${w}` : w;
        if (regularFont.widthOfTextAtSize(cand, 10) > CONTENT_W - 14) {
          ensureSpace(LINE_H);
          page.drawText(l, { x: MARGIN + 14, y, size: 10, font: regularFont, color: rgb(0.07, 0.07, 0.07) });
          y -= LINE_H;
          l = w;
        } else { l = cand; }
      }
      if (l) {
        ensureSpace(LINE_H);
        page.drawText(l, { x: MARGIN + 14, y, size: 10, font: regularFont, color: rgb(0.07, 0.07, 0.07) });
        y -= LINE_H;
      }
    } else if (line.trim() === '' || line.startsWith('---')) {
      y -= LINE_H / 2;
    } else {
      const clean = line.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/`([^`]+)`/g, '$1');
      drawText(clean, 10, regularFont);
    }
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}
