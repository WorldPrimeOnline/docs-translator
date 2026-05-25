import puppeteer, { type Browser } from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

let _browser: Browser | null = null;

/**
 * Return a shared browser instance, launching it if not yet started.
 * Re-launch automatically if the process has crashed.
 */
async function getBrowser(): Promise<Browser> {
  if (_browser) {
    try {
      // Quick health-check: if this throws the browser is gone
      await _browser.version();
      return _browser;
    } catch {
      _browser = null;
    }
  }

  const executablePath = await chromium.executablePath();
  console.log('[pdf] sparticuz executable:', executablePath);
  console.log('[pdf] launching with --no-sandbox...');

  _browser = await puppeteer.launch({
    args: chromium.args,
    executablePath,
    headless: true,
  });

  _browser.on('disconnected', () => {
    console.warn('[pdf] browser disconnected — will relaunch on next request');
    _browser = null;
  });

  return _browser;
}

export async function closeBrowser(): Promise<void> {
  if (_browser) {
    await _browser.close();
    _browser = null;
  }
}

/**
 * Convert an HTML string to a PDF Buffer using Puppeteer.
 * Throws on error — caller should fall back to HTML.
 */
export async function generatePdfFromHtml(html: string): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setContent(html, {
      waitUntil: 'load',
      timeout: 30_000,
    });

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
      timeout: 60_000,
    });

    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}
