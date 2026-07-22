/** Minimal RFC4180-ish CSV writer — no external dependency, the schema is small and fixed. */
export function toCsvValue(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  const lines = [headers.map(toCsvValue).join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => toCsvValue(row[h])).join(','));
  }
  return lines.join('\n') + '\n';
}
