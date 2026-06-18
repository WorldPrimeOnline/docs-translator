import Anthropic from '@anthropic-ai/sdk';
import { env } from './env';
import type { DetectedVisualElement, VisualPosition, VisualElementKindExtended, BoundingBox } from './detected-visual-element';

const MODEL = 'claude-sonnet-4-6';
const MAX_RETRIES = 2;
const MAX_PAGES_WARN = 20;

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// Tool schema for structured visual element detection
const DETECT_VISUAL_ELEMENTS_TOOL: Anthropic.Tool = {
  name: 'detect_document_visual_elements',
  description:
    'Report all clearly visible non-text visual elements found in the document. ' +
    'Only report elements that are actually present and visible. ' +
    'Do not invent or assume elements. ' +
    'Report each distinct occurrence separately — if there are two signatures, report two entries.',
  input_schema: {
    type: 'object' as const,
    properties: {
      pages: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            page: { type: 'number', description: '1-based page number' },
            elements: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  kind: {
                    type: 'string',
                    enum: [
                      'logo', 'emblem', 'photo', 'qr', 'barcode',
                      'stamp', 'signature', 'watermark', 'handwritten_note',
                      'electronic_approval', 'unknown_image',
                    ],
                    description: 'Type of visual element',
                  },
                  position: {
                    type: 'string',
                    enum: [
                      'header', 'upper_left', 'upper_right', 'center',
                      'lower_left', 'lower_center', 'lower_right', 'footer', 'unknown',
                    ],
                    description: 'Approximate position on the page. Use lower_center for elements in the lower-middle area.',
                  },
                  description: {
                    type: 'string',
                    description: 'One short factual sentence about the element type and shape only. Do not speculate about colors, materials, legal status, or artistic style. Do not include text already captured in visibleText.',
                  },
                  visibleText: {
                    type: 'string',
                    description: 'Exact text clearly readable within the element. Required for watermarks, stamps with readable text, handwritten notes. Omit field entirely if no text is legible.',
                  },
                  confidence: {
                    type: 'number',
                    description: 'Confidence 0.0–1.0 that this element is present and correctly classified',
                  },
                  bbox: {
                    type: 'object',
                    description: 'Bounding box as fractions of page dimensions (0.0–1.0)',
                    properties: {
                      x: { type: 'number' },
                      y: { type: 'number' },
                      width: { type: 'number' },
                      height: { type: 'number' },
                    },
                    required: ['x', 'y', 'width', 'height'],
                  },
                },
                required: ['kind', 'position', 'confidence'],
              },
            },
          },
          required: ['page', 'elements'],
        },
      },
    },
    required: ['pages'],
  },
};

interface VisionPageElement {
  kind: string;
  position: string;
  description?: string;
  visibleText?: string;
  confidence: number;
  bbox?: { x: number; y: number; width: number; height: number };
}

interface VisionToolOutput {
  pages: Array<{
    page: number;
    elements: VisionPageElement[];
  }>;
}

/**
 * Analyze PDF visually using Anthropic's document vision capabilities.
 * Returns detected visual elements per page.
 * Non-fatal: throws on failure — caller must handle with try/catch.
 */
export async function analyzeDocumentVisuals(
  pdfBuffer: Buffer,
  pageCount: number,
): Promise<DetectedVisualElement[]> {
  if (pageCount > MAX_PAGES_WARN) {
    console.warn(`[page-vision] document has ${pageCount} pages — analyzing full PDF`);
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const pdfBase64 = pdfBuffer.toString('base64');

  let lastError: Error = new Error('Visual analysis failed after all retries');

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(2000 * attempt);

    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        tools: [DETECT_VISUAL_ELEMENTS_TOOL],
        tool_choice: { type: 'tool', name: 'detect_document_visual_elements' },
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: pdfBase64,
                },
              } as unknown as Anthropic.ContentBlockParam,
              {
                type: 'text',
                text:
                  `Analyze this ${pageCount}-page official document for non-text visual elements. ` +
                  `Report ONLY clearly visible elements: logos, stamps, signatures, QR codes, photos, watermarks, barcodes, emblems, handwritten notes, electronic approval marks. ` +
                  `Rules for reporting:\n` +
                  `- Report each distinct occurrence as a separate entry.\n` +
                  `- If there are two signatures (e.g., director and accountant), report two separate signature entries with different positions.\n` +
                  `- description: one short factual sentence. Do NOT speculate about colors, materials, artistic style, or legal status. Describe only what is objectively visible.\n` +
                  `- visibleText: capture only text that is clearly legible within the element (e.g., stamp text, watermark text, handwritten text). If no text is clearly readable, omit the field entirely.\n` +
                  `- Do not include text from outside the element in visibleText.\n` +
                  `- Use lower_center (not center) for elements in the lower-middle area of the page.\n` +
                  `- Do not report plain text content as visual elements.\n` +
                  `- Do not invent elements that are not clearly visible.`,
              },
            ],
          },
        ],
      });

      const toolUse = response.content.find(b => b.type === 'tool_use');
      if (!toolUse || toolUse.type !== 'tool_use') {
        throw new Error('Vision model did not return a tool_use block');
      }

      const output = toolUse.input as VisionToolOutput;
      if (!output?.pages || !Array.isArray(output.pages)) {
        throw new Error('Vision tool output missing pages array');
      }

      const elements: DetectedVisualElement[] = [];
      const kindPageCounters: Record<string, number> = {};

      for (const page of output.pages) {
        if (typeof page.page !== 'number') continue;
        const pageElements = Array.isArray(page.elements) ? page.elements : [];

        for (const el of pageElements) {
          if (typeof el.confidence !== 'number' || el.confidence < 0.5) continue;

          const kindKey = `${page.page}:${el.kind}`;
          const occ = kindPageCounters[kindKey] ?? 0;
          kindPageCounters[kindKey] = occ + 1;

          elements.push({
            id: `vision_${elements.length + 1}`,
            page: page.page,
            kind: el.kind as VisualElementKindExtended,
            occurrenceIndex: occ,
            position: (el.position as VisualPosition) ?? 'unknown',
            description: typeof el.description === 'string' ? el.description : undefined,
            visibleText: typeof el.visibleText === 'string' ? el.visibleText : undefined,
            confidence: el.confidence,
            bbox: el.bbox as BoundingBox | undefined,
            source: 'page_vision',
          });
        }
      }

      console.log(
        `[page-vision] attempt ${attempt + 1} ok — ` +
        `${elements.length} elements across ${output.pages.length} pages`,
      );

      return elements;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[page-vision] attempt ${attempt + 1} failed: ${lastError.message}`);
    }
  }

  throw lastError;
}
