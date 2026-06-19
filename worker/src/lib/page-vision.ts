/**
 * Page-level visual element analysis via Claude full-page PDF vision.
 *
 * PRIMARY: send the full PDF buffer to Claude as a document block.
 * Claude renders each page visually and identifies ALL elements:
 * vector stamps, handwritten signatures, watermarks, logos, QR codes —
 * regardless of whether Mistral OCR extracted them as embedded images.
 *
 * SECONDARY fallback: classify individual images extracted by Mistral OCR.
 * Only used when the full-PDF path fails or returns 0 elements AND
 * Mistral did extract at least one raster image from the PDF.
 *
 * Both paths are non-blocking — any failure returns [] so the caller
 * can fall back to translated-markdown bracket markers.
 */

import Anthropic from '@anthropic-ai/sdk';
import { env } from './env';
import type { VisualElement, VisualElementKind, VisualPosition } from './visual-elements';
import type { MistralPageWithImages, MistralExtractedImage, MistralPageDimensions } from './ocr';

// ── Configuration ─────────────────────────────────────────────────────────────

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return _client;
}

const MODEL = 'claude-sonnet-4-5-20250929';
const MAX_RETRIES = 3;
const CONFIDENCE_THRESHOLD = 0.35;

const DEFAULT_DIMS: MistralPageDimensions = { dpi: 72, width: 794, height: 1122 };

const VALID_KINDS = new Set<string>([
  'logo', 'emblem', 'photo', 'qr', 'barcode', 'stamp', 'signature',
  'watermark', 'accreditation_mark', 'certification_mark', 'label', 'unknown_image',
]);

const VALID_POSITIONS = new Set<string>([
  'upper_left', 'upper_center', 'upper_right',
  'center_left', 'center', 'center_right',
  'lower_left', 'lower_center', 'lower_right',
  'full_page',
]);

// ── Pure utilities (exported for unit tests) ──────────────────────────────────

/**
 * Map a bounding box (pixel coordinates within a page) to a named 3×3 + full_page zone.
 */
export function bboxToPosition(
  image: Pick<MistralExtractedImage, 'top_left_x' | 'top_left_y' | 'bottom_right_x' | 'bottom_right_y'>,
  dims: MistralPageDimensions,
): VisualPosition {
  const cx = (image.top_left_x + image.bottom_right_x) / 2 / dims.width;
  const cy = (image.top_left_y + image.bottom_right_y) / 2 / dims.height;
  const wRatio = (image.bottom_right_x - image.top_left_x) / dims.width;

  if (wRatio > 0.8) return 'full_page';

  const h: 'left' | 'center' | 'right' =
    cx < 0.33 ? 'left' : cx > 0.67 ? 'right' : 'center';
  const v: 'upper' | 'center' | 'lower' =
    cy < 0.33 ? 'upper' : cy > 0.67 ? 'lower' : 'center';

  if (v === 'center' && h === 'center') return 'center';
  if (v === 'center') return `center_${h}` as VisualPosition;
  return `${v}_${h}` as VisualPosition;
}

/** Result item returned by the per-image classification call (secondary path). */
export interface VisionResultItem {
  imageIndex: number;
  kind: string;
  confidence: number;
  description?: string;
}

/**
 * Extract the first JSON array from a raw Claude text response (secondary path).
 * Returns [] on any parse failure so the pipeline always continues.
 */
export function parseVisionResponse(text: string): VisionResultItem[] {
  const match = text.match(/\[[\s\S]*?\]/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]) as unknown[];
    return parsed.filter(
      (item): item is VisionResultItem =>
        typeof item === 'object' &&
        item !== null &&
        'imageIndex' in item &&
        typeof (item as Record<string, unknown>).imageIndex === 'number' &&
        'kind' in item &&
        typeof (item as Record<string, unknown>).kind === 'string' &&
        'confidence' in item &&
        typeof (item as Record<string, unknown>).confidence === 'number',
    );
  } catch {
    return [];
  }
}

// ── Full-page PDF vision (PRIMARY) ────────────────────────────────────────────

const FULL_PDF_VISION_SYSTEM =
  'You analyze documents for visual and graphical elements. ' +
  'You examine every page completely, covering all areas: headers, footers, body, ' +
  'margins, corners, background layers, and signature zones. ' +
  'Report only elements you can actually see. Use "unknown_image" for unclear elements.';

const LANG_NAMES: Record<string, string> = {
  en: 'English', ru: 'Russian (Русский)', it: 'Italian (Italiano)',
  de: 'German (Deutsch)', fr: 'French (Français)', es: 'Spanish (Español)',
  zh: 'Chinese (中文)', ko: 'Korean (한국어)', ja: 'Japanese (日本語)',
  kk: 'Kazakh (Қазақша)', uz: "Uzbek (O'zbek)", th: 'Thai (ภาษาไทย)',
  ar: 'Arabic (عربي)', tr: 'Turkish (Türkçe)', tj: 'Tajik (Тоҷикӣ)',
  tk: 'Turkmen (Türkmen)', mn: 'Mongolian (Монгол)', ky: 'Kyrgyz (Кыргызча)',
};

function buildFullPdfVisionPrompt(targetLang: string): string {
  const ln = LANG_NAMES[targetLang] ?? targetLang;
  return (
    'Examine every page of this document and identify all visual/graphical elements.\n\n' +
    'Look for in every area (including background, margins, and overlays):\n' +
    '- Company or organization logos or brand marks\n' +
    '- Official stamps or seals (round, rectangular, wet ink or printed)\n' +
    '- Handwritten signatures or ink marks\n' +
    '- QR codes (2D matrix barcodes)\n' +
    '- Barcodes (1D parallel-line barcodes)\n' +
    '- Watermarks (background text or translucent overlays)\n' +
    '- Photographs of persons, objects, or scenes\n' +
    '- Government emblems or coats of arms\n' +
    '- Accreditation marks or certification badges\n' +
    '- Any other meaningful graphical element\n\n' +
    'Do NOT report:\n' +
    '- Plain printed text content\n' +
    '- Plain printed URLs (a QR code containing a URL IS a visual element)\n\n' +
    `LANGUAGE: Write every "description" in ${ln}.\n` +
    'If the visual element has readable text (stamp text, watermark text, logo name), ' +
    'preserve that text verbatim inside «» guillemets. ' +
    'Describe the element in the target language; only the quoted text stays in the original.\n\n' +
    'Return JSON only — no prose, no markdown fences:\n' +
    '{"pages":[{"page":1,"elements":[{"kind":"<kind>","position":"<position>","description":"<max 60 chars in target lang>","confidence":<0.0-1.0>}]}]}\n\n' +
    'Kind values: logo, emblem, photo, qr, barcode, stamp, signature, watermark, accreditation_mark, certification_mark, label, unknown_image\n' +
    'Position values: upper_left, upper_center, upper_right, center_left, center, center_right, lower_left, lower_center, lower_right, full_page\n' +
    'Omit elements with confidence < 0.35.\n' +
    'Return JSON only.'
  );
}

interface PdfVisionElement {
  kind: string;
  position: string;
  description?: string;
  confidence: number;
}

interface PdfVisionPage {
  page: number;
  elements?: PdfVisionElement[];
}

interface PdfVisionResponse {
  pages?: PdfVisionPage[];
}

/**
 * Parse Claude's full-PDF structured response.
 * Returns [] on any parse failure so the pipeline always continues.
 */
export function parsePdfVisionResponse(text: string): VisualElement[] {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0]) as PdfVisionResponse;
    if (!Array.isArray(parsed.pages)) return [];

    const elements: VisualElement[] = [];

    for (const pageData of parsed.pages) {
      const pageNum = pageData.page;
      if (!Array.isArray(pageData.elements)) continue;

      for (const el of pageData.elements) {
        if (el.confidence < CONFIDENCE_THRESHOLD) continue;

        const kind: VisualElementKind = VALID_KINDS.has(el.kind)
          ? (el.kind as VisualElementKind)
          : 'unknown_image';

        const position: VisualPosition | undefined = VALID_POSITIONS.has(el.position)
          ? (el.position as VisualPosition)
          : undefined;

        const desc = (el.description ?? '').trim().slice(0, 60);

        elements.push({
          page: pageNum,
          kind,
          position,
          description: desc || undefined,
          text: desc ? `[${kind}: ${desc}]` : `[${kind}]`,
          confidence: el.confidence,
          source: 'pdf_image_extraction',
        });
      }
    }

    return deduplicatePageVision(elements);
  } catch {
    return [];
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function analyzeFullPdfWithClaude(
  pdfBuffer: Buffer,
  anthropic: Anthropic,
  targetLang: string,
): Promise<VisualElement[]> {
  const pdfBase64 = pdfBuffer.toString('base64');
  const prompt = buildFullPdfVisionPrompt(targetLang);
  let lastError: Error = new Error('PDF vision failed after all retries');

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** attempt);

    try {
      const docBlock: Anthropic.Messages.DocumentBlockParam = {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: pdfBase64,
        },
      };

      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system: FULL_PDF_VISION_SYSTEM,
        messages: [{
          role: 'user',
          content: [
            docBlock,
            { type: 'text', text: prompt },
          ],
        }],
      });

      const text = response.content
        .filter((b) => b.type === 'text')
        .map((b) => ('text' in b ? b.text : ''))
        .join('');

      console.log(`[page-vision] full-pdf raw response length=${text.length}`);
      return parsePdfVisionResponse(text);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[page-vision] full-pdf attempt ${attempt + 1} failed: ${lastError.message}`);
    }
  }

  throw lastError;
}

// ── Per-page image classification (SECONDARY fallback) ────────────────────────

const IMAGE_VISION_SYSTEM =
  'You identify visual and graphical elements in images extracted from official document pages. ' +
  'Be precise. Do not guess element types. ' +
  "If you cannot confidently classify an image, use 'unknown_image'.";

function buildImageVisionPrompt(imageCount: number): string {
  const noun = imageCount === 1 ? '1 image was' : `${imageCount} images were`;
  return (
    `${noun} extracted from a document page. ` +
    'Examine each image and identify what type of visual element it represents.\n\n' +
    'Return a JSON array only (no prose, no markdown fences):\n' +
    '[{"imageIndex":<0-based int>,"kind":"<kind>","confidence":<0.0-1.0>,"description":"<max 60 chars>"}]\n\n' +
    'Kind values:\n' +
    'logo – company/organization logo or brand mark\n' +
    'stamp – official round or rectangular organizational seal impression\n' +
    'signature – handwritten signature or ink mark\n' +
    'qr – QR code (2D matrix barcode)\n' +
    'barcode – 1D barcode (parallel lines)\n' +
    'watermark – translucent background watermark (text or image overlay)\n' +
    'photo – photograph of a person, object, or scene\n' +
    'emblem – government or official emblem, coat of arms\n' +
    'accreditation_mark – professional accreditation or quality mark\n' +
    'certification_mark – certification badge or quality certificate mark\n' +
    'label – adhesive label, sticker, or decorative border\n' +
    'unknown_image – unclear or unclassifiable image element\n\n' +
    'Rules:\n' +
    '- Omit elements with confidence < 0.35\n' +
    '- Do not translate document text\n' +
    'Response: JSON array only.'
  );
}

interface LabeledImage {
  meta: MistralExtractedImage;
  position: VisualPosition;
}

async function classifyPageImages(
  pageNum: number,
  images: LabeledImage[],
  anthropic: Anthropic,
): Promise<VisualElement[]> {
  const imageBlocks: Anthropic.ImageBlockParam[] = images.map(({ meta }) => ({
    type: 'image',
    source: {
      type: 'base64',
      media_type: 'image/png',
      data: meta.image_base64!,
    },
  }));

  let lastError: Error = new Error('Image classification failed');

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** attempt);

    try {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: IMAGE_VISION_SYSTEM,
        messages: [{
          role: 'user',
          content: [
            ...imageBlocks,
            { type: 'text', text: buildImageVisionPrompt(images.length) },
          ],
        }],
      });

      const rawText = response.content
        .filter((b) => b.type === 'text')
        .map((b) => ('text' in b ? b.text : ''))
        .join('');

      const items = parseVisionResponse(rawText);
      const elements: VisualElement[] = [];

      for (const item of items) {
        if (item.confidence < CONFIDENCE_THRESHOLD) continue;
        const labeled = images[item.imageIndex];
        if (!labeled) continue;

        const kind: VisualElementKind = VALID_KINDS.has(item.kind)
          ? (item.kind as VisualElementKind)
          : 'unknown_image';
        const desc = item.description?.trim() ?? '';

        elements.push({
          page: pageNum,
          kind,
          position: labeled.position,
          description: desc || undefined,
          text: desc ? `[${kind}: ${desc}]` : `[${kind}]`,
          confidence: item.confidence,
          source: 'pdf_image_extraction',
        });
      }

      return elements;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[page-vision] page ${pageNum} image attempt ${attempt + 1} failed: ${lastError.message}`);
    }
  }

  throw lastError;
}

async function analyzeExtractedImages(
  pages: MistralPageWithImages[],
  anthropic: Anthropic,
): Promise<VisualElement[]> {
  const allElements: VisualElement[] = [];

  for (const page of pages) {
    const pageNum = page.index + 1;
    const imagesWithData = page.images.filter((img) => img.image_base64);

    if (imagesWithData.length === 0) {
      console.log(`[page-vision] extracted-images page ${pageNum}: 0 raster images — skipping`);
      continue;
    }

    const dims = page.dimensions ?? DEFAULT_DIMS;
    const labeled: LabeledImage[] = imagesWithData.map((meta) => ({
      meta,
      position: bboxToPosition(meta, dims),
    }));

    try {
      const elements = await classifyPageImages(pageNum, labeled, anthropic);
      console.log(
        `[page-vision] extracted-images page ${pageNum}: ${imagesWithData.length} images,` +
        ` ${elements.length} elements — kinds=[${elements.map((e) => e.kind).join(',')}]`,
      );
      allElements.push(...elements);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[page-vision] extracted-images page ${pageNum} failed (non-fatal): ${msg}`);
    }
  }

  return allElements;
}

// ── Deduplication ─────────────────────────────────────────────────────────────

/**
 * Dedup by page + kind + position.
 * Preserves two physical objects of the same kind at different positions
 * (e.g., two signatures at lower_left and lower_right).
 */
function deduplicatePageVision(elements: VisualElement[]): VisualElement[] {
  const seen = new Set<string>();
  return elements.filter((el) => {
    const key = `${el.page ?? '?'}:${el.kind}:${el.position ?? '?'}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Main entry ────────────────────────────────────────────────────────────────

/**
 * Analyze a document PDF for visual elements.
 *
 * PRIMARY: sends the full PDF to Claude as a document block (full-page-raster).
 *   Claude renders each page and identifies ALL visual elements regardless of
 *   whether they are vector or raster.
 *
 * SECONDARY: if primary yields 0 elements or fails, classifies individual images
 *   extracted by Mistral OCR (only works if the PDF had embedded raster images).
 *
 * Returns [] on total failure — the caller falls back to markdown bracket markers.
 *
 * `_anthropic` is only for unit tests (dependency injection).
 */
export async function analyzeDocumentVisuals(
  rawPages: MistralPageWithImages[],
  pdfBuffer: Buffer,
  targetLang: string,
  _anthropic?: Anthropic,
): Promise<VisualElement[]> {
  const anthropic = _anthropic ?? getClient();

  // PRIMARY: full-page PDF vision via Claude document block
  try {
    const elements = await analyzeFullPdfWithClaude(pdfBuffer, anthropic, targetLang);
    const count = elements.length;
    console.log(
      `[page-vision] source=full-page-raster count=${count}` +
      ` kinds=${JSON.stringify(elements.map((e) => e.kind))}`,
    );
    if (count > 0) return elements;
    console.log('[page-vision] full-page-raster returned 0 elements — trying extracted images');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[page-vision] full-page-raster failed (non-fatal): ${msg}`);
  }

  // SECONDARY: Mistral-extracted raster images (fallback within page-vision)
  const fallbackElements = await analyzeExtractedImages(rawPages, anthropic);
  const fallbackCount = fallbackElements.length;
  console.log(
    `[page-vision] source=extracted-images count=${fallbackCount}` +
    ` kinds=${JSON.stringify(fallbackElements.map((e) => e.kind))}`,
  );
  return deduplicatePageVision(fallbackElements);
}
