/**
 * @jest-environment node
 *
 * Unit tests for page-vision.ts.
 *
 * bboxToPosition and parseVisionResponse are pure functions — tested directly.
 * analyzeDocumentVisuals uses the optional _anthropic DI parameter to inject a
 * mock client so no real API calls are made.
 *
 * Three sanitized regression fixtures:
 *   - Employment certificate: logo + watermark + stamp + signature×2 + qr
 *   - Medical report: logo + barcode + accreditation_mark×2
 *   - Receipt/invoice: logo + qr only (no stamp, no signature)
 */

// Mock the env module so process.exit(1) is never called during test setup.
// jest.mock is hoisted by the Jest transform and runs before any imports.
jest.mock('../env', () => ({
  env: { ANTHROPIC_API_KEY: 'test-key-for-page-vision-tests' },
}));

import { bboxToPosition, parseVisionResponse, analyzeDocumentVisuals } from '../page-vision';
import type { MistralPageWithImages, MistralExtractedImage } from '../ocr';
import type { VisualElement } from '../visual-elements';
import type Anthropic from '@anthropic-ai/sdk';

// ── Shared test helpers ───────────────────────────────────────────────────────

const DIMS_A4 = { dpi: 72, width: 794, height: 1122 };

/** 1×1 transparent PNG — smallest valid base64 for testing. */
const FAKE_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function makeImage(
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): MistralExtractedImage {
  return { id, top_left_x: x1, top_left_y: y1, bottom_right_x: x2, bottom_right_y: y2, image_base64: FAKE_PNG };
}

function makePage(index: number, images: MistralExtractedImage[]): MistralPageWithImages {
  return { index, images, dimensions: DIMS_A4 };
}

/** Build a minimal Anthropic-shaped mock client that resolves with the given JSON items. */
function mockClient(responseItems: object[]): Anthropic {
  return {
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(responseItems) }],
      }),
    },
  } as unknown as Anthropic;
}

function countKind(elements: VisualElement[], kind: string): number {
  return elements.filter((e) => e.kind === kind).length;
}

// ── bboxToPosition ─────────────────────────────────────────────────────────────

describe('bboxToPosition', () => {
  it('upper_left — logo in top-left corner', () => {
    expect(bboxToPosition(
      { top_left_x: 20, top_left_y: 10, bottom_right_x: 200, bottom_right_y: 120 },
      DIMS_A4,
    )).toBe('upper_left');
  });

  it('upper_right', () => {
    expect(bboxToPosition(
      { top_left_x: 560, top_left_y: 20, bottom_right_x: 760, bottom_right_y: 150 },
      DIMS_A4,
    )).toBe('upper_right');
  });

  it('upper_center', () => {
    expect(bboxToPosition(
      { top_left_x: 300, top_left_y: 20, bottom_right_x: 500, bottom_right_y: 180 },
      DIMS_A4,
    )).toBe('upper_center');
  });

  it('lower_left — first signature', () => {
    expect(bboxToPosition(
      { top_left_x: 30, top_left_y: 850, bottom_right_x: 200, bottom_right_y: 980 },
      DIMS_A4,
    )).toBe('lower_left');
  });

  it('lower_right — second signature', () => {
    expect(bboxToPosition(
      { top_left_x: 560, top_left_y: 850, bottom_right_x: 760, bottom_right_y: 980 },
      DIMS_A4,
    )).toBe('lower_right');
  });

  it('lower_center — stamp', () => {
    expect(bboxToPosition(
      { top_left_x: 320, top_left_y: 880, bottom_right_x: 480, bottom_right_y: 1050 },
      DIMS_A4,
    )).toBe('lower_center');
  });

  it('center — watermark covering middle area', () => {
    expect(bboxToPosition(
      { top_left_x: 250, top_left_y: 380, bottom_right_x: 550, bottom_right_y: 700 },
      DIMS_A4,
    )).toBe('center');
  });

  it('full_page — image wider than 80% of page', () => {
    expect(bboxToPosition(
      { top_left_x: 10, top_left_y: 400, bottom_right_x: 784, bottom_right_y: 700 },
      DIMS_A4,
    )).toBe('full_page');
  });

  it('center_left', () => {
    expect(bboxToPosition(
      { top_left_x: 20, top_left_y: 480, bottom_right_x: 180, bottom_right_y: 640 },
      DIMS_A4,
    )).toBe('center_left');
  });

  it('center_right', () => {
    expect(bboxToPosition(
      { top_left_x: 620, top_left_y: 480, bottom_right_x: 780, bottom_right_y: 640 },
      DIMS_A4,
    )).toBe('center_right');
  });
});

// ── parseVisionResponse ───────────────────────────────────────────────────────

describe('parseVisionResponse', () => {
  it('parses a valid JSON array', () => {
    const json = '[{"imageIndex":0,"kind":"logo","confidence":0.95,"description":"Company logo"}]';
    const result = parseVisionResponse(json);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ imageIndex: 0, kind: 'logo', confidence: 0.95 });
  });

  it('extracts JSON array embedded in prose text', () => {
    const text = 'Analysis:\n[{"imageIndex":0,"kind":"stamp","confidence":0.88}]\nDone.';
    const result = parseVisionResponse(text);
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe('stamp');
  });

  it('returns [] when no JSON array is present', () => {
    expect(parseVisionResponse('No array here.')).toEqual([]);
  });

  it('returns [] on invalid JSON', () => {
    expect(parseVisionResponse('[{invalid json]')).toEqual([]);
  });

  it('filters out items missing required fields', () => {
    const json = '[{"kind":"logo"},{"imageIndex":0,"confidence":0.9}]';
    expect(parseVisionResponse(json)).toEqual([]);
  });

  it('keeps valid items and drops invalid ones', () => {
    const json =
      '[{"imageIndex":0,"kind":"logo","confidence":0.9},' +
      '{"bad":"item"},' +
      '{"imageIndex":1,"kind":"stamp","confidence":0.8}]';
    expect(parseVisionResponse(json)).toHaveLength(2);
  });

  it('returns [] for empty array', () => {
    expect(parseVisionResponse('[]')).toEqual([]);
  });
});

// ── Regression fixture 1: employment certificate ──────────────────────────────

describe('analyzeDocumentVisuals — employment certificate', () => {
  /**
   * Sanitized employment certificate fixture:
   *   img_0 upper_left  → logo
   *   img_1 center      → watermark (diagonal background overlay)
   *   img_2 lower_center → stamp
   *   img_3 lower_left  → signature #1 (HR manager)
   *   img_4 lower_right → signature #2 (chief accountant)
   *   img_5 lower_right → qr code
   *
   * Expectations (fixed counts, not hardcoded document names):
   *   logo=1, watermark=1, stamp=1, signature=2, qr=1
   */

  const PAGE = makePage(0, [
    makeImage('img_0', 20, 10, 200, 120),    // upper_left
    makeImage('img_1', 150, 300, 650, 850),  // center (wide diagonal)
    makeImage('img_2', 320, 880, 480, 1050), // lower_center
    makeImage('img_3', 30, 850, 200, 980),   // lower_left
    makeImage('img_4', 560, 850, 760, 980),  // lower_right
    makeImage('img_5', 620, 950, 760, 1090), // lower_right (slightly below sig)
  ]);

  const CLIENT = mockClient([
    { imageIndex: 0, kind: 'logo',      confidence: 0.95, description: 'Organization logo' },
    { imageIndex: 1, kind: 'watermark', confidence: 0.90, description: 'Diagonal watermark' },
    { imageIndex: 2, kind: 'stamp',     confidence: 0.92, description: 'Round organizational seal' },
    { imageIndex: 3, kind: 'signature', confidence: 0.88, description: 'HR manager signature' },
    { imageIndex: 4, kind: 'signature', confidence: 0.87, description: 'Chief accountant signature' },
    { imageIndex: 5, kind: 'qr',        confidence: 0.97, description: 'Verification QR code' },
  ]);

  let elements: VisualElement[];
  beforeAll(async () => { elements = await analyzeDocumentVisuals([PAGE], CLIENT); });

  it('logo count = 1', () => expect(countKind(elements, 'logo')).toBe(1));
  it('watermark count = 1', () => expect(countKind(elements, 'watermark')).toBe(1));
  it('stamp count = 1', () => expect(countKind(elements, 'stamp')).toBe(1));
  it('signature count = 2', () => expect(countKind(elements, 'signature')).toBe(2));
  it('qr count = 1', () => expect(countKind(elements, 'qr')).toBe(1));
  it('total = 6 elements', () => expect(elements).toHaveLength(6));

  it('two signatures are at distinct positions', () => {
    const positions = elements.filter((e) => e.kind === 'signature').map((e) => e.position);
    expect(positions).toContain('lower_left');
    expect(positions).toContain('lower_right');
  });

  it('all elements page = 1', () => {
    expect(elements.every((e) => e.page === 1)).toBe(true);
  });

  it('all elements source = pdf_image_extraction', () => {
    expect(elements.every((e) => e.source === 'pdf_image_extraction')).toBe(true);
  });

  it('logo position = upper_left', () => {
    expect(elements.find((e) => e.kind === 'logo')?.position).toBe('upper_left');
  });

  it('stamp position = lower_center', () => {
    expect(elements.find((e) => e.kind === 'stamp')?.position).toBe('lower_center');
  });
});

// ── Regression fixture 2: medical report ─────────────────────────────────────

describe('analyzeDocumentVisuals — medical report', () => {
  /**
   * Sanitized medical report fixture:
   *   logo (upper_left)
   *   barcode (upper_right) — patient sample ID
   *   accreditation_mark (lower_left) — ISO mark
   *   accreditation_mark (lower_right) — Ministry mark
   *
   * MUST NOT classify accreditation marks as stamp or signature.
   */

  const PAGE = makePage(0, [
    makeImage('img_0', 20, 10, 200, 120),    // upper_left
    makeImage('img_1', 600, 10, 770, 80),    // upper_right
    makeImage('img_2', 20, 900, 180, 1060),  // lower_left
    makeImage('img_3', 600, 900, 760, 1060), // lower_right
  ]);

  const CLIENT = mockClient([
    { imageIndex: 0, kind: 'logo',              confidence: 0.93, description: 'Clinic logo' },
    { imageIndex: 1, kind: 'barcode',            confidence: 0.98, description: 'Sample barcode' },
    { imageIndex: 2, kind: 'accreditation_mark', confidence: 0.85, description: 'ISO 15189' },
    { imageIndex: 3, kind: 'accreditation_mark', confidence: 0.84, description: 'Ministry certificate' },
  ]);

  let elements: VisualElement[];
  beforeAll(async () => { elements = await analyzeDocumentVisuals([PAGE], CLIENT); });

  it('logo count = 1', () => expect(countKind(elements, 'logo')).toBe(1));
  it('barcode count = 1', () => expect(countKind(elements, 'barcode')).toBe(1));
  it('accreditation_mark count = 2', () => expect(countKind(elements, 'accreditation_mark')).toBe(2));
  it('no stamp', () => expect(countKind(elements, 'stamp')).toBe(0));
  it('no signature', () => expect(countKind(elements, 'signature')).toBe(0));
  it('total = 4 elements', () => expect(elements).toHaveLength(4));
  it('two accreditation marks at distinct positions', () => {
    const positions = elements
      .filter((e) => e.kind === 'accreditation_mark')
      .map((e) => e.position);
    expect(new Set(positions).size).toBe(2);
  });
});

// ── Regression fixture 3: receipt / invoice ───────────────────────────────────

describe('analyzeDocumentVisuals — receipt / invoice', () => {
  /**
   * Sanitized receipt fixture:
   *   logo (upper_left)
   *   qr (lower_right) — payment QR
   *
   * MUST NOT invent stamp or signature when absent.
   */

  const PAGE = makePage(0, [
    makeImage('img_0', 20, 10, 200, 120),    // upper_left
    makeImage('img_1', 600, 900, 760, 1060), // lower_right
  ]);

  const CLIENT = mockClient([
    { imageIndex: 0, kind: 'logo', confidence: 0.92, description: 'Company logo' },
    { imageIndex: 1, kind: 'qr',   confidence: 0.97, description: 'Payment QR code' },
  ]);

  let elements: VisualElement[];
  beforeAll(async () => { elements = await analyzeDocumentVisuals([PAGE], CLIENT); });

  it('logo count = 1', () => expect(countKind(elements, 'logo')).toBe(1));
  it('qr count = 1', () => expect(countKind(elements, 'qr')).toBe(1));
  it('no stamp', () => expect(countKind(elements, 'stamp')).toBe(0));
  it('no signature', () => expect(countKind(elements, 'signature')).toBe(0));
  it('total = 2 elements', () => expect(elements).toHaveLength(2));
});

// ── Confidence threshold filtering ────────────────────────────────────────────

describe('analyzeDocumentVisuals — confidence threshold', () => {
  it('omits elements below 0.35 confidence', async () => {
    const page = makePage(0, [
      makeImage('img_0', 20, 10, 200, 120),
      makeImage('img_1', 300, 10, 500, 120),
    ]);
    const client = mockClient([
      { imageIndex: 0, kind: 'logo',  confidence: 0.90 },
      { imageIndex: 1, kind: 'stamp', confidence: 0.20 }, // below threshold
    ]);
    const elements = await analyzeDocumentVisuals([page], client);
    expect(elements).toHaveLength(1);
    expect(elements[0]!.kind).toBe('logo');
  });

  it('maps unknown kind string to unknown_image', async () => {
    const page = makePage(0, [makeImage('img_0', 20, 10, 200, 120)]);
    const client = mockClient([{ imageIndex: 0, kind: 'abstract_painting', confidence: 0.80 }]);
    const elements = await analyzeDocumentVisuals([page], client);
    expect(elements).toHaveLength(1);
    expect(elements[0]!.kind).toBe('unknown_image');
  });
});

// ── No images ─────────────────────────────────────────────────────────────────

describe('analyzeDocumentVisuals — pages with no images', () => {
  it('returns [] without any API call when no images on page', async () => {
    const mockCreate = jest.fn();
    const client = { messages: { create: mockCreate } } as unknown as Anthropic;
    const page: MistralPageWithImages = { index: 0, images: [], dimensions: DIMS_A4 };
    const elements = await analyzeDocumentVisuals([page], client);
    expect(elements).toEqual([]);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns [] without any API call when images have no base64 data', async () => {
    const mockCreate = jest.fn();
    const client = { messages: { create: mockCreate } } as unknown as Anthropic;
    const imgNoBase64: MistralExtractedImage = {
      id: 'img_0',
      top_left_x: 20, top_left_y: 10, bottom_right_x: 200, bottom_right_y: 120,
    };
    const page = makePage(0, [imgNoBase64]);
    const elements = await analyzeDocumentVisuals([page], client);
    expect(elements).toEqual([]);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe('analyzeDocumentVisuals — error handling', () => {
  it('returns [] without throwing when all retries fail', async () => {
    jest.useFakeTimers();
    const create = jest.fn().mockRejectedValue(new Error('API timeout'));
    const client = { messages: { create } } as unknown as Anthropic;
    const page = makePage(0, [makeImage('img_0', 20, 10, 200, 120)]);

    const promise = analyzeDocumentVisuals([page], client);
    // Advance past all retry backoff delays (2s + 4s = 6s total)
    await jest.runAllTimersAsync();
    const elements = await promise;

    jest.useRealTimers();
    expect(elements).toEqual([]);
    expect(create).toHaveBeenCalledTimes(3); // 3 retries exhausted
  }, 15000);
});

// ── Deduplication by page + kind + position ───────────────────────────────────

describe('analyzeDocumentVisuals — deduplication', () => {
  it('collapses two elements at same page+kind+position into one', async () => {
    const page = makePage(0, [
      makeImage('img_0', 20, 10, 200, 120),  // upper_left
      makeImage('img_1', 25, 15, 205, 125),  // also resolves to upper_left
    ]);
    const client = mockClient([
      { imageIndex: 0, kind: 'logo', confidence: 0.90, description: 'Logo A' },
      { imageIndex: 1, kind: 'logo', confidence: 0.85, description: 'Logo B' },
    ]);
    const elements = await analyzeDocumentVisuals([page], client);
    expect(countKind(elements, 'logo')).toBe(1);
  });

  it('preserves two signatures at lower_left and lower_right', async () => {
    const page = makePage(0, [
      makeImage('img_0', 30, 850, 200, 980),  // lower_left
      makeImage('img_1', 560, 850, 760, 980), // lower_right
    ]);
    const client = mockClient([
      { imageIndex: 0, kind: 'signature', confidence: 0.88 },
      { imageIndex: 1, kind: 'signature', confidence: 0.87 },
    ]);
    const elements = await analyzeDocumentVisuals([page], client);
    expect(countKind(elements, 'signature')).toBe(2);
    const positions = elements.map((e) => e.position);
    expect(positions).toContain('lower_left');
    expect(positions).toContain('lower_right');
  });
});

// ── Max one call per page ─────────────────────────────────────────────────────

describe('analyzeDocumentVisuals — exactly one API call per page', () => {
  it('makes 1 call for a 1-page document with 6 images', async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: '[]' }],
    });
    const client = { messages: { create: mockCreate } } as unknown as Anthropic;

    const page = makePage(0, [
      makeImage('img_0', 20, 10, 200, 120),
      makeImage('img_1', 150, 300, 650, 850),
      makeImage('img_2', 320, 880, 480, 1050),
      makeImage('img_3', 30, 850, 200, 980),
      makeImage('img_4', 560, 850, 760, 980),
      makeImage('img_5', 620, 950, 760, 1090),
    ]);

    await analyzeDocumentVisuals([page], client);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('makes 3 calls for a 3-page document (1 call per page)', async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: '[]' }],
    });
    const client = { messages: { create: mockCreate } } as unknown as Anthropic;

    const pages = [
      makePage(0, [makeImage('img_0', 20, 10, 200, 120)]),
      makePage(1, [makeImage('img_0', 20, 10, 200, 120)]),
      makePage(2, [makeImage('img_0', 20, 10, 200, 120)]),
    ];

    await analyzeDocumentVisuals(pages, client);
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });
});
