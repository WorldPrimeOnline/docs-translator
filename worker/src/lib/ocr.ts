import { env } from './env';
import { extractVisualElementsFromOcr, type VisualElement } from './visual-elements';

// Mistral OCR response types (with include_image_base64)
export interface MistralExtractedImage {
  id: string;
  top_left_x: number;
  top_left_y: number;
  bottom_right_x: number;
  bottom_right_y: number;
  image_base64?: string;
}

export interface MistralPageDimensions {
  dpi: number;
  height: number;
  width: number;
}

export interface MistralPageWithImages {
  index: number; // 0-based page index
  images: MistralExtractedImage[];
  dimensions?: MistralPageDimensions;
}

interface MistralOcrPage {
  index?: number;
  markdown: string;
  images?: MistralExtractedImage[];
  dimensions?: MistralPageDimensions;
}

interface MistralOcrResponse {
  pages: MistralOcrPage[];
}

export interface OcrResult {
  markdown: string;
  pageMarkdowns: string[];
  pageCount: number;
  visualElements: VisualElement[];
  rawPages: MistralPageWithImages[];
}

const MISTRAL_OCR_URL = 'https://api.mistral.ai/v1/ocr';
const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Extract visual element metadata from a markdown image tag before stripping it.
 * Returns alt text (without base64 payload) to feed into visual element extraction.
 */
function stripImageRefs(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)\n?/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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

  let lastError: Error = new Error('OCR failed after all retries');

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** attempt);

    const res = await fetch(MISTRAL_OCR_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.MISTRAL_API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      lastError = new Error(`Mistral OCR ${res.status}: ${text}`);
      console.warn(`[ocr] attempt ${attempt + 1} failed: ${lastError.message}`);
      continue;
    }

    const data = (await res.json()) as MistralOcrResponse;
    const pages = data.pages ?? [];

    // Keep raw page markdowns (with image refs) for visual element extraction
    const rawPageMarkdowns = pages.map((p) => p.markdown);

    // Strip image refs for clean text used in translation
    const pageMarkdowns = rawPageMarkdowns.map((md) => stripImageRefs(md));
    const markdown = pageMarkdowns.join('\n\n');

    // Extract visual elements from raw (pre-strip) per-page markdowns + joined
    const rawJoined = rawPageMarkdowns.join('\n\n');
    const visualElements = extractVisualElementsFromOcr(rawJoined, rawPageMarkdowns);

    // Structured page data with extracted images + bounding boxes
    const rawPages: MistralPageWithImages[] = pages.map((p, i) => ({
      index: p.index ?? i,
      images: p.images ?? [],
      dimensions: p.dimensions,
    }));

    const totalImages = rawPages.reduce((n, pg) => n + pg.images.length, 0);
    console.log(
      `[ocr] ${pages.length} pages, ${markdown.length} chars,` +
      ` ${totalImages} extracted images, ${visualElements.length} text visual elements`,
    );
    return { markdown, pageMarkdowns, pageCount: pages.length, visualElements, rawPages };
  }

  throw lastError;
}
