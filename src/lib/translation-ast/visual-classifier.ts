import type { VisualElementKind } from '@/lib/translation-workflow/types';

export type { VisualElementKind };

export type VisualPosition =
  | 'top_left' | 'top_center' | 'top_right'
  | 'center_left' | 'center' | 'center_right'
  | 'bottom_left' | 'bottom_center' | 'bottom_right'
  | 'full_page' | 'unknown';

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectedVisualElement {
  kind: VisualElementKind;
  /** 0-based index within (page, kind) group in document order */
  occurrenceIndex: number;
  /** 1-based source page */
  page: number;
  position: VisualPosition;
  /** 0–1 */
  confidence: number;
  /** Optional language-agnostic description */
  description?: string;
  /** Normalized bounding box (0–1) */
  bbox?: BoundingBox;
}

/**
 * Classify a bracket marker from OCR using structural/Unicode patterns only.
 * Language-independent: only recognizes universal ASCII technical terms (QR, barcode)
 * and structural patterns (MRZ character set, digit sequences).
 */
export function classifyBracketMarker(bracketContent: string): VisualElementKind {
  const inner = bracketContent.replace(/^\[|\]$/g, '').trim();

  // QR — universal ASCII technical term used internationally
  if (/\bqr\b/i.test(inner)) return 'qr';

  // Barcode — universal ASCII technical term
  if (/\bbarcode\b/i.test(inner)) return 'barcode';

  // Dense digit barcode — pure digit string 4+ chars (must precede MRZ check)
  if (/^\d{4,}$/.test(inner)) return 'barcode';

  // MRZ structural pattern: uppercase letters/digits/<, min 9 chars, must have at least one letter or < filler
  if (/^[A-Z0-9<]{9,}$/.test(inner) && /[A-Z<]/.test(inner)) return 'mrz';

  // Barcode via alphanumeric code: digits + uppercase letters/hyphens only
  if (/\d{3,}/.test(inner) && /^[A-Z0-9\-]+$/.test(inner)) return 'barcode';

  return 'unknown_image';
}

function computeIou(a: BoundingBox, b: BoundingBox): number {
  const xOverlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const yOverlap = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const intersection = xOverlap * yOverlap;
  if (intersection <= 0) return 0;
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Deduplicate detected visual elements.
 * - Groups by (page, kind, position); keeps highest confidence within group.
 * - If bboxes available: merges overlapping elements (IoU > 0.5) into single element.
 * - Assigns occurrenceIndex within (page, kind) groups in document order.
 * - NEVER uses markerText or translated text as dedup key.
 */
export function deduplicateVisualElements(
  elements: DetectedVisualElement[],
): DetectedVisualElement[] {
  if (!elements.length) return [];

  // Group by (page, kind, position)
  const groups = new Map<string, DetectedVisualElement[]>();
  for (const el of elements) {
    const key = `${el.page}|${el.kind}|${el.position}`;
    const group = groups.get(key) ?? [];
    group.push(el);
    groups.set(key, group);
  }

  const merged: DetectedVisualElement[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      merged.push(group[0]!);
      continue;
    }

    const hasBboxes = group.some((e) => e.bbox !== undefined);

    if (!hasBboxes) {
      // No spatial info — deduplicate by keeping highest confidence in the group
      const best = group.reduce((a, b) => (b.confidence > a.confidence ? b : a));
      merged.push(best);
      continue;
    }

    // Bboxes available: merge overlapping (IoU > 0.5); keep highest confidence
    const remaining = [...group];
    const result: DetectedVisualElement[] = [];

    while (remaining.length > 0) {
      const current = remaining.shift()!;
      const cluster = [current];

      if (current.bbox) {
        for (let i = remaining.length - 1; i >= 0; i--) {
          const other = remaining[i]!;
          if (other.bbox && computeIou(current.bbox, other.bbox) > 0.5) {
            cluster.push(other);
            remaining.splice(i, 1);
          }
        }
      }

      cluster.sort((a, b) => b.confidence - a.confidence);
      result.push(cluster[0]!);
    }

    merged.push(...result);
  }

  // Sort by (page, kind) for deterministic order before assigning occurrence indices
  merged.sort((a, b) => a.page - b.page || a.kind.localeCompare(b.kind) || a.position.localeCompare(b.position));

  const counters = new Map<string, number>();
  for (const el of merged) {
    const key = `${el.page}|${el.kind}`;
    const idx = counters.get(key) ?? 0;
    el.occurrenceIndex = idx;
    counters.set(key, idx + 1);
  }

  return merged;
}
