/**
 * @jest-environment node
 *
 * Unit tests for page-vision.ts.
 *
 * Pure functions (bboxToPosition, parseVisionResponse, parsePdfVisionResponse)
 * are tested directly with no mocking.
 *
 * analyzeDocumentVisuals uses the optional _anthropic DI parameter to inject a
 * mock client so no real API calls are made.
 *
 * PRIMARY path: Claude document block (full-page PDF vision).
 *   Mock returns {"pages":[{"page":1,"elements":[...]}]} → elements used.
 *
 * SECONDARY fallback: Mistral-extracted raster images.
 *   Triggered only when PRIMARY returns 0 AND rawPages have images.
 *   Mock: first call returns empty pages, second call returns image array.
 *
 * Three sanitized regression fixtures (PRIMARY path):
 *   - Employment certificate: logo + watermark + stamp + signature×2 + qr
 *   - Medical report: logo + barcode + accreditation_mark×2
 *   - Receipt/invoice: logo + qr only (no stamp, no signature)
 */

// Mock the env module so process.exit(1) is never called during test setup.
// jest.mock is hoisted by the Jest transform and runs before any imports.
jest.mock('../env', () => ({
  env: { ANTHROPIC_API_KEY: 'test-key-for-page-vision-tests' },
}));

import {
  bboxToPosition,
  parseVisionResponse,
  parsePdfVisionResponse,
  analyzeDocumentVisuals,
} from '../page-vision';
import type { MistralPageWithImages, MistralExtractedImage } from '../ocr';
import type { VisualElement } from '../visual-elements';
import type Anthropic from '@anthropic-ai/sdk';

// ── Shared test helpers ───────────────────────────────────────────────────────

const DIMS_A4 = { dpi: 72, width: 794, height: 1122 };

/** 1×1 transparent PNG — smallest valid base64 for image-path testing. */
const FAKE_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** Minimal valid PDF buffer for testing — used as pdfBuffer argument. */
const FAKE_PDF = Buffer.from(
  '%PDF-1.0\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/MediaBox[0 0 612 792]>>endobj\n' +
  'xref\n0 4\n0000000000 65535 f\n' +
  '0000000009 00000 n\n0000000058 00000 n\n0000000115 00000 n\n' +
  'trailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF',
);

function makeImage(
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): MistralExtractedImage {
  return {
    id, top_left_x: x1, top_left_y: y1, bottom_right_x: x2, bottom_right_y: y2,
    image_base64: FAKE_PNG,
  };
}

function makePage(index: number, images: MistralExtractedImage[]): MistralPageWithImages {
  return { index, images, dimensions: DIMS_A4 };
}

/** Mock client for PRIMARY (full-PDF) path. Returns structured pages JSON. */
function mockClientPrimary(pages: object[]): Anthropic {
  return {
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify({ pages }) }],
      }),
    },
  } as unknown as Anthropic;
}

/** Mock client for SECONDARY fallback path.
 *  First call (PDF vision) returns 0 elements.
 *  Second call (image classification) returns the given items array.
 */
function mockClientFallback(imageItems: object[]): Anthropic {
  const create = jest.fn()
    .mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"pages":[]}' }], // primary → 0 elements
    })
    .mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(imageItems) }], // secondary
    });
  return { messages: { create } } as unknown as Anthropic;
}

function countKind(elements: VisualElement[], kind: string): number {
  return elements.filter((e) => e.kind === kind).length;
}

// ── bboxToPosition ─────────────────────────────────────────────────────────────

describe('bboxToPosition', () => {
  it('upper_left — logo in top-left corner', () =>
    expect(bboxToPosition(
      { top_left_x: 20, top_left_y: 10, bottom_right_x: 200, bottom_right_y: 120 }, DIMS_A4,
    )).toBe('upper_left'));

  it('upper_right', () =>
    expect(bboxToPosition(
      { top_left_x: 560, top_left_y: 20, bottom_right_x: 760, bottom_right_y: 150 }, DIMS_A4,
    )).toBe('upper_right'));

  it('upper_center', () =>
    expect(bboxToPosition(
      { top_left_x: 300, top_left_y: 20, bottom_right_x: 500, bottom_right_y: 180 }, DIMS_A4,
    )).toBe('upper_center'));

  it('lower_left — first signature', () =>
    expect(bboxToPosition(
      { top_left_x: 30, top_left_y: 850, bottom_right_x: 200, bottom_right_y: 980 }, DIMS_A4,
    )).toBe('lower_left'));

  it('lower_right — second signature', () =>
    expect(bboxToPosition(
      { top_left_x: 560, top_left_y: 850, bottom_right_x: 760, bottom_right_y: 980 }, DIMS_A4,
    )).toBe('lower_right'));

  it('lower_center — stamp', () =>
    expect(bboxToPosition(
      { top_left_x: 320, top_left_y: 880, bottom_right_x: 480, bottom_right_y: 1050 }, DIMS_A4,
    )).toBe('lower_center'));

  it('center — watermark covering middle area', () =>
    expect(bboxToPosition(
      { top_left_x: 250, top_left_y: 380, bottom_right_x: 550, bottom_right_y: 700 }, DIMS_A4,
    )).toBe('center'));

  it('full_page — image wider than 80% of page', () =>
    expect(bboxToPosition(
      { top_left_x: 10, top_left_y: 400, bottom_right_x: 784, bottom_right_y: 700 }, DIMS_A4,
    )).toBe('full_page'));

  it('center_left', () =>
    expect(bboxToPosition(
      { top_left_x: 20, top_left_y: 480, bottom_right_x: 180, bottom_right_y: 640 }, DIMS_A4,
    )).toBe('center_left'));

  it('center_right', () =>
    expect(bboxToPosition(
      { top_left_x: 620, top_left_y: 480, bottom_right_x: 780, bottom_right_y: 640 }, DIMS_A4,
    )).toBe('center_right'));
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
    expect(parseVisionResponse(text)[0]!.kind).toBe('stamp');
  });

  it('returns [] when no JSON array is present', () =>
    expect(parseVisionResponse('No array here.')).toEqual([]));

  it('returns [] on invalid JSON', () =>
    expect(parseVisionResponse('[{invalid json]')).toEqual([]));

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

  it('returns [] for empty array', () =>
    expect(parseVisionResponse('[]')).toEqual([]));
});

// ── parsePdfVisionResponse ────────────────────────────────────────────────────

describe('parsePdfVisionResponse', () => {
  it('parses valid pages/elements JSON', () => {
    const text = JSON.stringify({
      pages: [{ page: 1, elements: [{ kind: 'logo', position: 'upper_left', confidence: 0.95 }] }],
    });
    const result = parsePdfVisionResponse(text);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ page: 1, kind: 'logo', position: 'upper_left' });
  });

  it('sets source=pdf_image_extraction on every element', () => {
    const text = JSON.stringify({
      pages: [{ page: 1, elements: [{ kind: 'stamp', position: 'lower_center', confidence: 0.9 }] }],
    });
    expect(parsePdfVisionResponse(text)[0]!.source).toBe('pdf_image_extraction');
  });

  it('omits elements below confidence threshold (0.35)', () => {
    const text = JSON.stringify({
      pages: [{
        page: 1,
        elements: [
          { kind: 'logo', position: 'upper_left', confidence: 0.95 },
          { kind: 'stamp', position: 'lower_center', confidence: 0.20 },
        ],
      }],
    });
    expect(parsePdfVisionResponse(text)).toHaveLength(1);
  });

  it('maps unknown kind to unknown_image', () => {
    const text = JSON.stringify({
      pages: [{ page: 1, elements: [{ kind: 'sticker_bomb', position: 'center', confidence: 0.8 }] }],
    });
    expect(parsePdfVisionResponse(text)[0]!.kind).toBe('unknown_image');
  });

  it('maps unknown position to undefined', () => {
    const text = JSON.stringify({
      pages: [{ page: 1, elements: [{ kind: 'logo', position: 'behind_the_scenes', confidence: 0.9 }] }],
    });
    expect(parsePdfVisionResponse(text)[0]!.position).toBeUndefined();
  });

  it('returns [] for missing pages array', () =>
    expect(parsePdfVisionResponse('{"data":"whatever"}')).toEqual([]));

  it('returns [] for unparseable text', () =>
    expect(parsePdfVisionResponse('not json at all')).toEqual([]));

  it('deduplicates elements at same page+kind+position', () => {
    const text = JSON.stringify({
      pages: [{
        page: 1,
        elements: [
          { kind: 'logo', position: 'upper_left', confidence: 0.95 },
          { kind: 'logo', position: 'upper_left', confidence: 0.90 }, // duplicate
        ],
      }],
    });
    expect(parsePdfVisionResponse(text)).toHaveLength(1);
  });

  it('preserves two elements of same kind at different positions', () => {
    const text = JSON.stringify({
      pages: [{
        page: 1,
        elements: [
          { kind: 'signature', position: 'lower_left', confidence: 0.92 },
          { kind: 'signature', position: 'lower_right', confidence: 0.88 },
        ],
      }],
    });
    expect(parsePdfVisionResponse(text)).toHaveLength(2);
  });

  it('truncates description to 60 chars', () => {
    const longDesc = 'A'.repeat(100);
    const text = JSON.stringify({
      pages: [{ page: 1, elements: [{ kind: 'logo', position: 'upper_left', confidence: 0.9, description: longDesc }] }],
    });
    expect(parsePdfVisionResponse(text)[0]!.description?.length).toBeLessThanOrEqual(60);
  });
});

// ── Regression fixture 1: employment certificate (PRIMARY path) ───────────────

describe('analyzeDocumentVisuals — employment certificate (primary)', () => {
  /**
   * Sanitized employment certificate fixture via PRIMARY (full-PDF vision):
   *   logo=1 (upper_left), watermark=1 (center), stamp=1 (lower_center),
   *   signature=2 (lower_left + lower_right), qr=1 (lower_right)
   */
  const CLIENT = mockClientPrimary([{
    page: 1,
    elements: [
      { kind: 'logo',      position: 'upper_left',   confidence: 0.95, description: 'Organization logo' },
      { kind: 'watermark', position: 'center',        confidence: 0.90, description: 'Diagonal watermark' },
      { kind: 'stamp',     position: 'lower_center',  confidence: 0.92, description: 'Round seal' },
      { kind: 'signature', position: 'lower_left',    confidence: 0.88, description: 'HR manager' },
      { kind: 'signature', position: 'lower_right',   confidence: 0.87, description: 'Chief accountant' },
      { kind: 'qr',        position: 'lower_right',   confidence: 0.97, description: 'Verification QR' },
    ],
  }]);

  let elements: VisualElement[];
  beforeAll(async () => { elements = await analyzeDocumentVisuals([], FAKE_PDF, 'it', CLIENT); });

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

  it('all elements page = 1', () =>
    expect(elements.every((e) => e.page === 1)).toBe(true));

  it('all elements source = pdf_image_extraction', () =>
    expect(elements.every((e) => e.source === 'pdf_image_extraction')).toBe(true));
});

// ── Regression fixture 2: medical report (PRIMARY path) ──────────────────────

describe('analyzeDocumentVisuals — medical report (primary)', () => {
  const CLIENT = mockClientPrimary([{
    page: 1,
    elements: [
      { kind: 'logo',              position: 'upper_left',   confidence: 0.93 },
      { kind: 'barcode',           position: 'upper_right',  confidence: 0.98 },
      { kind: 'accreditation_mark', position: 'lower_left',  confidence: 0.85 },
      { kind: 'accreditation_mark', position: 'lower_right', confidence: 0.84 },
    ],
  }]);

  let elements: VisualElement[];
  beforeAll(async () => { elements = await analyzeDocumentVisuals([], FAKE_PDF, 'it', CLIENT); });

  it('logo count = 1', () => expect(countKind(elements, 'logo')).toBe(1));
  it('barcode count = 1', () => expect(countKind(elements, 'barcode')).toBe(1));
  it('accreditation_mark count = 2', () => expect(countKind(elements, 'accreditation_mark')).toBe(2));
  it('no stamp', () => expect(countKind(elements, 'stamp')).toBe(0));
  it('no signature', () => expect(countKind(elements, 'signature')).toBe(0));
  it('total = 4 elements', () => expect(elements).toHaveLength(4));
});

// ── Regression fixture 3: receipt / invoice (PRIMARY path) ───────────────────

describe('analyzeDocumentVisuals — receipt / invoice (primary)', () => {
  const CLIENT = mockClientPrimary([{
    page: 1,
    elements: [
      { kind: 'logo', position: 'upper_left',  confidence: 0.92 },
      { kind: 'qr',   position: 'lower_right', confidence: 0.97 },
    ],
  }]);

  let elements: VisualElement[];
  beforeAll(async () => { elements = await analyzeDocumentVisuals([], FAKE_PDF, 'it', CLIENT); });

  it('logo count = 1', () => expect(countKind(elements, 'logo')).toBe(1));
  it('qr count = 1', () => expect(countKind(elements, 'qr')).toBe(1));
  it('no stamp', () => expect(countKind(elements, 'stamp')).toBe(0));
  it('no signature', () => expect(countKind(elements, 'signature')).toBe(0));
  it('total = 2 elements', () => expect(elements).toHaveLength(2));
});

// ── Confidence threshold and kind mapping (PRIMARY path) ─────────────────────

describe('analyzeDocumentVisuals — filtering (primary)', () => {
  it('omits elements below 0.35 confidence', async () => {
    const client = mockClientPrimary([{
      page: 1,
      elements: [
        { kind: 'logo',  position: 'upper_left',  confidence: 0.90 },
        { kind: 'stamp', position: 'lower_center', confidence: 0.20 }, // below threshold
      ],
    }]);
    const elements = await analyzeDocumentVisuals([], FAKE_PDF, 'it', client);
    expect(elements).toHaveLength(1);
    expect(elements[0]!.kind).toBe('logo');
  });

  it('maps unknown kind string to unknown_image', async () => {
    const client = mockClientPrimary([{
      page: 1,
      elements: [{ kind: 'abstract_painting', position: 'center', confidence: 0.80 }],
    }]);
    const elements = await analyzeDocumentVisuals([], FAKE_PDF, 'it', client);
    expect(elements[0]!.kind).toBe('unknown_image');
  });
});

// ── SECONDARY fallback path ───────────────────────────────────────────────────

describe('analyzeDocumentVisuals — secondary fallback', () => {
  it('falls back to extracted images when primary returns 0 elements', async () => {
    const page = makePage(0, [makeImage('img_0', 20, 10, 200, 120)]);
    const client = mockClientFallback([
      { imageIndex: 0, kind: 'logo', confidence: 0.92, description: 'Company logo' },
    ]);
    const elements = await analyzeDocumentVisuals([page], FAKE_PDF, 'it', client);
    expect(elements).toHaveLength(1);
    expect(elements[0]!.kind).toBe('logo');
    expect((client.messages.create as jest.Mock)).toHaveBeenCalledTimes(2);
  });

  it('returns [] when primary returns 0 and rawPages have no images', async () => {
    const client = mockClientPrimary([{ page: 1, elements: [] }]); // primary → 0
    // rawPages empty → secondary skips → total 0
    const elements = await analyzeDocumentVisuals([], FAKE_PDF, 'it', client);
    expect(elements).toEqual([]);
  });
});

// ── One PDF call for the whole document ───────────────────────────────────────

describe('analyzeDocumentVisuals — one PDF vision call for whole document', () => {
  it('makes exactly 1 API call for a 1-page document', async () => {
    const create = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: '{"pages":[]}' }],
    });
    const client = { messages: { create } } as unknown as Anthropic;
    await analyzeDocumentVisuals([], FAKE_PDF, 'it', client);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('makes exactly 1 API call even for a multi-page document', async () => {
    const create = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: '{"pages":[]}' }],
    });
    const client = { messages: { create } } as unknown as Anthropic;
    const multiPageRawPages = [makePage(0, []), makePage(1, []), makePage(2, [])];
    await analyzeDocumentVisuals(multiPageRawPages, FAKE_PDF, 'it', client);
    // Only 1 call regardless of page count (whole PDF sent at once)
    expect(create).toHaveBeenCalledTimes(1);
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe('analyzeDocumentVisuals — error handling', () => {
  it('returns [] without throwing when PDF vision retries all fail', async () => {
    jest.useFakeTimers();
    const create = jest.fn().mockRejectedValue(new Error('API timeout'));
    const client = { messages: { create } } as unknown as Anthropic;

    // rawPages empty so secondary makes 0 additional calls
    const promise = analyzeDocumentVisuals([], FAKE_PDF, 'it', client);
    await jest.runAllTimersAsync();
    const elements = await promise;

    jest.useRealTimers();
    expect(elements).toEqual([]);
    expect(create).toHaveBeenCalledTimes(3); // 3 PDF vision retries
  }, 15000);
});

// ── targetLang is threaded into the vision prompt ─────────────────────────────

describe('analyzeDocumentVisuals — targetLang in prompt', () => {
  it('includes the target language name in the API call user text', async () => {
    const create = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: '{"pages":[]}' }],
    });
    const client = { messages: { create } } as unknown as Anthropic;
    await analyzeDocumentVisuals([], FAKE_PDF, 'it', client);
    const callArgs = (create as jest.Mock).mock.calls[0][0];
    const userText = (callArgs.messages[0].content as {type:string; text?:string}[])
      .find((b) => b.type === 'text')?.text ?? '';
    expect(userText).toContain('Italian');
  });

  it('uses correct language name for Russian target', async () => {
    const create = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: '{"pages":[]}' }],
    });
    const client = { messages: { create } } as unknown as Anthropic;
    await analyzeDocumentVisuals([], FAKE_PDF, 'ru', client);
    const callArgs = (create as jest.Mock).mock.calls[0][0];
    const userText = (callArgs.messages[0].content as {type:string; text?:string}[])
      .find((b) => b.type === 'text')?.text ?? '';
    expect(userText).toContain('Russian');
  });
});

// ── Deduplication (PRIMARY path) ──────────────────────────────────────────────

describe('analyzeDocumentVisuals — deduplication (primary)', () => {
  it('collapses duplicate page+kind+position into one element', async () => {
    const client = mockClientPrimary([{
      page: 1,
      elements: [
        { kind: 'logo', position: 'upper_left', confidence: 0.95 },
        { kind: 'logo', position: 'upper_left', confidence: 0.80 }, // same key — dedup
      ],
    }]);
    const elements = await analyzeDocumentVisuals([], FAKE_PDF, 'it', client);
    expect(countKind(elements, 'logo')).toBe(1);
  });

  it('preserves two signatures at lower_left and lower_right', async () => {
    const client = mockClientPrimary([{
      page: 1,
      elements: [
        { kind: 'signature', position: 'lower_left',  confidence: 0.88 },
        { kind: 'signature', position: 'lower_right', confidence: 0.87 },
      ],
    }]);
    const elements = await analyzeDocumentVisuals([], FAKE_PDF, 'it', client);
    expect(countKind(elements, 'signature')).toBe(2);
    const positions = elements.map((e) => e.position);
    expect(positions).toContain('lower_left');
    expect(positions).toContain('lower_right');
  });
});
