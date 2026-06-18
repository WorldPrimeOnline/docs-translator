/**
 * Financial document block classification.
 *
 * Classifies parsed Markdown table blocks by their semantic role in a
 * financial document. Language-agnostic: uses structural signals only.
 *
 * NOT document AST. This is renderer metadata for layout decisions.
 */

export type FinancialDocumentBlockKind =
  | 'metadata'      // Header KV block: company, invoice number, date
  | 'line_items'    // Item table: wide, many rows, repeated pattern
  | 'tax_summary'   // VAT/tax breakdown: 3-6 cols, few rows
  | 'amount_in_words' // Amount written as text
  | 'totals'        // Summary totals: 2-3 cols, label+amount
  | 'terms_conditions' // T&C text block
  | 'payment_breakdown' // Payment method split: cash/deposit/voucher
  | 'notes'         // Free-text notes
  | 'generic_table'; // Unclassified

export interface FinancialBlockClassification {
  kind: FinancialDocumentBlockKind;
  columnCount: number;
  /** True when columnCount >= 7; triggers landscape rendering. */
  isWide: boolean;
}

// ── Structural signal helpers ─────────────────────────────────────────────────

function numericDensity(rows: string[][]): number {
  let numericCells = 0;
  let totalCells = 0;
  for (const row of rows) {
    for (const cell of row) {
      totalCells++;
      if (/[\d,.]/.test(cell)) numericCells++;
    }
  }
  return totalCells > 0 ? numericCells / totalCells : 0;
}

function hasRepeatedRowPattern(rows: string[][]): boolean {
  if (rows.length < 3) return false;
  const filled = rows.map(r => r.filter(c => c.trim().length > 0).length);
  if (filled.length === 0) return false;
  const median = filled.slice().sort((a, b) => a - b)[Math.floor(filled.length / 2)] ?? 0;
  return filled.filter(c => Math.abs(c - median) <= 1).length / filled.length >= 0.6;
}

// Check for VAT/tax keywords, language-agnostic by structure + common codes
const TAX_KEYWORD_RE = /\b(vat|gst|nhso|tax|excise|ภาษี|налог|ндс)\b/i;

// Payment method keywords
const PAYMENT_KEYWORD_RE = /\b(pod|cash|deposit|coupon|voucher|cheque|credit|transfer)\b/i;

// Amount-in-words signals: long text (>20 chars) in a narrow table
const AMOUNT_WORDS_HEADER_RE = /\b(amount|sum|total|paid|payable|words|письм|прописью|สุทธิ|จ่าย)\b/i;

/**
 * Classify a parsed markdown table by semantic role.
 *
 * @param headers  Parsed header row cells
 * @param rows     Parsed data rows
 * @param context  Optional hints (position in doc, heading above, etc.)
 */
export function classifyFinancialBlock(
  headers: string[],
  rows: string[][],
): FinancialBlockClassification {
  const colCount = headers.length;
  const isWide = colCount >= 7;

  // 1. Wide tables with repeated row structure → line items
  if (isWide && rows.length >= 3 && hasRepeatedRowPattern(rows)) {
    return { kind: 'line_items', columnCount: colCount, isWide };
  }

  // 2. Wide table with few rows might still be line items (small invoice)
  if (isWide) {
    return { kind: 'line_items', columnCount: colCount, isWide };
  }

  const allText = [...headers, ...rows.flat()].join(' ');
  const density = numericDensity(rows);

  // 3. Amount in words: 1-2 cols, long cell text, headers mention amount/sum
  if (colCount <= 2 && rows.length <= 3 && AMOUNT_WORDS_HEADER_RE.test(headers.join(' '))) {
    const hasLongText = rows.some(r => r.join('').length > 20);
    if (hasLongText) {
      return { kind: 'amount_in_words', columnCount: colCount, isWide: false };
    }
  }

  // 4. Tax summary: 3-6 cols, few rows, tax keywords, numeric
  if (colCount >= 3 && colCount <= 6 && rows.length <= 12 && TAX_KEYWORD_RE.test(allText) && density > 0.35) {
    return { kind: 'tax_summary', columnCount: colCount, isWide: false };
  }

  // 5. Payment breakdown: small table, payment keywords in headers
  if (colCount >= 2 && colCount <= 5 && rows.length <= 6 && PAYMENT_KEYWORD_RE.test(headers.join(' '))) {
    return { kind: 'payment_breakdown', columnCount: colCount, isWide: false };
  }

  // 6. Totals: 2-3 cols, few rows, high numeric density, label+amount pattern
  if (colCount <= 3 && rows.length <= 12 && density > 0.3) {
    return { kind: 'totals', columnCount: colCount, isWide: false };
  }

  return { kind: 'generic_table', columnCount: colCount, isWide };
}

/**
 * Compute column widths (in DXA units) for an 8-column line-item table
 * in a landscape A4 section (usable width ≈ 13680 DXA with narrow margins).
 *
 * Returns widths in DXA. The percentages are adaptive based on column count.
 */
export function computeLineItemColumnWidths(colCount: number, usableWidthDxa: number): number[] {
  if (colCount === 8) {
    // Recommended: item 6%, article 11%, description 35%, qty 10%, unit 10%, price 10%, vat 7%, total 11%
    const pct = [0.06, 0.11, 0.35, 0.10, 0.10, 0.10, 0.07, 0.11];
    return pct.map(p => Math.round(p * usableWidthDxa));
  }
  if (colCount === 7) {
    // Drop article column: item 7%, description 38%, qty 11%, unit 11%, price 11%, vat 9%, total 13%
    const pct = [0.07, 0.38, 0.11, 0.11, 0.11, 0.09, 0.13];
    return pct.map(p => Math.round(p * usableWidthDxa));
  }
  // Generic: equal distribution
  return Array.from({ length: colCount }, () => Math.round(usableWidthDxa / colCount));
}
