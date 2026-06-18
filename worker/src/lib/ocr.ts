import { env } from './env';
import { extractVisualElementsFromOcr, type VisualElement } from './visual-elements';
import { reorderPagesByEvidence } from './page-order';

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
  visualElements: VisualElement[];
  pageOrderWarning?: string;
  pageOrderReordered?: boolean;
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

    // Keep raw page markdowns (with images) for visual element extraction
    const rawPageMarkdownsOriginal = pages.map((p) => p.markdown);

    // Strip image refs — on stripped markdowns, detect and reorder pages
    const strippedOriginal = rawPageMarkdownsOriginal.map((md) => stripImageRefs(md));
    const orderResult = reorderPagesByEvidence(strippedOriginal);

    // Apply reorder to both stripped and raw (for visual extraction)
    const pageMarkdowns = orderResult.reorderedMarkdowns;
    const rawPageMarkdowns = orderResult.reordered
      ? orderResult.evidence.map(e => rawPageMarkdownsOriginal[e.uploadIndex]!)
      : rawPageMarkdownsOriginal;

    const markdown = pageMarkdowns.join('\n\n');

    if (orderResult.reordered) {
      const order = orderResult.evidence.map(e => `upload[${e.uploadIndex}]→page${e.detectedPageNumber}`).join(',');
      console.log(`[ocr] PAGE_ORDER_REORDERED: ${order}`);
    } else if (orderResult.warning) {
      console.warn(`[ocr] PAGE_ORDER_WARNING: ${orderResult.warning}`);
    }

    // Extract visual elements from raw (pre-strip) per-page markdowns + joined
    const rawJoined = rawPageMarkdowns.join('\n\n');
    const visualElements = extractVisualElementsFromOcr(rawJoined, rawPageMarkdowns);

    console.log(`[ocr] ${pages.length} pages, ${markdown.length} chars, ${visualElements.length} visual elements`);
    return {
      markdown,
      pageMarkdowns,
      pageCount: pages.length,
      visualElements,
      pageOrderReordered: orderResult.reordered,
      pageOrderWarning: orderResult.warning,
    };
  }

  throw lastError;
}
