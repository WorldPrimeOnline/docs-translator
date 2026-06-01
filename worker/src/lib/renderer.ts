import { marked } from 'marked';

export interface RenderMeta {
  sourceLang: string;
  targetLang: string;
  documentType: string;
  translatedAt: string;
  filename?: string;
}

function embedImages(markdown: string, images: Record<string, string>): string {
  if (Object.keys(images).length === 0) return markdown;
  return markdown.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, id) => {
    const uri = images[id];
    if (uri) return `![${alt}](${uri})`;
    // Fallback: render as a styled placeholder instead of broken img
    return `<span class="img-ref">[img: ${id}]</span>`;
  });
}

export async function renderToHtml(
  translatedMarkdown: string,
  meta: RenderMeta,
  images: Record<string, string> = {},
  pageMarkdowns?: string[],
): Promise<string> {
  // Render per-page sections when available (preserves document page structure)
  let contentHtml: string;
  if (pageMarkdowns && pageMarkdowns.length > 1) {
    const pageParts = await Promise.all(
      pageMarkdowns.map(async (md) => {
        const withImgs = embedImages(md, images);
        const body = await marked.parse(withImgs);
        return `<div class="page">${body}</div>`;
      }),
    );
    contentHtml = pageParts.join('\n');
  } else {
    const withImgs = embedImages(translatedMarkdown, images);
    contentHtml = `<div class="page">${await marked.parse(withImgs)}</div>`;
  }

  return `<!DOCTYPE html>
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
  }
  .header {
    font-size: 9pt;
    color: #888;
    text-align: center;
    margin-bottom: 16px;
    padding-bottom: 10px;
    border-bottom: 1px solid #e0e0e0;
  }
  .page {
    page-break-after: always;
    padding: 8mm 0;
    min-height: 240mm;
  }
  .page:last-child { page-break-after: avoid; }
  .page h1 { font-size: 18pt; margin: 16px 0 10px; }
  .page h2 { font-size: 14pt; margin: 14px 0 8px; }
  .page h3 { font-size: 12pt; margin: 10px 0 6px; }
  .page p  { margin: 6px 0; }
  .page ul, .page ol { margin: 6px 0 6px 20px; }
  .page li { margin: 3px 0; }
  .page table { border-collapse: collapse; width: 100%; margin: 10px 0; }
  .page th, .page td { border: 1px solid #ccc; padding: 5px 9px; text-align: left; }
  .page th { background: #f4f4f4; font-weight: 600; }
  .page img { max-width: 100%; height: auto; display: block; margin: 8px 0; }
  .page code { font-family: monospace; background: #f4f4f4; padding: 1px 4px; border-radius: 3px; }
  .img-ref { color: #aaa; font-style: italic; font-size: 9pt; }
</style>
</head>
<body>
  <div class="header">
    ${meta.filename ? `<strong>${meta.filename}</strong> &nbsp;·&nbsp; ` : ''}
    Translated ${meta.translatedAt}
    &nbsp;·&nbsp; ${meta.sourceLang} → ${meta.targetLang}
    &nbsp;·&nbsp; ${meta.documentType}
  </div>
  ${contentHtml}
</body>
</html>`;
}
