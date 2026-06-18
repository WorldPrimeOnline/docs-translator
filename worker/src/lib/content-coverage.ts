/**
 * Content coverage checks — pre-render validation that translation is complete.
 *
 * Compares translated markdown against source markdown for:
 * - minimum length ratio
 * - heading preservation
 * - protected token cleanup
 * - table count / shape preservation
 * - visual element count preservation
 * - non-empty, non-trivial content
 *
 * Returns {passed, errors, warnings, retryNeeded, fallbackNeeded}.
 * Never throws. Callers must treat non-pass as advisory unless fallbackNeeded.
 */

import { extractMarkdownTableShapes, compareMarkdownTableShapes, type MarkdownTableShape } from './table-shape';

export interface CoverageCheckResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
  retryNeeded: boolean;
  fallbackNeeded: boolean;
}

// Minimum ratio of translated length to source length (excluding inventory/visual blocks)
const MIN_LENGTH_RATIO = 0.15;
// Minimum absolute character count for any non-trivial translation
const MIN_ABSOLUTE_CHARS = 80;

const WPO_PV_RE = /__WPO_PV_\d{4}__/g;
const WPO_VIS_RE = /__WPO_VIS_\d{4}__/g;

/** Extract H1/H2/H3 heading texts from markdown, lowercase+normalised. */
function extractHeadings(md: string): string[] {
  return md
    .split('\n')
    .filter((l) => /^#{1,3}\s+/.test(l.trim()))
    .map((l) => l.replace(/^#+\s+/, '').trim().toLowerCase())
    .filter((h) => h.length > 2);
}

/** Strip visual block and translator block so length comparisons are fair. */
function stripNonBodyBlocks(md: string): string {
  // Remove visual block (anything after <!-- WPO_VISUAL_BLOCK_START --> or ## Document visual elements)
  const visStart = md.search(/<!--\s*WPO_VISUAL_BLOCK_START\s*-->|## (?:Description of non-text elements|Document visual elements)/i);
  if (visStart > 0) md = md.slice(0, visStart);
  // Remove translator certification block (## Translator / ## Translation certification)
  const transStart = md.search(/^## (?:Translator|Translation certification)\b/im);
  if (transStart > 0) md = md.slice(0, transStart);
  return md.trim();
}

/** Return count of each visual element kind from the serialized inventory block. */
function countVisualKinds(md: string): Map<string, number> {
  const counts = new Map<string, number>();
  const re = /kind=([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    const kind = m[1]?.trim() ?? '';
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return counts;
}

/** Percentage of source headings (normalised) present in translated headings. */
function headingCoverage(srcHeadings: string[], trHeadings: string[]): number {
  if (srcHeadings.length === 0) return 1;
  const trSet = new Set(trHeadings);
  const found = srcHeadings.filter((h) => {
    // Exact match or the translated heading contains the source heading words
    if (trSet.has(h)) return true;
    // Fuzzy: heading keywords appear in any translated heading
    const words = h.split(/\s+/).filter((w) => w.length > 3);
    if (words.length === 0) return false;
    return trHeadings.some((th) => words.some((w) => th.includes(w)));
  }).length;
  return found / srcHeadings.length;
}

export interface CoverageCheckInput {
  sourceMarkdown: string;
  translatedMarkdown: string;
  /** Pre-computed source table shapes (pass if already computed to avoid double parse) */
  sourceShapes?: MarkdownTableShape[];
  /** Count of protected values that were injected into the source */
  protectedValueCount: number;
  /** Inventory entry count from visual analysis (0 if no visual analysis) */
  inventoryEntryCount: number;
}

export function checkContentCoverage(input: CoverageCheckInput): CoverageCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let retryNeeded = false;
  let fallbackNeeded = false;

  const {
    sourceMarkdown,
    translatedMarkdown,
    protectedValueCount,
    inventoryEntryCount,
  } = input;

  const sourceShapes = input.sourceShapes ?? extractMarkdownTableShapes(sourceMarkdown);

  // ── 1. Empty translation ────────────────────────────────────────────────────
  const bodyOnly = stripNonBodyBlocks(translatedMarkdown);
  if (!bodyOnly) {
    errors.push('EMPTY_TRANSLATION: translated markdown is empty after stripping blocks');
    fallbackNeeded = true;
    return { passed: false, errors, warnings, retryNeeded, fallbackNeeded };
  }

  // ── 2. Minimum length ───────────────────────────────────────────────────────
  const sourceBody = stripNonBodyBlocks(sourceMarkdown);
  const lengthRatio = bodyOnly.length / Math.max(sourceBody.length, 1);
  if (bodyOnly.length < MIN_ABSOLUTE_CHARS) {
    errors.push(`TRANSLATION_TOO_SHORT: ${bodyOnly.length} chars (minimum ${MIN_ABSOLUTE_CHARS})`);
    fallbackNeeded = true;
  } else if (lengthRatio < MIN_LENGTH_RATIO) {
    warnings.push(`TRANSLATION_LENGTH_LOW: ratio=${lengthRatio.toFixed(2)} (threshold ${MIN_LENGTH_RATIO})`);
    retryNeeded = true;
  }

  // ── 3. Protected tokens not leaked into output ──────────────────────────────
  const pvRemaining = (translatedMarkdown.match(WPO_PV_RE) ?? []).length;
  if (pvRemaining > 0) {
    errors.push(`PROTECTED_TOKENS_NOT_RESTORED: ${pvRemaining} __WPO_PV_ tokens remain in output`);
    // Don't set fallbackNeeded — the restore step should have handled this; warn only
  }

  const visRemaining = (translatedMarkdown.match(WPO_VIS_RE) ?? []).length;
  if (visRemaining > 0) {
    warnings.push(`VISUAL_TOKENS_NOT_PARSED: ${visRemaining} __WPO_VIS_ tokens remain in output`);
  }

  // ── 4. Heading coverage ─────────────────────────────────────────────────────
  const srcHeadings = extractHeadings(sourceMarkdown);
  const trHeadings = extractHeadings(translatedMarkdown);
  const coverage = headingCoverage(srcHeadings, trHeadings);
  if (srcHeadings.length > 0 && coverage < 0.4) {
    errors.push(`HEADINGS_MISSING: only ${Math.round(coverage * 100)}% of source headings found in translation`);
    retryNeeded = true;
  } else if (srcHeadings.length > 0 && coverage < 0.7) {
    warnings.push(`HEADING_COVERAGE_LOW: ${Math.round(coverage * 100)}% of source headings found`);
  }

  // ── 5. Table shape preservation ────────────────────────────────────────────
  const translatedShapes = extractMarkdownTableShapes(translatedMarkdown);
  const shapeMismatches = compareMarkdownTableShapes(sourceShapes, translatedShapes);
  if (shapeMismatches.length > 0) {
    const detail = shapeMismatches.map((m) => m.issues.join(';')).join('|');
    errors.push(`TABLE_SHAPE_MISMATCH: ${shapeMismatches.length} table(s) changed — ${detail}`);
    retryNeeded = true;
  }

  if (sourceShapes.length > 0 && translatedShapes.length < sourceShapes.length) {
    errors.push(`TABLE_COUNT_DROPPED: source=${sourceShapes.length} translated=${translatedShapes.length}`);
    retryNeeded = true;
  }

  // ── 6. Visual inventory count ───────────────────────────────────────────────
  if (inventoryEntryCount > 0) {
    const trVisKinds = countVisualKinds(translatedMarkdown);
    const totalFound = [...trVisKinds.values()].reduce((a, b) => a + b, 0);
    if (totalFound === 0 && inventoryEntryCount > 0) {
      warnings.push(`VISUAL_INVENTORY_MISSING_IN_TRANSLATION: expected ${inventoryEntryCount} entries`);
    }
  }

  // ── 7. Not only visual/translator block ────────────────────────────────────
  const hasSubstantiveContent = bodyOnly.length >= MIN_ABSOLUTE_CHARS;
  if (!hasSubstantiveContent && inventoryEntryCount > 0) {
    errors.push('SUBSTANTIVE_CONTENT_MISSING: translation appears to contain only visual or translator block');
    fallbackNeeded = true;
  }

  // ── 8. Protected value count sanity ────────────────────────────────────────
  if (protectedValueCount > 0) {
    // Check that translation is not returning the source with tokens still embedded
    // (covered by pvRemaining check above)
    const srcTokenCount = (sourceMarkdown.match(WPO_PV_RE) ?? []).length;
    if (srcTokenCount > 0 && pvRemaining === srcTokenCount) {
      warnings.push(`PROTECTED_TOKENS_UNCHANGED: all ${pvRemaining} tokens appear unchanged (translation may have passed source through)`);
    }
  }

  const passed = errors.length === 0 && !fallbackNeeded;
  return { passed, errors, warnings, retryNeeded: retryNeeded && !fallbackNeeded, fallbackNeeded };
}
