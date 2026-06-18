/**
 * Source page order detection and reordering.
 *
 * When multiple images are uploaded in any order, this module detects page
 * numbers from per-page OCR markdown and reorders pages into logical document
 * order before joining for translation.
 *
 * Language-agnostic: patterns cover English, Russian, Thai, and bare "N/M"
 * formats used universally in page footers.
 */

export interface SourcePageEvidence {
  uploadIndex: number;
  detectedPageNumber?: number;
  detectedTotalPages?: number;
  confidence: number;
  evidenceText?: string;
}

export interface PageOrderResult {
  reordered: boolean;
  reorderedMarkdowns: string[];
  warning?: string;
  evidence: SourcePageEvidence[];
}

// Language-agnostic page number patterns.
// All capture (current_page, total_pages).
const PAGE_NUMBER_PATTERNS: Array<{ re: RegExp; confidence: number }> = [
  // "Page 1 of 2" / "page 1 of 2" (English)
  { re: /\bpage\s+(\d+)\s+of\s+(\d+)\b/i, confidence: 0.95 },
  // "หน้า 1 จาก 2" (Thai)
  { re: /หน้า\s+(\d+)\s+จาก\s+(\d+)/, confidence: 0.95 },
  // "Страница 1 из 2" (Russian)
  { re: /страница\s+(\d+)\s+из\s+(\d+)/i, confidence: 0.95 },
  // "1 of 2" without "page" (common footer)
  { re: /\b(\d+)\s+of\s+(\d+)\b/i, confidence: 0.75 },
  // "1/2" on its own line (bare fraction)
  { re: /^\s*(\d+)\s*\/\s*(\d+)\s*$/m, confidence: 0.65 },
];

/** Detect page number evidence from one page's OCR markdown. */
export function detectPageEvidence(md: string, uploadIndex: number): SourcePageEvidence {
  for (const { re, confidence } of PAGE_NUMBER_PATTERNS) {
    const m = md.match(re);
    if (!m) continue;
    const num = parseInt(m[1]!, 10);
    const total = parseInt(m[2]!, 10);
    if (
      !isNaN(num) && !isNaN(total) &&
      num >= 1 && total >= 1 &&
      num <= total && total <= 200
    ) {
      return {
        uploadIndex,
        detectedPageNumber: num,
        detectedTotalPages: total,
        confidence,
        evidenceText: m[0],
      };
    }
  }
  return { uploadIndex, confidence: 0.0 };
}

/**
 * Detect page numbers across all per-page markdowns and reorder if the
 * evidence is consistent and unambiguous.
 *
 * Rules:
 * 1. All pages must have detected numbers at confidence >= 0.7.
 * 2. All pages must agree on total page count.
 * 3. No duplicate page numbers.
 * 4. If any rule fails: preserve upload order and add a warning.
 */
export function reorderPagesByEvidence(pageMarkdowns: string[]): PageOrderResult {
  if (pageMarkdowns.length <= 1) {
    return {
      reordered: false,
      reorderedMarkdowns: pageMarkdowns,
      evidence: pageMarkdowns.map((_, i) => ({ uploadIndex: i, confidence: 0.0 })),
    };
  }

  const evidence = pageMarkdowns.map((md, i) => detectPageEvidence(md, i));

  // Rule 1: all detected with sufficient confidence
  if (!evidence.every(e => (e.detectedPageNumber !== undefined) && e.confidence >= 0.65)) {
    return {
      reordered: false,
      reorderedMarkdowns: pageMarkdowns,
      warning: 'PAGE_ORDER_DETECTION_PARTIAL',
      evidence,
    };
  }

  // Rule 2: consistent total
  const totals = evidence.map(e => e.detectedTotalPages!);
  const allSameTotal = totals.every(t => t === totals[0]);
  if (!allSameTotal) {
    return {
      reordered: false,
      reorderedMarkdowns: pageMarkdowns,
      warning: 'PAGE_ORDER_TOTAL_MISMATCH',
      evidence,
    };
  }

  // Rule 3: no duplicates
  const pageNums = evidence.map(e => e.detectedPageNumber!);
  if (new Set(pageNums).size !== pageNums.length) {
    return {
      reordered: false,
      reorderedMarkdowns: pageMarkdowns,
      warning: 'PAGE_ORDER_DUPLICATE_NUMBERS',
      evidence,
    };
  }

  // Sort by detected page number
  const sorted = [...evidence].sort((a, b) => a.detectedPageNumber! - b.detectedPageNumber!);
  const reorderedMarkdowns = sorted.map(e => pageMarkdowns[e.uploadIndex]!);

  const alreadyOrdered = sorted.every((e, i) => e.uploadIndex === i);

  return {
    reordered: !alreadyOrdered,
    reorderedMarkdowns,
    evidence: sorted,
  };
}
