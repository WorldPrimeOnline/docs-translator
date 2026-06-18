/**
 * Unified translation quality gate — runs after restoreProtectedValues,
 * before DOCX rendering.
 *
 * Checks structural completeness, source-script residue, length, protected values,
 * and structural issues like flattened metadata tables or page markers before title.
 * Returns typed issues (warning | retry_required) and structured metrics for logging.
 */

// ── Issue types ───────────────────────────────────────────────────────────────

export type TranslationQualityIssueCode =
  | 'TABLE_COUNT_REDUCED'
  | 'SOURCE_TABLE_MISSING'
  | 'TABLE_SHAPE_CHANGED'
  | 'SOURCE_SCRIPT_REMAINS'
  | 'LONG_SOURCE_SCRIPT_FRAGMENT_IN_TABLE'
  | 'UNSUPPORTED_CERTIFICATION_IDENTIFIER'
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
  unmatchedSourceTableCount: number;
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

  const allMatches = Array.from(text.matchAll(new RegExp(re.source, 'g')));
  const totalCount = allMatches.length;

  // Use slice(1,-1) to correctly extract the character class content (not -2)
  const innerRe = re.source.slice(1, -1);
  const runRe = new RegExp(`[${innerRe}][${innerRe}\\s]{2,}`, 'g');
  const longFragments: string[] = [];
  let longestRunLength = 0;
  for (const m of text.matchAll(runRe)) {
    const stripped = m[0]!.replace(/\s+/g, ' ').trim();
    if (stripped.length > longestRunLength) longestRunLength = stripped.length;
    if (stripped.length > 25) longFragments.push(stripped.slice(0, 80));
  }

  return { totalCount, longestRunLength, longFragments };
}

// ── Table content extraction ──────────────────────────────────────────────────

type TableWithContent = {
  tableIndex: number;
  columnCount: number;
  dataRowCount: number;
  headerCells: string[];
  isKvLike: boolean;      // 2 columns, ≥3 rows → key-value metadata
  hasNumericData: boolean; // at least one numeric-looking data cell
};

function extractTablesWithContent(markdown: string): TableWithContent[] {
  const lines = markdown.split('\n');
  const tables: TableWithContent[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.includes('|') && i + 1 < lines.length) {
      const nextLine = lines[i + 1] ?? '';
      if (/^\|?[\s\-:|]+\|?$/.test(nextLine)) {
        const headerCells = line.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        const columnCount = headerCells.length;
        i += 2;

        const dataRows: string[][] = [];
        while (i < lines.length && (lines[i] ?? '').includes('|')) {
          const rowCells = (lines[i] ?? '').replace(/^\||\|$/g, '').split('|').map(c => c.trim());
          dataRows.push(rowCells);
          i++;
        }
        const dataRowCount = dataRows.length;

        const NUMERIC_RE = /^[\d,.\s\-–+<>%$€£¥₸]+$/;
        const allCells = dataRows.flat().filter(c => c.length > 0);
        const hasNumericData = allCells.some(c => NUMERIC_RE.test(c));

        tables.push({
          tableIndex: tables.length,
          columnCount,
          dataRowCount,
          headerCells,
          isKvLike: columnCount === 2 && dataRowCount >= 3,
          hasNumericData,
        });
        continue;
      }
    }
    i++;
  }

  return tables;
}

// ── Structural table matching ─────────────────────────────────────────────────

/**
 * Score how well a translated table matches a source table.
 * Returns -1 if the tables are incompatible (column count too far off).
 * Higher is better; minimum threshold to accept a match: MIN_MATCH_SCORE.
 */
function scoreTableMatch(
  src: TableWithContent,
  tr: TableWithContent,
  srcIdx: number,
  trIdx: number,
): number {
  const colDiff = Math.abs(src.columnCount - tr.columnCount);

  let colScore: number;
  if (colDiff === 0) {
    colScore = 50;
  } else if (colDiff === 1 && src.columnCount >= 4) {
    colScore = 20;
  } else if (colDiff === 2 && src.columnCount >= 6) {
    colScore = 5;
  } else {
    return -1; // incompatible — do not match
  }

  let rowScore = 0;
  if (src.dataRowCount > 0) {
    const rowDiff = Math.abs(src.dataRowCount - tr.dataRowCount);
    const rowRatio = rowDiff / src.dataRowCount;
    if (rowDiff === 0) rowScore = 10;
    else if (rowRatio <= 0.1) rowScore = 5;
    else if (rowRatio > 0.5) rowScore = -5;
  }

  const roleScore = src.isKvLike === tr.isKvLike ? 15 : -10;
  const posScore = Math.max(0, 5 - Math.abs(srcIdx - trIdx));

  return colScore + rowScore + roleScore + posScore;
}

const MIN_MATCH_SCORE = 30;

/**
 * Match each source table to its best translated equivalent.
 * Returns an array of translated-table indices (or -1 if unmatched).
 *
 * The translation may add extra tables (e.g. a proper metadata table where
 * the source had flat KV text). Those extra translated tables simply go
 * unmatched — that is acceptable. What is NOT acceptable is a source table
 * with no counterpart in the translation, or a matched table that lost columns.
 */
function matchSourceTablesToTranslated(
  src: TableWithContent[],
  tr: TableWithContent[],
): number[] {
  const used = new Set<number>();
  const matches: number[] = new Array(src.length).fill(-1);

  for (let si = 0; si < src.length; si++) {
    let bestScore = MIN_MATCH_SCORE - 1;
    let bestTi = -1;

    for (let ti = 0; ti < tr.length; ti++) {
      if (used.has(ti)) continue;
      const score = scoreTableMatch(src[si]!, tr[ti]!, si, ti);
      if (score > bestScore) {
        bestScore = score;
        bestTi = ti;
      }
    }

    if (bestTi >= 0) {
      matches[si] = bestTi;
      used.add(bestTi);
    }
  }

  return matches;
}

// ── Source script in table cells ──────────────────────────────────────────────

/**
 * Scan table cell content for long untranslated source-script fragments.
 * Short parenthesized originals (official spellings) are excluded from the check.
 */
function scanTableCellsForSourceScript(
  markdown: string,
  sourceLang: string,
  minFragmentLength = 20,
): Array<{ cellText: string; fragmentLength: number }> {
  const re = getSourceScriptRegex(sourceLang);
  if (!re) return [];

  const innerRe = re.source.slice(1, -1); // strip outer [ ]
  const runRe = new RegExp(`[${innerRe}][${innerRe}\\s]{${minFragmentLength - 1},}`, 'g');

  const results: Array<{ cellText: string; fragmentLength: number }> = [];
  const lines = markdown.split('\n');

  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|[\s\-:|]+\|?$/.test(t)) continue; // separator row

    const cells = t.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    for (const cell of cells) {
      if (!cell) continue;
      // Strip parenthesized originals — short official spellings in parens are acceptable
      const withoutParens = cell.replace(/\([^)]{1,50}\)/g, '');

      let maxRun = 0;
      for (const m of withoutParens.matchAll(runRe)) {
        const stripped = m[0]!.replace(/\s+/g, ' ').trim();
        if (stripped.length > maxRun) maxRun = stripped.length;
      }

      if (maxRun >= minFragmentLength) {
        results.push({ cellText: cell.slice(0, 80), fragmentLength: maxRun });
      }
    }
  }

  return results;
}

// ── Certification identifier check ───────────────────────────────────────────

function normalizeCertId(id: string): string {
  return id.toUpperCase().replace(/[\s\-–.]+/g, '');
}

function extractCertificationIdentifiers(text: string): Set<string> {
  const ids = new Set<string>();
  // ISO/IEC/EN/ASTM standards: ISO 15189, ISO13485, IEC 60601, EN 13485
  for (const m of text.matchAll(/\b(?:ISO|IEC|EN|ASTM)\s*[-–]?\s*\d{2,8}(?:[:\-.]\d{1,4})*/gi)) {
    ids.add(normalizeCertId(m[0]!));
  }
  // ILAC identifiers: ILAC-MRA, ILAC G8
  for (const m of text.matchAll(/\bILAC[-\s]?\w+/gi)) {
    ids.add(normalizeCertId(m[0]!));
  }
  return ids;
}

type CertIssue = { identifier: string; details: string };

function checkCertificationIdentifiers(
  sourceMarkdown: string,
  translatedMarkdown: string,
): CertIssue[] {
  const sourceIds = extractCertificationIdentifiers(sourceMarkdown);
  const translatedIds = extractCertificationIdentifiers(translatedMarkdown);

  const unsupported: CertIssue[] = [];
  for (const id of translatedIds) {
    if (!sourceIds.has(id)) {
      unsupported.push({
        identifier: id,
        details: `"${id}" appears in translation but is not present in source document`,
      });
    }
  }
  return unsupported;
}

// ── Key-value flat block detection ───────────────────────────────────────────

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
  // Use count-based coverage: headings are translated into a different language so
  // text comparison fails. Count ensures the model didn't skip entire sections.
  return Math.min(trHeadings.length, srcHeadings.length) / srcHeadings.length;
}

// ── Protected value coverage ──────────────────────────────────────────────────

const PV_RE = /__WPO_PV_\d{4}__/g;

function protectedValueCoverage(sourceMd: string, translatedMd: string): number {
  const sourceCount = (sourceMd.match(PV_RE) ?? []).length;
  if (sourceCount === 0) return 1;
  const translatedCount = (translatedMd.match(PV_RE) ?? []).length;
  return Math.max(0, (sourceCount - translatedCount) / sourceCount);
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
const SOURCE_SCRIPT_RATIO_RETRY = 0.04;
const SOURCE_SCRIPT_RATIO_WARN = 0.01;
const SOURCE_SCRIPT_LONG_RUN = 40;
const MIN_SECTION_COVERAGE = 0.50;

export function runTranslationQualityGate(input: QualityGateInput): QualityGateResult {
  const { sourceMarkdown, translatedMarkdown, sourceLang } = input;
  const issues: TranslationQualityIssue[] = [];
  const warnings: string[] = [];

  const sourceTables = extractTablesWithContent(sourceMarkdown);
  const translatedTables = extractTablesWithContent(translatedMarkdown);

  const sourceBody = stripNonBodyBlocks(sourceMarkdown);
  const translatedBody = stripNonBodyBlocks(translatedMarkdown);

  // ── 1. Structural table matching ──────────────────────────────────────────
  // For each source table, find the best matching translated table by column
  // count, role, row count, and position. Extra translated tables are allowed
  // (e.g. translator correctly added a metadata table absent from source).
  const tableMatches = matchSourceTablesToTranslated(sourceTables, translatedTables);
  let unmatchedSourceTableCount = 0;

  for (let si = 0; si < sourceTables.length; si++) {
    const src = sourceTables[si]!;
    const ti = tableMatches[si]!;

    if (ti === -1) {
      unmatchedSourceTableCount++;
      issues.push({
        code: 'SOURCE_TABLE_MISSING',
        severity: 'retry_required',
        details: `Source table ${si + 1} (${src.columnCount}×${src.dataRowCount}) has no matching table in translation`,
      });
    } else {
      const tr = translatedTables[ti]!;
      if (src.columnCount !== tr.columnCount) {
        issues.push({
          code: 'TABLE_SHAPE_CHANGED',
          severity: 'retry_required',
          details: `Table ${si + 1}: expected ${src.columnCount}×${src.dataRowCount}, got ${tr.columnCount}×${tr.dataRowCount}`,
        });
      } else if (src.dataRowCount !== tr.dataRowCount && src.dataRowCount > 1) {
        warnings.push(`TABLE_ROW_COUNT_CHANGED: Table ${si + 1}: ${src.dataRowCount} → ${tr.dataRowCount} rows`);
      }
    }
  }

  if (unmatchedSourceTableCount > 0) {
    issues.push({
      code: 'TABLE_COUNT_REDUCED',
      severity: 'retry_required',
      details: `${unmatchedSourceTableCount} source table(s) have no match in translation (source: ${sourceTables.length}, translated: ${translatedTables.length})`,
    });
  }

  // ── 2. Source script residue (body-level) ──────────────────────────────────
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

  // ── 3. Source script in table cells ───────────────────────────────────────
  const tableCellFragments = scanTableCellsForSourceScript(translatedMarkdown, sourceLang);
  if (tableCellFragments.length > 0) {
    issues.push({
      code: 'LONG_SOURCE_SCRIPT_FRAGMENT_IN_TABLE',
      severity: 'retry_required',
      details: `${tableCellFragments.length} table cell(s) contain long untranslated fragment(s). Example: "${tableCellFragments[0]!.cellText}" (${tableCellFragments[0]!.fragmentLength} chars)`,
    });
  }

  // ── 4. Unsupported certification identifiers ──────────────────────────────
  const certIssues = checkCertificationIdentifiers(sourceMarkdown, translatedMarkdown);
  for (const ci of certIssues) {
    issues.push({
      code: 'UNSUPPORTED_CERTIFICATION_IDENTIFIER',
      severity: 'retry_required',
      details: ci.details,
    });
  }

  // ── 5. Source page marker before title ───────────────────────────────────
  if (hasPageMarkerBeforeTitle(translatedMarkdown)) {
    issues.push({
      code: 'SOURCE_PAGE_MARKER_BEFORE_TITLE',
      severity: 'retry_required',
      details: 'Translation starts with a page marker (e.g. "Page: 1 / 1") before the document title',
    });
  }

  // ── 6. Metadata structure loss ────────────────────────────────────────────
  const flatKvBlocks = countFlatKvBlocks(translatedBody);
  if (flatKvBlocks > 0) {
    issues.push({
      code: 'METADATA_STRUCTURE_LOST',
      severity: 'retry_required',
      details: `${flatKvBlocks} block(s) of 3+ consecutive "Label: Value" lines found; should be Markdown tables`,
    });
  }

  // ── 7. Section coverage ───────────────────────────────────────────────────
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

  // ── 8. Output length ──────────────────────────────────────────────────────
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

  // ── 9. Protected value coverage ───────────────────────────────────────────
  const pvCoverage = protectedValueCoverage(sourceMarkdown, translatedMarkdown);
  if (pvCoverage < 1.0) {
    const missing = Math.round((1 - pvCoverage) * (sourceMarkdown.match(PV_RE) ?? []).length);
    issues.push({
      code: 'PROTECTED_VALUE_MISSING',
      severity: 'retry_required',
      details: `${missing} protected placeholder(s) missing from translation`,
    });
  }

  // ── 10. Document title ───────────────────────────────────────────────────
  const hasTitle = /^#{1,2}\s+\S/m.test(translatedBody);
  if (!hasTitle && translatedBody.length > 100) {
    issues.push({
      code: 'DOCUMENT_TITLE_MISSING',
      severity: 'warning',
      details: 'No H1/H2 heading found in translation body',
    });
  }

  const metrics: TranslationQualityMetrics = {
    sourceTableCount: sourceTables.length,
    translatedTableCount: translatedTables.length,
    unmatchedSourceTableCount,
    sourceTableShapes: sourceTables.map(t => ({ columns: t.columnCount, rows: t.dataRowCount })),
    translatedTableShapes: translatedTables.map(t => ({ columns: t.columnCount, rows: t.dataRowCount })),
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
      case 'SOURCE_TABLE_MISSING':
        lines.push(`- Include all source tables in the translation. ${issue.details}`);
        break;
      case 'TABLE_SHAPE_CHANGED': {
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
      case 'LONG_SOURCE_SCRIPT_FRAGMENT_IN_TABLE':
        lines.push(`- Translate all source-language content inside table cells. Do not leave long untranslated values. ${issue.details}`);
        break;
      case 'UNSUPPORTED_CERTIFICATION_IDENTIFIER':
        lines.push(`- Do not add certification or accreditation identifiers absent from the source document. ${issue.details}`);
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
  score += (metrics.protectedValueCoverageRatio - 1) * 50;
  if (metrics.sourceTableCount > 0) {
    const tableRatio = metrics.translatedTableCount / metrics.sourceTableCount;
    score += (tableRatio - 1) * 30;
  }
  score -= metrics.remainingSourceScriptRatio * 200;
  score += (metrics.sectionCoverageRatio - 1) * 20;
  if (metrics.lengthRatio < 0.3) score -= 20;
  else if (metrics.lengthRatio > 5.0) score -= 10;
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
  ];
  if (metrics.unmatchedSourceTableCount > 0) {
    parts.push(`unmatched_src=${metrics.unmatchedSourceTableCount}`);
  }
  parts.push(
    `src_script_ratio=${(metrics.remainingSourceScriptRatio * 100).toFixed(1)}%`,
    `long_untranslated=${issues.filter(i => i.code === 'SOURCE_SCRIPT_REMAINS').length}`,
    `section_coverage=${Math.round(metrics.sectionCoverageRatio * 100)}%`,
    `pv_coverage=${Math.round(metrics.protectedValueCoverageRatio * 100)}%`,
    `retry=${extra.retryUsed}`,
    `selected=${extra.selectedResult}`,
  );
  const issueCodes = issues.map(i => `${i.code}(${i.severity[0]})`).join(',');
  if (issueCodes) parts.push(`issues=${issueCodes}`);
  return `translation quality: ${parts.join(' ')}`;
}

// ── Exported helpers for testing ──────────────────────────────────────────────

export { extractCertificationIdentifiers, extractTablesWithContent };
