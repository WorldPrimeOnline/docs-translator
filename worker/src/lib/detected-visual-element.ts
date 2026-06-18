import type { VisualElement } from './visual-elements';

// ─── Visual text evidence ─────────────────────────────────────────────────────

export type VisualTextSelectionMethod =
  | 'ocr_exact'
  | 'vision_exact'
  | 'ocr_vision_agreement'
  | 'uncertain';

/**
 * Tracks the provenance of visible text found on a visual element.
 * Separates the CONFIRMED SOURCE TEXT from its translation so the two
 * are never mixed and the model cannot hallucinate source content.
 */
export interface VisualTextEvidence {
  ocrText?: string;
  visionText?: string;
  /** The authoritative source text selected from OCR/vision evidence. */
  selectedSourceText?: string;
  /** Translation filled by the model — never guessed from source alone. */
  translatedText?: string;
  confidence: number;
  selectionMethod: VisualTextSelectionMethod;
}

export type VisualElementKindExtended =
  | 'logo'
  | 'emblem'
  | 'photo'
  | 'qr'
  | 'barcode'
  | 'stamp'
  | 'signature'
  | 'watermark'
  | 'handwritten_note'
  | 'electronic_approval'
  | 'unknown_image';

export type VisualPosition =
  | 'header'
  | 'upper_left'
  | 'upper_right'
  | 'center'
  | 'lower_left'
  | 'lower_center'
  | 'lower_right'
  | 'footer'
  | 'unknown';

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectedVisualElement {
  id: string;
  page: number;
  kind: VisualElementKindExtended;
  occurrenceIndex: number;
  position: VisualPosition;
  description?: string;
  /** Raw visible text from OCR/vision. Use textEvidence.selectedSourceText when available. */
  visibleText?: string;
  /** Structured evidence for the visible text on this element. Preferred over visibleText. */
  textEvidence?: VisualTextEvidence;
  confidence: number;
  bbox?: BoundingBox;
  source: 'mistral_ocr' | 'markdown_marker' | 'page_vision' | 'regex';
}

export type VerificationItemType =
  | 'contact_url'
  | 'verification_url'
  | 'verification_code'
  | 'document_number'
  | 'qr_payload'
  | 'email'
  | 'phone'
  | 'mrz'
  | 'unknown';

export function classifyUrl(url: string): 'contact_url' | 'verification_url' {
  const lower = url.toLowerCase();
  if (
    /\/(verify|check|qr|validate|confirm|cert|document)[/?#]?/.test(lower) ||
    /[?&](code|token|verify|check|validate|doc|id)=/.test(lower) ||
    /\/qr/.test(lower)
  ) {
    return 'verification_url';
  }
  return 'contact_url';
}

export function convertOcrElementsToDetected(
  ocrElements: VisualElement[],
): DetectedVisualElement[] {
  const occurrenceCounters: Partial<Record<string, number>> = {};
  return ocrElements
    .filter(el => el.kind !== 'verification_string' && el.kind !== 'mrz')
    .map((el, i) => {
      const kindKey = `${el.kind}:${el.page ?? 1}`;
      const occIdx = occurrenceCounters[kindKey] ?? 0;
      occurrenceCounters[kindKey] = occIdx + 1;
      const src = el.source === 'pdf_image_extraction' ? 'mistral_ocr' : el.source;
      return {
        id: `ocr_${i + 1}`,
        page: el.page ?? 1,
        kind: el.kind as VisualElementKindExtended,
        occurrenceIndex: occIdx,
        position: (el.position as VisualPosition) ?? 'unknown',
        description: el.description,
        visibleText: el.text,
        confidence: el.confidence ?? 0.7,
        source: src as DetectedVisualElement['source'],
      };
    });
}

export function mergeDetectedElements(
  ocrElements: DetectedVisualElement[],
  visionElements: DetectedVisualElement[],
): DetectedVisualElement[] {
  const visionCoverage = new Set<string>();
  for (const v of visionElements) {
    visionCoverage.add(`${v.page}:${v.kind}`);
  }

  const result = [...visionElements];

  for (const ocrEl of ocrElements) {
    const key = `${ocrEl.page}:${ocrEl.kind}`;
    if (!visionCoverage.has(key)) {
      result.push(ocrEl);
    } else if (ocrEl.visibleText) {
      const visionEl = result.find(v => v.page === ocrEl.page && v.kind === ocrEl.kind && !v.visibleText);
      if (visionEl) {
        visionEl.visibleText = ocrEl.visibleText;
      }
    }
  }

  const kindPageCounters: Record<string, number> = {};
  return result.map((el, i) => {
    const key = `${el.page}:${el.kind}`;
    const occ = kindPageCounters[key] ?? 0;
    kindPageCounters[key] = occ + 1;
    return { ...el, id: `det_${i + 1}`, occurrenceIndex: occ };
  });
}
