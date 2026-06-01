import { marked } from 'marked';

export interface RenderMeta {
  sourceLang: string;
  targetLang: string;
  documentType: string;
  translatedAt: string;
  filename?: string;
}

export async function renderToHtml(
  translatedMarkdown: string,
  meta: RenderMeta,
): Promise<string> {
  const body = await marked.parse(translatedMarkdown);

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
  .content {
    padding: 8mm 0;
  }
  h1 { font-size: 18pt; margin: 16px 0 10px; }
  h2 { font-size: 14pt; margin: 14px 0 8px; }
  h3 { font-size: 12pt; margin: 10px 0 6px; }
  p  { margin: 6px 0; }
  ul, ol { margin: 6px 0 6px 20px; }
  li { margin: 3px 0; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; }
  th, td { border: 1px solid #ccc; padding: 5px 9px; text-align: left; }
  th { background: #f4f4f4; font-weight: 600; }
  code { font-family: monospace; background: #f4f4f4; padding: 1px 4px; border-radius: 3px; }
</style>
</head>
<body>
  <div class="header">
    ${meta.filename ? `<strong>${meta.filename}</strong> &nbsp;·&nbsp; ` : ''}Translated ${meta.translatedAt}
    &nbsp;·&nbsp; ${meta.sourceLang} → ${meta.targetLang}
    &nbsp;·&nbsp; ${meta.documentType}
  </div>
  <div class="content">${body}</div>
</body>
</html>`;
}
