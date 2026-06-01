import { marked } from 'marked';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

interface RenderMeta {
  sourceLang: string;
  targetLang: string;
  documentType: string;
  translatedAt: string;
}

/** Substitute image IDs with data URIs so marked renders them as <img> tags. */
function embedImages(markdown: string, images: Record<string, string>): string {
  if (Object.keys(images).length === 0) return markdown;
  return markdown.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, id) => {
    const uri = images[id];
    return uri ? `![${alt}](${uri})` : `![${alt}](${id})`;
  });
}

/** Produces an HTML buffer with per-page sections and page breaks. */
export async function renderToPdf(
  translatedMarkdown: string,
  meta: RenderMeta,
  images: Record<string, string> = {},
  pageMarkdowns?: string[],
): Promise<Buffer> {
  let contentHtml: string;
  if (pageMarkdowns && pageMarkdowns.length > 1) {
    const parts = await Promise.all(
      pageMarkdowns.map(async (md) => {
        const body = await marked.parse(embedImages(md, images));
        return `<div class="page">${body}</div>`;
      }),
    );
    contentHtml = parts.join('\n');
  } else {
    const body = await marked.parse(embedImages(translatedMarkdown, images));
    contentHtml = `<div class="page">${body}</div>`;
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Translation — ${meta.sourceLang} → ${meta.targetLang}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: A4; margin: 15mm; }
  body {
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.6;
    color: #111;
    max-width: 800px;
    margin: 0 auto;
    padding: 16px 32px;
  }
  .meta { font-size: 9pt; color: #888; text-align: center; margin-bottom: 20px; }
  .page { page-break-after: always; padding: 4mm 0; }
  .page:last-child { page-break-after: avoid; }
  .page h1, .page h2, .page h3 { margin: 14px 0 7px; }
  .page p { margin: 6px 0; }
  .page img { max-width: 100%; height: auto; display: block; margin: 8px 0; }
  .page table { border-collapse: collapse; width: 100%; margin: 10px 0; }
  .page th, .page td { border: 1px solid #ccc; padding: 5px 9px; text-align: left; }
  .page th { background: #f2f2f2; }
  .img-ref { color: #aaa; font-style: italic; font-size: 9pt; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <div class="meta">Translated ${meta.translatedAt} &nbsp;·&nbsp; ${meta.sourceLang} → ${meta.targetLang}</div>
  ${contentHtml}
</body>
</html>`;

  return Buffer.from(html, 'utf-8');
}

/** Produces a real PDF buffer using pdf-lib (text-based, no Puppeteer). */
export async function renderToPdfBuffer(
  translatedMarkdown: string,
  meta: RenderMeta,
  _images: Record<string, string> = {},
): Promise<Buffer> {
  // pdf-lib uses WinAnsi (Helvetica) — only Latin chars are safe.
  // Sanitize: replace chars outside WinAnsi range with '?'
  function winAnsiSafe(s: string): string {
    return s.replace(/[^\x20-\x7E\xA0-\xFF]/g, (ch) => {
      const replacements: Record<string, string> = { '→': '->', '←': '<-', '↑': '^', '↓': 'v', '–': '-', '—': '-', '’': "'", '“': '"', '”': '"' };
      return replacements[ch] ?? '?';
    });
  }

  // pdf-lib text renderer: strip image refs (can't position images in text flow)
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

  // Header
  const headerText = `UNOFFICIAL TRANSLATION — FOR INFORMATIONAL PURPOSES ONLY`;
  drawText(headerText, 8, regularFont, rgb(0.5, 0.5, 0.5));
  y -= 4;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
  y -= 12;
  drawText(`${meta.sourceLang.toUpperCase()} → ${meta.targetLang.toUpperCase()}  ·  ${meta.documentType}  ·  ${meta.translatedAt}`, 9, regularFont, rgb(0.4, 0.4, 0.4));
  y -= 16;

  // Content
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
