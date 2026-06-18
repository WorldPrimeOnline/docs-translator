/**
 * KV table normalization — converts 4-column key-value tables to 2 columns.
 *
 * Some translation outputs produce layout like:
 *   | Label 1 | Value 1 | Label 2 | Value 2 |
 *
 * which should be:
 *   | Label 1 | Value 1 |
 *   | Label 2 | Value 2 |
 *
 * Only applies to tables classified as key-value field tables.
 * Data tables (income, transactions, transcripts) are left unchanged.
 */

// Headers that indicate a data table, not a KV field table
const DATA_HEADER_RE =
  /base\s*salary|bonus|compensation|total\s*(gross)?|amount\s*(payable)?|balance|credit|debit|transaction|calculation\s*period|period|earned|withheld|lab(oratory)?|result|reference\s*range|score|grade|credit\s*hours/i;

// Cell content that looks like a data value (date period or monetary amount)
const MONTH_NAME_RE =
  /\b(January|February|March|April|May|June|July|August|September|October|November|December|Январь|Февраль|Март|Апрель|Май|Июнь|Июль|Август|Сентябрь|Октябрь|Ноябрь|Декабрь)\b/i;

const LARGE_NUMBER_RE = /\d[\d\s]{4,}[,.]?\d*/; // 5+ digit sequences (monetary amounts)

function isDataTable(headers: string[], rows: string[][]): boolean {
  // Check headers for data table keywords
  if (headers.some((h) => DATA_HEADER_RE.test(h))) return true;

  // If more or fewer than 4 columns, not applicable
  if (headers.length !== 4) return true;

  // Check if any first-column cell looks like a date period (data table row)
  for (const row of rows) {
    const col0 = row[0]?.trim() ?? '';
    if (MONTH_NAME_RE.test(col0)) return true;
    if (LARGE_NUMBER_RE.test(col0) && col0.length > 6) return true;
  }

  return false;
}

interface ParsedTable {
  headers: string[];
  rows: string[][];
}

function parseRow(line: string): string[] {
  return line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
}

/**
 * Given a ParsedTable with 4 columns that passes the KV heuristic,
 * normalize it to a 2-column ParsedTable.
 * Each 4-cell row → two 2-cell rows (second pair only if non-empty).
 */
export function normalizeKvParsedTable(parsed: ParsedTable): ParsedTable {
  if (parsed.headers.length !== 4) return parsed;
  if (isDataTable(parsed.headers, parsed.rows)) return parsed;

  const newHeaders = [parsed.headers[0] ?? 'Field', parsed.headers[1] ?? 'Value'];
  const newRows: string[][] = [];

  for (const row of parsed.rows) {
    const [l1, v1, l2, v2] = [row[0] ?? '', row[1] ?? '', row[2] ?? '', row[3] ?? ''];
    if (l1 || v1) newRows.push([l1, v1]);
    if (l2 || v2) newRows.push([l2, v2]);
  }

  return { headers: newHeaders, rows: newRows };
}

/**
 * Apply KV normalization to a raw markdown string.
 * Used for testing and text-level operations.
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
        // Collect all table lines
        const tableLines: string[] = [line];
        i++;
        while (i < lines.length && (lines[i] ?? '').trim().startsWith('|')) {
          tableLines.push(lines[i] ?? '');
          i++;
        }

        const headers = parseRow(tableLines[0] ?? '');
        const dataRows = tableLines.slice(2).map(parseRow);

        if (headers.length === 4 && !isDataTable(headers, dataRows)) {
          // Normalize to 2 columns
          const h1 = headers[0] ?? 'Field';
          const h2 = headers[1] ?? 'Value';
          result.push(`| ${h1} | ${h2} |`);
          result.push(`|---|---|`);
          for (const row of dataRows) {
            const [l1, v1, l2, v2] = [row[0] ?? '', row[1] ?? '', row[2] ?? '', row[3] ?? ''];
            if (l1 || v1) result.push(`| ${l1} | ${v1} |`);
            if (l2 || v2) result.push(`| ${l2} | ${v2} |`);
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
