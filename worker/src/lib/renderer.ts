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
    return uri ? `![${alt}](${uri})` : `![${alt}](${id})`;
  });
}

export async function renderToHtml(
  translatedMarkdown: string,
  meta: RenderMeta,
  images: Record<string, string> = {},
): Promise<string> {
  const withImages = embedImages(translatedMarkdown, images);
  const htmlBody = await marked.parse(withImages);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Translation — ${meta.sourceLang} → ${meta.targetLang}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: A4; margin: 20mm 15mm; }
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
    margin-bottom: 24px;
    padding-bottom: 12px;
    border-bottom: 1px solid #e0e0e0;
  }
  .content h1 { font-size: 16pt; margin: 20px 0 10px; }
  .content h2 { font-size: 13pt; margin: 16px 0 8px; }
  .content h3 { font-size: 11pt; margin: 12px 0 6px; }
  .content p  { margin: 8px 0; }
  .content img { max-width: 100%; height: auto; display: block; margin: 8px 0; }
  .content ul, .content ol { margin: 8px 0 8px 20px; }
  .content li { margin: 3px 0; }
  .content table { border-collapse: collapse; width: 100%; margin: 12px 0; }
  .content th, .content td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
  .content th { background: #f4f4f4; font-weight: 600; }
  .content code { font-family: monospace; background: #f4f4f4; padding: 1px 4px; border-radius: 3px; }
  .content pre  { background: #f4f4f4; padding: 10px; border-radius: 4px; overflow-x: auto; margin: 8px 0; }
  .footer {
    margin-top: 40px;
    padding-top: 12px;
    border-top: 1px solid #e0e0e0;
    font-size: 8pt;
    color: #aaa;
    text-align: center;
  }
</style>
</head>
<body>
  <div class="header">
    ${meta.filename ? `<strong>${meta.filename}</strong> &nbsp;·&nbsp; ` : ''}
    Translated ${meta.translatedAt}
    &nbsp;·&nbsp; ${meta.sourceLang} → ${meta.targetLang}
    &nbsp;·&nbsp; ${meta.documentType}
  </div>
  <div class="content">${htmlBody}</div>
  <div class="footer">
    UNOFFICIAL TRANSLATION — FOR INFORMATIONAL PURPOSES ONLY.<br/>
    This document is not a certified or notarized translation.
  </div>
</body>
</html>`;
}
