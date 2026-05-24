import { marked } from 'marked';
import type { Browser } from 'puppeteer-core';

interface PdfMeta {
  sourceLang: string;
  targetLang: string;
  documentType: string;
  translatedAt: string;
}

// Chromium binary released alongside @sparticuz/chromium-min v148
const CHROMIUM_PACK_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v148.0.0/chromium-v148.0.0-pack.tar';

async function launchBrowser(): Promise<Browser> {
  if (process.env.NODE_ENV === 'production') {
    const [{ default: Chromium }, { default: puppeteerCore }] = await Promise.all([
      import('@sparticuz/chromium-min'),
      import('puppeteer-core'),
    ]);
    return puppeteerCore.launch({
      args: Chromium.args,
      executablePath: await Chromium.executablePath(
        process.env.CHROMIUM_EXECUTABLE_PATH ?? CHROMIUM_PACK_URL,
      ),
      headless: true,
    });
  }

  const { default: puppeteer } = await import('puppeteer');
  return puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
}

export async function renderToPdf(translatedMarkdown: string, meta: PdfMeta): Promise<Buffer> {
  const htmlBody = await marked.parse(translatedMarkdown);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.6;
    color: #111;
  }
  .banner {
    background: #c0392b;
    color: #fff;
    text-align: center;
    font-size: 10pt;
    font-weight: bold;
    letter-spacing: 0.05em;
    padding: 6px 12px;
    margin-bottom: 24px;
  }
  .content { padding: 0 40px; }
  h1, h2, h3 { margin: 16px 0 8px; }
  p { margin: 8px 0; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; }
  th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
  th { background: #f2f2f2; }
  @page {
    margin: 20mm 15mm 28mm;
    @bottom-center {
      content: "Translated ${meta.translatedAt} | ${meta.sourceLang} → ${meta.targetLang} | Docs Translator";
      font-size: 8pt;
      color: #888;
    }
  }
</style>
</head>
<body>
  <div class="banner">UNOFFICIAL TRANSLATION — FOR INFORMATIONAL PURPOSES ONLY</div>
  <div class="content">${htmlBody}</div>
</body>
</html>`;

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
