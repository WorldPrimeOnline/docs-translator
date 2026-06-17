export type MarkdownTableShape = {
  tableIndex: number;
  columnCount: number;
  dataRowCount: number;
};

export type TableShapeMismatch = {
  tableIndex: number;
  expected: MarkdownTableShape;
  actual: MarkdownTableShape;
  issues: string[];
};

export function extractMarkdownTableShapes(markdown: string): MarkdownTableShape[] {
  const lines = markdown.split('\n');
  const shapes: MarkdownTableShape[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.includes('|') && i + 1 < lines.length) {
      const nextLine = lines[i + 1] ?? '';
      if (/^\|?[\s\-:|]+\|?$/.test(nextLine)) {
        const columnCount = line.replace(/^\||\|$/g, '').split('|').length;
        i += 2; // skip header + separator
        let dataRowCount = 0;
        while (i < lines.length && (lines[i] ?? '').includes('|')) {
          dataRowCount++;
          i++;
        }
        shapes.push({ tableIndex: shapes.length, columnCount, dataRowCount });
        continue;
      }
    }
    i++;
  }

  return shapes;
}

export function compareMarkdownTableShapes(
  source: MarkdownTableShape[],
  translated: MarkdownTableShape[],
): TableShapeMismatch[] {
  const mismatches: TableShapeMismatch[] = [];

  if (source.length !== translated.length) {
    const maxLen = Math.max(source.length, translated.length);
    for (let i = 0; i < maxLen; i++) {
      const s = source[i];
      const t = translated[i];
      if (!s || !t) {
        mismatches.push({
          tableIndex: i,
          expected: s ?? { tableIndex: i, columnCount: 0, dataRowCount: 0 },
          actual: t ?? { tableIndex: i, columnCount: 0, dataRowCount: 0 },
          issues: [
            !s
              ? `Table ${i + 1} not found in source`
              : `Table ${i + 1} missing in translation (source has ${s.columnCount} columns, ${s.dataRowCount} data rows)`,
          ],
        });
      }
    }
    return mismatches;
  }

  for (let i = 0; i < source.length; i++) {
    const s = source[i]!;
    const t = translated[i]!;
    const issues: string[] = [];

    if (s.columnCount !== t.columnCount) {
      issues.push(`Table ${i + 1} must contain ${s.columnCount} columns, not ${t.columnCount}.`);
    }
    if (s.dataRowCount !== t.dataRowCount) {
      issues.push(`Table ${i + 1} must contain ${s.dataRowCount} data rows.`);
    }

    if (issues.length > 0) {
      mismatches.push({ tableIndex: i, expected: s, actual: t, issues });
    }
  }

  return mismatches;
}

export function buildTableCorrectionPrompt(mismatches: TableShapeMismatch[]): string {
  const lines: string[] = [
    'The previous translation changed the source table structure.',
    '',
    'Required corrections:',
  ];

  for (const mismatch of mismatches) {
    for (const issue of mismatch.issues) {
      lines.push(`- ${issue}`);
    }
  }

  lines.push('- Do not remove, merge, reorder or invent columns or rows.');
  lines.push('- Preserve every placeholder exactly.');
  lines.push('');
  lines.push('Return the complete translated document again.');

  return lines.join('\n');
}
