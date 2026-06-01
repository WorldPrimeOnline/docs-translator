import { marked } from 'marked';

export interface RenderMeta {
  sourceLang: string;
  targetLang: string;
  documentType: string;
  translatedAt: string;
  filename?: string;
}

function cleanMarkdown(md: string): string {
  return md.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\n{3,}/g, '\n\n');
}

export async function renderToHtml(
  translatedMarkdown: string,
  meta: RenderMeta,
): Promise<string> {
  const body = await marked.parse(cleanMarkdown(translatedMarkdown));

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
    font-family: "Times New Roman", Times, serif;
    font-size: 11pt;
    line-height: 1.7;
    color: #111;
    max-width: 780px;
    margin: 0 auto;
    padding: 24px 40px;
  }
  img { display: none; }
  .header {
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-size: 8.5pt;
    color: #999;
    text-align: center;
    margin-bottom: 24px;
    padding-bottom: 10px;
    border-bottom: 1px solid #ddd;
  }
  .content { padding: 4mm 0; }
  h1 { font-size: 14pt; margin: 18px 0 10px; text-transform: uppercase; letter-spacing: 0.03em; }
  h2 { font-size: 12pt; margin: 16px 0 8px; }
  h3 { font-size: 11pt; margin: 12px 0 6px; }
  p  { margin: 5px 0; }
  ul, ol { margin: 6px 0 6px 22px; }
  li { margin: 3px 0; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; }
  th, td { border: 1px solid #bbb; padding: 5px 10px; text-align: left; vertical-align: top; }
  th { background: #f5f5f5; font-weight: 600; width: 40%; }
  td { width: 60%; }
  strong { font-weight: 700; }
  em { font-style: italic; }
  @media print { body { padding: 0; max-width: 100%; } }
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
