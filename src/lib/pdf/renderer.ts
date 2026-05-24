import { marked } from 'marked';

interface RenderMeta {
  sourceLang: string;
  targetLang: string;
  documentType: string;
  translatedAt: string;
}

export async function renderToPdf(translatedMarkdown: string, meta: RenderMeta): Promise<Buffer> {
  const stripped = translatedMarkdown.replace(/!\[.*?\]\(.*?\)/g, '');
  const htmlBody = await marked.parse(stripped);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Translation — ${meta.sourceLang} → ${meta.targetLang}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.6;
    color: #111;
    max-width: 800px;
    margin: 0 auto;
    padding: 24px 32px;
  }
  .meta {
    font-size: 9pt;
    color: #888;
    text-align: center;
    margin-bottom: 32px;
  }
  .content h1, .content h2, .content h3 { margin: 16px 0 8px; }
  .content p { margin: 8px 0; }
  .content table { border-collapse: collapse; width: 100%; margin: 12px 0; }
  .content th, .content td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
  .content th { background: #f2f2f2; }
  @media print {
    body { padding: 0; }
  }
</style>
</head>
<body>
  <div class="meta">Translated ${meta.translatedAt} &nbsp;·&nbsp; ${meta.sourceLang} → ${meta.targetLang} &nbsp;·&nbsp; Docs Translator</div>
  <div class="content">${htmlBody}</div>
</body>
</html>`;

  return Buffer.from(html, 'utf-8');
}
