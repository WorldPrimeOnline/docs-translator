/**
 * Unified translation quality gate — runs after restoreProtectedValues,
 * before DOCX rendering.
 *
 * Checks structural completeness, source-script residue, length, protected values,
 * and structural issues like flattened metadata tables or page markers before title.
 * Returns typed issues (warning | retry_required) and structured metrics for logging.
 */

import { extractMarkdownTableShapes } from './table-shape';
import type { MarkdownTableShape } from './table-shape';

// ── Issue types ───────────────────────────────────────────────────────────────

export type TranslationQualityIssueCode =
  | 'TABLE_COUNT_REDUCED'
  | 'TABLE_SHAPE_CHANGED'
  | 'SOURCE_SCRIPT_REMAINS'
  | 'SECTION_COVERAGE_LOW'
  | 'OUTPUT_TOO_SHORT'
  | 'PROTECTED_VALUE_MISSING'
  | 'DOCUMENT_TITLE_MISSING'
  | 'SOURCE_PAGE_MARKER_BEFORE_TITLE'
  | 'METADATA_STRUCTURE_LOST';

export type TranslationQualityIssue = {
  code: TranslationQualityIssueCode;
  severity: 'warning' | 'retry_required';
  details: string;
};

export type TranslationQualityMetrics = {
  sourceTableCount: number;
  translatedTableCount: number;
  sourceTableShapes: Array<{ columns: number; rows: number }>;
  translatedTableShapes: Array<{ columns: number; rows: number }>;

  sourceScriptCharacterCount: number;
  remainingSourceScriptCharacterCount: number;
  remainingSourceScriptRatio: number;

  headingCount: number;
  sectionCoverageRatio: number;
  protectedValueCoverageRatio: number;

  sourceLength: number;
  translatedLength: number;
  lengthRatio: number;

  warnings: string[];
};

// ── Script detection ──────────────────────────────────────────────────────────

const SCRIPT_RANGES: Record<string, RegExp> = {
  th: /[฀-๿]/g,
  ar: /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/g,
  he: /[֐-׿ﬀ-ﭏ]/g,
  hi: /[ऀ-ॿ]/g,
  zh: /[一-鿿㐀-䶿]/g,
  ja: /[぀-ヿ一-鿿]/g,
  ko: /[가-힯ᄀ-ᇿ]/g,
  ru: /[Ѐ-ӿ]/g,
};

function getSourceScriptRegex(sourceLang: string): RegExp | null {
  const base = sourceLang.split('-')[0]?.toLowerCase() ?? '';
  return SCRIPT_RANGES[base] ?? null;
}

/**
 * Returns the character count of source-script chars in the text,
 * and the length of the longest contiguous source-script run.
 */
function measureSourceScriptResidual(text: string, sourceLang: string): {
  totalCount: number;
  longestRunLength: number;
  longFragments: string[];
} {
  const re = getSourceScriptRegex(sourceLang);
  if (!re) return { totalCount: 0, longestRunLength: 0, longFragments: [] };

  // Count total source-script chars
  const allMatches = Array.from(text.matchAll(new RegExp(re.source, 'g')));
  const totalCount = allMatches.length;

  // Find longest contiguous source-script run (ignoring spaces/punct between chars)
  const runRe = new RegExp(`[${re.source.slice(1, -2)}][${re.source.slice(1, -2)}\\s]{2,}`, 'g');
  const longFragments: string[] = [];
  let longestRunLength = 0;
  for (const m of text.matchAll(runRe)) {
    const stripped = m[0]!.replace(/\s+/g, ' ').trim();
    if (stripped.length > longestRunLength) longestRunLength = stripped.length;
    if (stripped.length > 25) longFragments.push(stripped.slice(0, 80));
  }

  return { totalCount, longestRunLength, longFragments };
}

// ── Key-value flat block detection ───────────────────────────────────────────

/**
 * Count blocks of 3+ consecutive non-table "Label: Value" lines in text.
 * Used to detect when a model converted a table to flat key-value text.
 */
function countFlatKvBlocks(markdown: string, minBlockSize = 3): number {
  const lines = markdown.split('\n');
  let consecutive = 0;
  let blocks = 0;
  const KV_RE = /^[^\|#\-\*\d\[\s].{1,50}:\s*\S/;
  for (const line of lines) {
    const t = line.trim();
    if (t.length > 3 && !t.startsWith('|') && !t.startsWith('#') && KV_RE.test(t)) {
      consecutive++;
    } else {
      if (consecutive >= minBlockSize) blocks++;
      consecutive = 0;
    }
  }
  if (consecutive >= minBlockSize) blocks++;
  return blocks;
}

// ── Source page marker before title ──────────────────────────────────────────

/**
 * Returns true if a page/chunk marker appears in the first non-body lines.
 * Scans the first 15 non-empty lines to catch markers that appear after a
 * translation header (e.g. "# ПЕРЕВОД С..." on line 1, "Page: 1 / 1" on line 3).
 */
function hasPageMarkerBeforeTitle(markdown: string): boolean {
  const PAGE_MARKER_RE = /^(?:page|страница|หน้า|chunk):?\s*\d+\s*\/\s*\d+$/i;
  const lines = markdown.split('\n');
  let nonEmptyCount = 0;
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    nonEmptyCount++;
    if (nonEmptyCount > 15) break;
    if (PAGE_MARKER_RE.test(t)) return true;
  }
  return false;
}

// ── Heading / section coverage ────────────────────────────────────────────────

function extractHeadingTexts(md: string): string[] {
  return md.split('\n')
    .filter(l => /^#{1,3}\s+/.test(l.trim()))
    .map(l => l.replace(/^#+\s+/, '').trim().toLowerCase());
}

function headingCoverageRatio(srcHeadings: string[], trHeadings: string[]): number {
  if (srcHeadings.length === 0) return 1;
  // Use count-based coverage: the translation must have at least as many headings
  // as the source. Text comparison is unreliable because headings are translated
  // into a different language (e.g. English source → Russian translation).
  return Math.min(trHeadings.length, srcHeadings.length) / srcHeadings.length;
}

// ── Protected value coverage ──────────────────────────────────────────────────

const PV_RE = /__WPO_PV_\d{4}__/g;

function protectedValueCoverage(sourceMd: string, translatedMd: string): number {
  const sourceCount = (sourceMd.match(PV_RE) ?? []).length;
  if (sourceCount === 0) return 1;
  const translatedCount = (translatedMd.match(PV_RE) ?? []).length;
  // Values should have been restored — remaining tokens are those still unrestored
  // Coverage = (sourceCount - remaining) / sourceCount
  return Math.max(0, (sourceCount - translatedCount) / sourceCount);
}

// ── Shape helpers ─────────────────────────────────────────────────────────────

function toShapeArray(shapes: MarkdownTableShape[]): Array<{ columns: number; rows: number }> {
  return shapes.map(s => ({ columns: s.columnCount, rows: s.dataRowCount }));
}

// ── Strip non-body blocks for length comparison ───────────────────────────────

function stripNonBodyBlocks(md: string): string {
  let s = md;
  const visStart = s.search(/<!--\s*WPO_VISUAL_BLOCK_START\s*-->|## (?:Описание нетекстовых элементов|Description of non-text elements|Document visual elements)/i);
  if (visStart > 0) s = s.slice(0, visStart);
  const transStart = s.search(/^## (?:Сведения о переводчике|Translator|Translation certification)\b/im);
  if (transStart > 0) s = s.slice(0, transStart);
  return s.trim();
}

// ── Main public API ───────────────────────────────────────────────────────────

export interface QualityGateInput {
  sourceMarkdown: string;
  translatedMarkdown: string;
  sourceLang: string;
  targetLang: string;
}

export interface QualityGateResult {
  issues: TranslationQualityIssue[];
  metrics: TranslationQualityMetrics;
  hasRetryRequired: boolean;
}

const MIN_LENGTH_RATIO = 0.20;
/** Ratio of source-script chars that triggers a retry_required */
const SOURCE_SCRIPT_RATIO_RETRY = 0.04;
/** Ratio that triggers a warning only */
const SOURCE_SCRIPT_RATIO_WARN = 0.01;
/** Contiguous source-script run length that is always retry_required */
const SOURCE_SCRIPT_LONG_RUN = 40;
/** Min section coverage ratio before flagging */
const MIN_SECTION_COVERAGE = 0.50;

export function runTranslationQualityGate(input: QualityGateInput): QualityGateResult {
  const { sourceMarkdown, translatedMarkdown, sourceLang, targetLang } = input;
  const issues: TranslationQualityIssue[] = [];
  const warnings: string[] = [];

  const sourceShapes = extractMarkdownTableShapes(sourceMarkdown);
  const translatedShapes = extractMarkdownTableShapes(translatedMarkdown);

  const sourceBody = stripNonBodyBlocks(sourceMarkdown);
  const translatedBody = stripNonBodyBlocks(translatedMarkdown);

  // ── 1. Table count ────────────────────────────────────────────────────────
  if (sourceShapes.length > 0 && translatedShapes.length < sourceShapes.length) {
    issues.push({
      code: 'TABLE_COUNT_REDUCED',
      severity: 'retry_required',
      details: `Source has ${sourceShapes.length} table(s), translation has ${translatedShapes.length}`,
    });
  }

  // ── 2. Table shapes ───────────────────────────────────────────────────────
  // Only compare shapes when counts match exactly. When the translation has MORE
  // tables than the source (e.g. correctly added a metadata table), position-based
  // comparison would produce false positives. When translation has fewer tables,
  // TABLE_COUNT_REDUCED already fires.
  if (sourceShapes.length === translatedShapes.length) {
    for (let i = 0; i < sourceShapes.length; i++) {
      const s = sourceShapes[i]!;
      const t = translatedShapes[i]!;
      if (s.columnCount !== t.columnCount || s.dataRowCount !== t.dataRowCount) {
        issues.push({
          code: 'TABLE_SHAPE_CHANGED',
          severity: 'retry_required',
          details: `Table ${i + 1}: expected ${s.columnCount}×${s.dataRowCount}, got ${t.columnCount}×${t.dataRowCount}`,
        });
      }
    }
  }

  // ── 3. Source script residue ──────────────────────────────────────────────
  const { totalCount, longestRunLength, longFragments } = measureSourceScriptResidual(
    translatedBody,
    sourceLang,
  );
  const nonWhitespace = translatedBody.replace(/\s+/g, '').length || 1;
  const sourceScriptRatio = totalCount / nonWhitespace;
  const sourceScriptCount = measureSourceScriptResidual(sourceBody, sourceLang).totalCount;

  if (longestRunLength >= SOURCE_SCRIPT_LONG_RUN) {
    issues.push({
      code: 'SOURCE_SCRIPT_REMAINS',
      severity: 'retry_required',
      details: `Untranslated source-script fragment (${longestRunLength} chars): "${longFragments[0] ?? ''}"`,
    });
  } else if (sourceScriptRatio >= SOURCE_SCRIPT_RATIO_RETRY) {
    issues.push({
      code: 'SOURCE_SCRIPT_REMAINS',
      severity: 'retry_required',
      details: `Source-script chars in translation: ${(sourceScriptRatio * 100).toFixed(1)}% (threshold ${(SOURCE_SCRIPT_RATIO_RETRY * 100).toFixed(1)}%)`,
    });
  } else if (sourceScriptRatio >= SOURCE_SCRIPT_RATIO_WARN) {
    warnings.push(`SOURCE_SCRIPT_LOW: ${(sourceScriptRatio * 100).toFixed(1)}%`);
  }

  // ── 4. Source page marker before title ───────────────────────────────────
  if (hasPageMarkerBeforeTitle(translatedMarkdown)) {
    issues.push({
      code: 'SOURCE_PAGE_MARKER_BEFORE_TITLE',
      severity: 'retry_required',
      details: 'Translation starts with a page marker (e.g. "Page: 1 / 1") before the document title',
    });
  }

  // ── 5. Metadata structure loss ────────────────────────────────────────────
  const flatKvBlocks = countFlatKvBlocks(translatedBody);
  if (flatKvBlocks > 0) {
    issues.push({
      code: 'METADATA_STRUCTURE_LOST',
      severity: 'retry_required',
      details: `${flatKvBlocks} block(s) of 3+ consecutive "Label: Value" lines found; should be Markdown tables`,
    });
  }

  // ── 6. Section coverage ───────────────────────────────────────────────────
  const srcHeadings = extractHeadingTexts(sourceMarkdown);
  const trHeadings = extractHeadingTexts(translatedMarkdown);
  const sectionCoverage = headingCoverageRatio(srcHeadings, trHeadings);

  if (srcHeadings.length > 2 && sectionCoverage < MIN_SECTION_COVERAGE) {
    issues.push({
      code: 'SECTION_COVERAGE_LOW',
      severity: 'retry_required',
      details: `Only ${Math.round(sectionCoverage * 100)}% of source headings found in translation (threshold ${Math.round(MIN_SECTION_COVERAGE * 100)}%)`,
    });
  } else if (srcHeadings.length > 1 && sectionCoverage < 0.7) {
    warnings.push(`SECTION_COVERAGE_LOW: ${Math.round(sectionCoverage * 100)}%`);
  }

  // ── 7. Output length ──────────────────────────────────────────────────────
  const lengthRatio = translatedBody.length / Math.max(sourceBody.length, 1);
  if (translatedBody.length < 80) {
    issues.push({
      code: 'OUTPUT_TOO_SHORT',
      severity: 'retry_required',
      details: `Translation body has only ${translatedBody.length} characters`,
    });
  } else if (lengthRatio < MIN_LENGTH_RATIO) {
    issues.push({
      code: 'OUTPUT_TOO_SHORT',
      severity: 'retry_required',
      details: `Length ratio ${lengthRatio.toFixed(2)} (threshold ${MIN_LENGTH_RATIO})`,
    });
  }

  // ── 8. Protected value coverage ───────────────────────────────────────────
  const pvCoverage = protectedValueCoverage(sourceMarkdown, translatedMarkdown);
  if (pvCoverage < 1.0) {
    const missing = Math.round((1 - pvCoverage) * (sourceMarkdown.match(PV_RE) ?? []).length);
    issues.push({
      code: 'PROTECTED_VALUE_MISSING',
      severity: 'retry_required',
      details: `${missing} protected placeholder(s) missing from translation`,
    });
  }

  // ── 9. Document title ────────────────────────────────────────────────────
  const hasTitle = /^#{1,2}\s+\S/m.test(translatedBody);
  if (!hasTitle && translatedBody.length > 100) {
    issues.push({
      code: 'DOCUMENT_TITLE_MISSING',
      severity: 'warning',
      details: 'No H1/H2 heading found in translation body',
    });
  }

  const metrics: TranslationQualityMetrics = {
    sourceTableCount: sourceShapes.length,
    translatedTableCount: translatedShapes.length,
    sourceTableShapes: toShapeArray(sourceShapes),
    translatedTableShapes: toShapeArray(translatedShapes),
    sourceScriptCharacterCount: sourceScriptCount,
    remainingSourceScriptCharacterCount: totalCount,
    remainingSourceScriptRatio: sourceScriptRatio,
    headingCount: trHeadings.length,
    sectionCoverageRatio: sectionCoverage,
    protectedValueCoverageRatio: pvCoverage,
    sourceLength: sourceBody.length,
    translatedLength: translatedBody.length,
    lengthRatio,
    warnings,
  };

  return {
    issues,
    metrics,
    hasRetryRequired: issues.some(i => i.severity === 'retry_required'),
  };
}

// ── Retry prompt builder ──────────────────────────────────────────────────────

export function buildQualityRetryPrompt(
  issues: TranslationQualityIssue[],
  metrics: TranslationQualityMetrics,
): string {
  const lines: string[] = [
    'The previous translation is incomplete or changed the source structure.',
    '',
    'Required corrections:',
  ];

  for (const issue of issues) {
    switch (issue.code) {
      case 'TABLE_COUNT_REDUCED':
        lines.push(`- Preserve all ${metrics.sourceTableCount} source table(s). The translation has only ${metrics.translatedTableCount}.`);
        break;
      case 'TABLE_SHAPE_CHANGED': {
        // Parse "Table N: expected CxR, got C2xR2" to produce "N columns" wording
        const colMatch = issue.details.match(/expected (\d+)[×x](\d+)/);
        if (colMatch) {
          lines.push(`- Table structure changed: restore the original ${colMatch[1]} columns and ${colMatch[2]} rows. ${issue.details}`);
        } else {
          lines.push(`- Restore the correct table structure. ${issue.details}`);
        }
        break;
      }
      case 'SOURCE_SCRIPT_REMAINS':
        lines.push(`- Translate the remaining source-language content completely. ${issue.details}`);
        break;
      case 'SOURCE_PAGE_MARKER_BEFORE_TITLE':
        lines.push('- Remove the page marker (e.g. "Page: 1 / 1") from the beginning. The document title (# heading) must be the first content.');
        break;
      case 'METADATA_STRUCTURE_LOST':
        lines.push(`- Convert all "Label: Value" text blocks into proper two-column Markdown tables (| Параметр | Значение | format). Do not leave them as plain text lines.`);
        break;
      case 'SECTION_COVERAGE_LOW':
        lines.push(`- Include all section headings from the source. Current coverage: ${Math.round(metrics.sectionCoverageRatio * 100)}%.`);
        break;
      case 'OUTPUT_TOO_SHORT':
        lines.push('- Return the complete document. Do not truncate or summarize any section.');
        break;
      case 'PROTECTED_VALUE_MISSING':
        lines.push('- Preserve every __WPO_PV_NNNN__ placeholder exactly as written — do not drop, translate, or paraphrase them.');
        break;
      case 'DOCUMENT_TITLE_MISSING':
        lines.push('- Include the document title as a Markdown heading (# or ##) at the start of the translation.');
        break;
    }
  }

  lines.push('');
  lines.push('Return the complete corrected document. Do not summarize or abbreviate any section.');

  return lines.join('\n');
}

// ── Best-result selection ─────────────────────────────────────────────────────

function scoreTranslation(metrics: TranslationQualityMetrics, issueCount: number): number {
  let score = 100;
  // Protected value coverage is most important
  score += (metrics.protectedValueCoverageRatio - 1) * 50;
  // Table preservation
  if (metrics.sourceTableCount > 0) {
    const tableRatio = metrics.translatedTableCount / metrics.sourceTableCount;
    score += (tableRatio - 1) * 30;
  }
  // Source script residue (lower is better)
  score -= metrics.remainingSourceScriptRatio * 200;
  // Section coverage
  score += (metrics.sectionCoverageRatio - 1) * 20;
  // Length ratio (1.0 is ideal; penalise only extremes)
  if (metrics.lengthRatio < 0.3) score -= 20;
  else if (metrics.lengthRatio > 5.0) score -= 10;
  // Issue count
  score -= issueCount * 5;
  return score;
}

export function selectBestTranslation(
  initial: { markdown: string; result: QualityGateResult },
  retry: { markdown: string; result: QualityGateResult },
): { markdown: string; result: QualityGateResult; selectedFrom: 'initial' | 'retry' } {
  const initialScore = scoreTranslation(initial.result.metrics, initial.result.issues.length);
  const retryScore = scoreTranslation(retry.result.metrics, retry.result.issues.length);

  if (retryScore > initialScore) {
    return { ...retry, selectedFrom: 'retry' };
  }
  return { ...initial, selectedFrom: 'initial' };
}

// ── Compact log line ──────────────────────────────────────────────────────────

export function formatQualityLogLine(
  metrics: TranslationQualityMetrics,
  issues: TranslationQualityIssue[],
  extra: { retryUsed: boolean; selectedResult: 'initial' | 'retry' | 'none' },
): string {
  const parts = [
    `src_tables=${metrics.sourceTableCount}`,
    `tr_tables=${metrics.translatedTableCount}`,
    `src_script_ratio=${(metrics.remainingSourceScriptRatio * 100).toFixed(1)}%`,
    `long_untranslated=${issues.filter(i => i.code === 'SOURCE_SCRIPT_REMAINS').length}`,
    `section_coverage=${Math.round(metrics.sectionCoverageRatio * 100)}%`,
    `pv_coverage=${Math.round(metrics.protectedValueCoverageRatio * 100)}%`,
    `retry=${extra.retryUsed}`,
    `selected=${extra.selectedResult}`,
  ];
  const issueCodes = issues.map(i => `${i.code}(${i.severity[0]})`).join(',');
  if (issueCodes) parts.push(`issues=${issueCodes}`);
  return `translation quality: ${parts.join(' ')}`;
}
