import { env } from '@/lib/env';

interface MistralOcrPage {
  markdown: string;
}

interface MistralOcrResponse {
  pages: MistralOcrPage[];
}

export interface OcrResult {
  markdown: string;
  pageMarkdowns: string[];
  pageCount: number;
}

export interface ExtractTextFromPdfOptions {
  /**
   * Explicit API key, bypassing @/lib/env entirely when provided. @/lib/env's `env` proxy
   * validates its FULL schema (NODE_ENV, R2_*, ANTHROPIC_API_KEY, NEXT_PUBLIC_SUPABASE_*, ...)
   * on first property access — fine for the web app (already has all of it), but wrong for a
   * standalone caller (tools/pricing-cli) that only ever has MISTRAL_API_KEY. Passing this
   * option means `env.MISTRAL_API_KEY` is never touched, so that validation never fires.
   * Omit it (the default) to keep the existing @/lib/env-backed behavior unchanged.
   */
  mistralApiKey?: string;
}

const MISTRAL_OCR_URL = 'https://api.mistral.ai/v1/ocr';
const MAX_RETRIES = 3;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripImageRefs(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)\n?/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function extractTextFromPdf(pdfBuffer: Buffer, options?: ExtractTextFromPdfOptions): Promise<OcrResult> {
  const apiKey = options?.mistralApiKey ?? env.MISTRAL_API_KEY;
  const base64 = pdfBuffer.toString('base64');
  const body = {
    model: 'mistral-ocr-latest',
    document: {
      type: 'document_url',
      document_url: `data:application/pdf;base64,${base64}`,
    },
  };

  let lastError: Error = new Error('OCR failed');

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** attempt);

    const response = await fetch(MISTRAL_OCR_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      lastError = new Error(`Mistral OCR error ${response.status}: ${text}`);
      continue;
    }

    const data = (await response.json()) as MistralOcrResponse;
    const pages = data.pages ?? [];
    const pageMarkdowns = pages.map((p) => stripImageRefs(p.markdown));
    const markdown = pageMarkdowns.join('\n\n');

    return { markdown, pageMarkdowns, pageCount: pages.length };
  }

  throw lastError;
}
