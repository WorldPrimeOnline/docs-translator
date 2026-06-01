import { env } from '@/lib/env';

interface MistralOcrImage {
  id: string;
  image_base64: string;
}

interface MistralOcrPage {
  markdown: string;
  images?: MistralOcrImage[];
}

interface MistralOcrResponse {
  pages: MistralOcrPage[];
}

export interface OcrResult {
  markdown: string;
  pageCount: number;
  detectedLanguage?: string;
  images: Record<string, string>; // imageId → data URI
}

const MISTRAL_OCR_URL = 'https://api.mistral.ai/v1/ocr';
const MAX_RETRIES = 3;

function toDataUri(base64: string): string {
  const mime = base64.startsWith('iVBOR') ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${base64}`;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function extractTextFromPdf(pdfBuffer: Buffer): Promise<OcrResult> {
  const base64 = pdfBuffer.toString('base64');
  const body = {
    model: 'mistral-ocr-latest',
    document: {
      type: 'document_url',
      document_url: `data:application/pdf;base64,${base64}`,
    },
    include_image_base64: true,
  };

  let lastError: Error = new Error('OCR failed');

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** attempt);

    const response = await fetch(MISTRAL_OCR_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.MISTRAL_API_KEY}`,
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
    const markdown = pages.map((p) => p.markdown).join('\n\n');

    const images: Record<string, string> = {};
    for (const page of pages) {
      for (const img of page.images ?? []) {
        if (img.id && img.image_base64) {
          images[img.id] = toDataUri(img.image_base64);
        }
      }
    }

    return { markdown, pageCount: pages.length, images };
  }

  throw lastError;
}
