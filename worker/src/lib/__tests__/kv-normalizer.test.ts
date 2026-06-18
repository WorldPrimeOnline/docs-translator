import { normalizeKvTables, normalizeKvParsedTable } from '../kv-normalizer';

describe('normalizeKvTables — string level', () => {
  test('normalizes 4-col KV table to 2 columns', () => {
    const input = [
      '| Field | Value | Field | Value |',
      '|---|---|---|---|',
      '| Full Name | JOHN DOE | Date of Birth | 01.01.1990 |',
    ].join('\n');
    const result = normalizeKvTables(input);
    const lines = result.trim().split('\n');
    // Header should have 2 columns
    expect(lines[0]!.split('|').filter(Boolean).map(s => s.trim())).toHaveLength(2);
    // Both pairs preserved
    expect(result).toContain('Full Name');
    expect(result).toContain('JOHN DOE');
    expect(result).toContain('Date of Birth');
    expect(result).toContain('01.01.1990');
    // 4 data rows from 2 original 4-col rows
    const dataRows = lines.slice(2); // skip header + separator
    expect(dataRows.length).toBeGreaterThanOrEqual(2);
  });

  test('does NOT normalize 6-col income table', () => {
    const input = [
      '| Calculation period | Base salary | Bonus | Compensation | Total gross amount | Amount payable |',
      '|----|----|----|----|----|---|',
      '| March 2026 | 865 000,00 KZT | 95 000,00 KZT | 28 500,00 KZT | 988 500,00 KZT | 801 472,35 KZT |',
    ].join('\n');
    const result = normalizeKvTables(input);
    const lines = result.trim().split('\n');
    expect(lines[0]!.split('|').filter(Boolean).map(s => s.trim())).toHaveLength(6);
  });

  test('does NOT normalize 4-col table with "Base salary" header', () => {
    const input = [
      '| Period | Base salary | Bonus | Total |',
      '|---|---|---|---|',
      '| March | 1000 | 200 | 1200 |',
    ].join('\n');
    const result = normalizeKvTables(input);
    const lines = result.trim().split('\n');
    expect(lines[0]!.split('|').filter(Boolean).map(s => s.trim())).toHaveLength(4);
  });

  test('does NOT normalize 4-col table where first column contains month names', () => {
    const input = [
      '| Month | Income | Deductions | Net |',
      '|---|---|---|---|',
      '| January | 5000 | 500 | 4500 |',
    ].join('\n');
    const result = normalizeKvTables(input);
    const lines = result.trim().split('\n');
    expect(lines[0]!.split('|').filter(Boolean).map(s => s.trim())).toHaveLength(4);
  });

  test('passes through 2-col tables unchanged', () => {
    const input = [
      '| Field | Value |',
      '|---|---|',
      '| Name | JOHN |',
    ].join('\n');
    expect(normalizeKvTables(input)).toBe(input);
  });

  test('does not alter non-table content', () => {
    const input = '## Section\n\nSome paragraph text.\n\n- bullet item';
    expect(normalizeKvTables(input)).toBe(input);
  });

  test('second pair omitted when both cells empty', () => {
    const input = [
      '| F | V | F | V |',
      '|---|---|---|---|',
      '| Name | John |  |  |',
    ].join('\n');
    const result = normalizeKvTables(input);
    // Should only produce 1 data row (empty second pair dropped)
    const dataLines = result.split('\n').filter(l => l.trim().startsWith('|') && !l.includes('---'));
    expect(dataLines).toHaveLength(2); // header + 1 data
  });
});

describe('normalizeKvParsedTable — parsed level', () => {
  test('normalizes 4-col KV parsed table', () => {
    const parsed = {
      headers: ['Field A', 'Value A', 'Field B', 'Value B'],
      rows: [
        ['Full Name', 'John Doe', 'Date of Birth', '01.01.1990'],
        ['Position', 'Engineer', 'Department', 'IT'],
      ],
    };
    const result = normalizeKvParsedTable(parsed);
    expect(result.headers).toHaveLength(2);
    expect(result.headers[0]).toBe('Field A');
    expect(result.headers[1]).toBe('Value A');
    // 4 rows from 2 original 4-col rows
    expect(result.rows).toHaveLength(4);
    expect(result.rows[0]).toEqual(['Full Name', 'John Doe']);
    expect(result.rows[1]).toEqual(['Date of Birth', '01.01.1990']);
    expect(result.rows[2]).toEqual(['Position', 'Engineer']);
    expect(result.rows[3]).toEqual(['Department', 'IT']);
  });

  test('returns unchanged table for non-4-col input', () => {
    const parsed = {
      headers: ['A', 'B', 'C', 'D', 'E', 'F'],
      rows: [['1', '2', '3', '4', '5', '6']],
    };
    expect(normalizeKvParsedTable(parsed)).toBe(parsed);
  });

  test('returns unchanged table when headers look like data table', () => {
    const parsed = {
      headers: ['Period', 'Base salary', 'Bonus', 'Total'],
      rows: [['March 2026', '1000', '200', '1200']],
    };
    expect(normalizeKvParsedTable(parsed)).toBe(parsed);
  });
});
