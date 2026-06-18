/**
 * Universal key-value table normalization for the legacy official pipeline.
 *
 * Converts multi-column KV tables (4-col, etc.) to a canonical 2-column form
 * while preserving every field pair and verifying integrity via an inventory check.
 *
 * NEVER referenced by fixture labels. Classification is structural and
 * context-based, not keyed on specific English/Russian header text.
 */

export type LegacyTableKind =
  | 'key_value'
  | 'data_table'
  | 'visual_elements'
  | 'translator_details'
  | 'unknown';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface KeyValuePairInventoryItem {
  tableIndex: number;
  sourceRowIndex: number;
  pairIndex: number;
  label: string;
  value: string;
}

export interface KeyValueTableInventory {
  tableIndex: number;
  pairCount: number;
  pairs: KeyValuePairInventoryItem[];
}

interface ParsedTable {
  headers: string[];
  rows: string[][];
}

// ─── Data-table detection ─────────────────────────────────────────────────────

// Column headers that indicate a real data table, not a KV field table
const DATA_HEADER_RE =
  /base\s*salary|bonus|compensation|total\s*(gross)?|amount\s*(payable)?|balance|credit|debit|transaction|calculation\s*period|earned|withheld|lab(oratory)?|result|reference\s*range|score|grade|credit\s*hours/i;

// Month name in the first column indicates a time-series data table
const MONTH_NAME_RE =
  /\b(January|February|March|April|May|June|July|August|September|October|November|December|Январь|Февраль|Март|Апрель|Май|Июнь|Июль|Август|Сентябрь|Октябрь|Ноябрь|Декабрь)\b/i;

// Monetary amount: digit followed by 4+ more digits (e.g. "865 000,00 KZT")
const LARGE_AMOUNT_RE = /\d[\d\s]{4,}[,.]?\d*/;

function isDataTable(headers: string[], rows: string[][]): boolean {
  // Data-table keyword in any header
  if (headers.some((h) => DATA_HEADER_RE.test(h))) return true;

  // Only 4-column tables are candidates for KV normalization
  if (headers.length !== 4) return true;

  // Time-series indicator: first column contains month names or large monetary amounts
  for (const row of rows) {
    const col0 = row[0]?.trim() ?? '';
    if (MONTH_NAME_RE.test(col0)) return true;
    if (LARGE_AMOUNT_RE.test(col0) && col0.length > 6) return true;
  }

  return false;
}

// ─── Universal pair flattener ─────────────────────────────────────────────────

/**
 * Split a row of cells into (label, value) pairs by walking cells in steps of 2.
 * Works for rows with 2, 4, 6, or any even number of cells.
 *
 * Rules:
 * - Both cells empty → pair skipped.
 * - Label non-empty, value empty → pair kept.
 * - Label empty, value non-empty → pair kept (warning logged).
 * - Odd cell count → last cell added with empty value (not silently dropped).
 */
export function flattenKeyValueRow(cells: string[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];

  const limit = cells.length % 2 === 0 ? cells.length : cells.length - 1;

  for (let i = 0; i < limit; i += 2) {
    const label = cells[i]?.trim() ?? '';
    const value = cells[i + 1]?.trim() ?? '';
    if (!label && !value) continue;
    if (!label && value) {
      // Advisory: value without label
      console.warn(`[kv-normalizer] value "${value.slice(0, 40)}" has no label — keeping row`);
    }
    pairs.push([label, value]);
  }

  // Odd remainder: last cell without a partner
  if (cells.length % 2 !== 0) {
    const last = cells[cells.length - 1]?.trim() ?? '';
    if (last) {
      pairs.push([last, '']);
    }
  }

  return pairs;
}

// ─── Inventory ────────────────────────────────────────────────────────────────

/**
 * Snapshot all key-value pairs in a table BEFORE normalization.
 * Treats every row (including the header row) as potential data.
 */
export function buildKvInventory(
  tableIndex: number,
  parsed: ParsedTable,
): KeyValueTableInventory {
  const pairs: KeyValuePairInventoryItem[] = [];
  const allRows = [parsed.headers, ...parsed.rows];

  for (let rowIdx = 0; rowIdx < allRows.length; rowIdx++) {
    const rowPairs = flattenKeyValueRow(allRows[rowIdx] ?? []);
    for (let pairIdx = 0; pairIdx < rowPairs.length; pairIdx++) {
      const [label, value] = rowPairs[pairIdx]!;
      pairs.push({ tableIndex, sourceRowIndex: rowIdx, pairIndex: pairIdx, label, value });
    }
  }

  return { tableIndex, pairCount: pairs.length, pairs };
}

/**
 * Verify that a normalized table preserved every non-empty pair from the inventory.
 * The normalized table has generic headers — only data rows are counted.
 *
 * Returns `{ valid: true }` on success.
 * Returns `{ valid: false, issue: 'KEY_VALUE_NORMALIZATION_DATA_LOSS: ...' }` on failure.
 */
export function verifyKvInventory(
  before: KeyValueTableInventory,
  normalizedParsed: ParsedTable,
): { valid: boolean; issue?: string } {
  // Only count data rows (not the generic 'Field | Value' header row)
  const afterPairs: Array<[string, string]> = [];
  for (const row of normalizedParsed.rows) {
    const label = row[0]?.trim() ?? '';
    const value = row[1]?.trim() ?? '';
    if (label || value) {
      afterPairs.push([label, value]);
    }
  }

  const beforeNonEmpty = before.pairs.filter((p) => p.label.trim() || p.value.trim());

  if (beforeNonEmpty.length !== afterPairs.length) {
    return {
      valid: false,
      issue: `KEY_VALUE_NORMALIZATION_DATA_LOSS: pair count before=${beforeNonEmpty.length} after=${afterPairs.length}`,
    };
  }

  // Each original pair must appear in the normalized output
  for (const { label, value } of beforeNonEmpty) {
    const found = afterPairs.some(([l, v]) => l === label && v === value);
    if (!found) {
      return {
        valid: false,
        issue: `KEY_VALUE_NORMALIZATION_DATA_LOSS: pair ("${label.slice(0, 30)}", "${value.slice(0, 30)}") missing`,
      };
    }
  }

  return { valid: true };
}

// ─── Normalization ────────────────────────────────────────────────────────────

/**
 * Normalize a 4-column KV ParsedTable to a 2-column table.
 *
 * The header row of the original table is treated as a data pair row (not column
 * titles), because in production KV tables every row — including the first —
 * contains field label/value data.
 *
 * The normalized table has a generic 'Field | Value' header row.
 *
 * @param opts.kind  - If 'visual_elements', 'data_table', or 'translator_details', the
 *                     table is returned unchanged.
 * @param opts.tableIndex - Used for inventory tracking (advisory warnings only).
 */
export function normalizeKvParsedTable(
  parsed: ParsedTable,
  opts: { kind?: LegacyTableKind; tableIndex?: number } = {},
): ParsedTable {
  const { kind, tableIndex = 0 } = opts;

  // Tables with known non-KV kind are never normalized
  if (
    kind === 'visual_elements' ||
    kind === 'data_table' ||
    kind === 'translator_details'
  ) {
    return parsed;
  }

  // Only normalize 4-column tables
  if (parsed.headers.length !== 4) return parsed;

  // Skip known data-table structures
  if (isDataTable(parsed.headers, parsed.rows)) return parsed;

  // Build inventory BEFORE normalization
  const inventory = buildKvInventory(tableIndex, parsed);

  // Treat ALL rows (header + data) as data pair rows
  const allRows = [parsed.headers, ...parsed.rows];
  const newDataRows: string[][] = [];

  for (const row of allRows) {
    const pairs = flattenKeyValueRow(row);
    for (const [label, value] of pairs) {
      newDataRows.push([label, value]);
    }
  }

  const normalizedParsed: ParsedTable = {
    headers: ['Field', 'Value'],
    rows: newDataRows,
  };

  // Invariant verification — on failure, fall back to original table
  const check = verifyKvInventory(inventory, normalizedParsed);
  if (!check.valid) {
    console.warn(`[kv-normalizer] ${check.issue} — rendering original table without normalization`);
    return parsed;
  }

  return normalizedParsed;
}

// ─── String-level normalization (used for tests and text-level operations) ────

function parseRow(line: string): string[] {
  return line
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());
}

/**
 * Apply KV normalization to a raw markdown string.
 * Handles 4-column KV tables; leaves all others unchanged.
 */
export function normalizeKvTables(markdown: string): string {
  const lines = markdown.split('\n');
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';

    if (line.trim().startsWith('|') && i + 1 < lines.length) {
      const nextLine = lines[i + 1] ?? '';
      if (/^\|?[\s\-|:]+\|?$/.test(nextLine.trim())) {
        const tableLines: string[] = [line];
        i++;
        while (i < lines.length && (lines[i] ?? '').trim().startsWith('|')) {
          tableLines.push(lines[i] ?? '');
          i++;
        }

        const headers = parseRow(tableLines[0] ?? '');
        const dataRows = tableLines.slice(2).map(parseRow);

        if (headers.length === 4 && !isDataTable(headers, dataRows)) {
          // Normalize: treat header row as data pairs too
          const allRows = [headers, ...dataRows];
          result.push(`| Field | Value |`);
          result.push(`|---|---|`);
          for (const row of allRows) {
            const pairs = flattenKeyValueRow(row);
            for (const [label, value] of pairs) {
              result.push(`| ${label} | ${value} |`);
            }
          }
        } else {
          result.push(...tableLines);
        }
        continue;
      }
    }

    result.push(line);
    i++;
  }

  return result.join('\n');
}
