/**
 * Page-level visual element analysis.
 *
 * Source PDF images are extracted by Mistral OCR (include_image_base64=true).
 * For each page that has at least one extracted image, one Claude vision call
 * classifies every image on that page into a VisualElementKind.
 *
 * This is the PRIMARY source for the visual inventory.
 * Translated-markdown bracket markers are a fallback only.
 */

import Anthropic from '@anthropic-ai/sdk';
import { env } from './env';
import type { VisualElement, VisualElementKind, VisualPosition } from './visual-elements';
import type { MistralPageWithImages, MistralExtractedImage, MistralPageDimensions } from './ocr';

// ── Configuration ─────────────────────────────────────────────────────────────

let _client: Anthropic | null = null;

/** Returns the shared Anthropic client, created lazily on first use. */
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return _client;
}

const MODEL = 'claude-sonnet-4-5-20250929';
const MAX_RETRIES = 3;
const CONFIDENCE_THRESHOLD = 0.35;

// A4 page in pixels at 72 dpi — used as fallback when Mistral doesn't return dimensions
const DEFAULT_DIMS: MistralPageDimensions = { dpi: 72, width: 794, height: 1122 };

const VALID_KINDS = new Set<string>([
  'logo', 'emblem', 'photo', 'qr', 'barcode', 'stamp', 'signature',
  'watermark', 'accreditation_mark', 'certification_mark', 'label', 'unknown_image',
]);

// ── Pure utilities (exported for unit tests) ──────────────────────────────────

/**
 * Map a bounding box (pixel coordinates within a page) to a named 3×3 + full_page zone.
 * Uses the centre point of the bbox to determine which zone the element sits in.
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

export interface VisionResultItem {
  imageIndex: number;
  kind: string;
  confidence: number;
  description?: string;
}

/**
 * Extract the first JSON array from a raw Claude text response.
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

// ── Vision prompt ─────────────────────────────────────────────────────────────

const VISION_SYSTEM =
  'You identify visual and graphical elements in images extracted from official document pages. ' +
  'Be precise. Do not guess element types. ' +
  "If you cannot confidently classify an image, use 'unknown_image'.";

function buildVisionPrompt(imageCount: number): string {
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
    '- Scan: header, footer, centre, margins, signature zones, page corners\n' +
    '- Omit elements with confidence < 0.35\n' +
    '- Do not translate document text\n' +
    '- Do not add elements for plain printed URLs (those are not visual graphics)\n' +
    'Response: JSON array only.'
  );
}

// ── Per-page classification ───────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

  let lastError: Error = new Error('Vision analysis failed');

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** attempt);

    try {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: VISION_SYSTEM,
        messages: [
          {
            role: 'user',
            content: [
              ...imageBlocks,
              { type: 'text', text: buildVisionPrompt(images.length) },
            ],
          },
        ],
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
      console.warn(
        `[page-vision] page ${pageNum} attempt ${attempt + 1} failed: ${lastError.message}`,
      );
    }
  }

  throw lastError;
}

// ── Deduplication ─────────────────────────────────────────────────────────────

/**
 * Dedup by page + kind + position — preserves two physical objects of the same
 * kind at different positions (e.g., two signatures at lower_left and lower_right).
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
 * Analyze all pages that have extracted images.
 * Maximum one Claude vision call per page.
 * Returns [] on total failure so the caller can fall back to markdown markers.
 *
 * The optional `_anthropic` parameter is only for unit tests (dependency injection).
 * In production the shared lazy client is used.
 */
export async function analyzeDocumentVisuals(
  pages: MistralPageWithImages[],
  _anthropic?: Anthropic,
): Promise<VisualElement[]> {
  const anthropic = _anthropic ?? getClient();
  const allElements: VisualElement[] = [];

  for (const page of pages) {
    const pageNum = page.index + 1; // 1-based for display
    const imagesWithData = page.images.filter((img) => img.image_base64);

    if (imagesWithData.length === 0) {
      console.log(`[page-vision] page ${pageNum}: 0 extractable images — skipping`);
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
        `[page-vision] page ${pageNum}: ${imagesWithData.length} images analyzed,` +
          ` ${elements.length} elements — kinds=[${elements.map((e) => e.kind).join(',')}]`,
      );
      allElements.push(...elements);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[page-vision] page ${pageNum} failed (non-fatal): ${msg}`);
    }
  }

  return deduplicatePageVision(allElements);
}
