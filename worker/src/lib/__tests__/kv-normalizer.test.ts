import {
  normalizeKvTables,
  normalizeKvParsedTable,
  flattenKeyValueRow,
  buildKvInventory,
  verifyKvInventory,
} from '../kv-normalizer';
import {
  MULTI_PAIR_FIXTURE_MARKDOWN,
  REQUIRED_VALUES,
  REQUIRED_LABELS,
  VISUAL_TABLE_FIXTURE,
} from './fixtures/legacy-multi-pair-document';

// ─── flattenKeyValueRow ───────────────────────────────────────────────────────

describe('flattenKeyValueRow', () => {
  test('2 cells → 1 pair', () => {
    expect(flattenKeyValueRow(['Name', 'John'])).toEqual([['Name', 'John']]);
  });

  test('4 cells → 2 pairs', () => {
    expect(flattenKeyValueRow(['A', 'B', 'C', 'D'])).toEqual([['A', 'B'], ['C', 'D']]);
  });

  test('6 cells → 3 pairs', () => {
    expect(flattenKeyValueRow(['A', 'B', 'C', 'D', 'E', 'F'])).toEqual([
      ['A', 'B'],
      ['C', 'D'],
      ['E', 'F'],
    ]);
  });

  test('empty pair in middle is skipped', () => {
    expect(flattenKeyValueRow(['Name', 'John', '', ''])).toEqual([['Name', 'John']]);
  });

  test('empty first pair, non-empty second pair → only second pair', () => {
    expect(flattenKeyValueRow(['', '', 'Name', 'John'])).toEqual([['Name', 'John']]);
  });

  test('label non-empty, value empty → pair kept', () => {
    expect(flattenKeyValueRow(['Label', '', 'X', 'Y'])).toEqual([['Label', ''], ['X', 'Y']]);
  });

  test('odd cell count does not drop last cell', () => {
    const pairs = flattenKeyValueRow(['A', 'B', 'C']);
    expect(pairs).toHaveLength(2);
    expect(pairs[0]).toEqual(['A', 'B']);
    expect(pairs[1]).toEqual(['C', '']); // odd cell preserved with empty value
  });

  test('all cells empty → empty result', () => {
    expect(flattenKeyValueRow(['', '', '', ''])).toEqual([]);
  });
});

// ─── KvInventory ─────────────────────────────────────────────────────────────

describe('buildKvInventory / verifyKvInventory', () => {
  const parsed = {
    headers: ['Employer name', 'Acme Corp', 'Certificate number', 'CRT-001'],
    rows: [
      ['BIN', '1234567890', 'Date of issue', 'Jan 1, 2025'],
      ['Valid until', 'Dec 31, 2025', '', ''],
    ],
  };

  test('buildKvInventory counts all non-empty pairs from all rows', () => {
    const inv = buildKvInventory(0, parsed);
    // Header row: 2 non-empty pairs; row 0: 2 pairs; row 1: 1 pair (empty second)
    expect(inv.pairCount).toBe(5);
  });

  test('verifyKvInventory passes after correct normalization', () => {
    const inv = buildKvInventory(0, parsed);
    const norm = normalizeKvParsedTable(parsed);
    const result = verifyKvInventory(inv, norm);
    expect(result.valid).toBe(true);
  });

  test('verifyKvInventory detects data loss', () => {
    const inv = buildKvInventory(0, parsed);
    // Simulate a broken normalized table that drops a value
    const brokenNorm = {
      headers: ['Field', 'Value'],
      rows: [
        ['Employer name', 'Acme Corp'],
        // 'Certificate number' / 'CRT-001' intentionally dropped
        ['BIN', '1234567890'],
      ],
    };
    const result = verifyKvInventory(inv, brokenNorm);
    expect(result.valid).toBe(false);
    expect(result.issue).toContain('KEY_VALUE_NORMALIZATION_DATA_LOSS');
  });
});

// ─── normalizeKvTables — string level ────────────────────────────────────────

describe('normalizeKvTables — string level', () => {
  test('normalizes 4-col KV table to 2 columns, all values preserved', () => {
    const input = [
      '| Employer | Acme | Contract | CRT-001 |',
      '|---|---|---|---|',
      '| Full Name | JOHN DOE | Date of Birth | 01.01.1990 |',
    ].join('\n');
    const result = normalizeKvTables(input);
    const lines = result.trim().split('\n');
    expect(lines[0]!.split('|').filter(Boolean).map((s) => s.trim())).toHaveLength(2);
    expect(result).toContain('Employer');
    expect(result).toContain('Acme');
    expect(result).toContain('Contract');
    expect(result).toContain('CRT-001');
    expect(result).toContain('Full Name');
    expect(result).toContain('JOHN DOE');
    expect(result).toContain('Date of Birth');
    expect(result).toContain('01.01.1990');
    const dataRows = lines.slice(2); // skip header + separator
    expect(dataRows.length).toBeGreaterThanOrEqual(4); // 2 from header + 2 from data
  });

  test('does NOT normalize 6-col income table', () => {
    const input = [
      '| Calculation period | Base salary | Bonus | Compensation | Total gross amount | Amount payable |',
      '|----|----|----|----|----|---|',
      '| March 2026 | 865 000,00 KZT | 95 000,00 KZT | 28 500,00 KZT | 988 500,00 KZT | 801 472,35 KZT |',
    ].join('\n');
    const result = normalizeKvTables(input);
    const lines = result.trim().split('\n');
    expect(lines[0]!.split('|').filter(Boolean).map((s) => s.trim())).toHaveLength(6);
  });

  test('does NOT normalize 4-col table with "Base salary" header', () => {
    const input = [
      '| Period | Base salary | Bonus | Total |',
      '|---|---|---|---|',
      '| March | 1000 | 200 | 1200 |',
    ].join('\n');
    const result = normalizeKvTables(input);
    const lines = result.trim().split('\n');
    expect(lines[0]!.split('|').filter(Boolean).map((s) => s.trim())).toHaveLength(4);
  });

  test('does NOT normalize 4-col table where first column contains month names', () => {
    const input = [
      '| Month | Income | Deductions | Net |',
      '|---|---|---|---|',
      '| January | 5000 | 500 | 4500 |',
    ].join('\n');
    const result = normalizeKvTables(input);
    const lines = result.trim().split('\n');
    expect(lines[0]!.split('|').filter(Boolean).map((s) => s.trim())).toHaveLength(4);
  });

  test('passes through 2-col tables unchanged', () => {
    const input = ['| Field | Value |', '|---|---|', '| Name | JOHN |'].join('\n');
    expect(normalizeKvTables(input)).toBe(input);
  });

  test('does not alter non-table content', () => {
    const input = '## Section\n\nSome paragraph text.\n\n- bullet item';
    expect(normalizeKvTables(input)).toBe(input);
  });

  test('empty second pair in data row is not emitted', () => {
    const input = [
      '| Employer | Acme | Contract | CRT-001 |',
      '|---|---|---|---|',
      '| Name | John |  |  |', // empty second pair in data row
    ].join('\n');
    const result = normalizeKvTables(input);
    // Header pairs: ("Employer", "Acme"), ("Contract", "CRT-001")
    // Data pairs: ("Name", "John")   — empty pair dropped
    const dataLines = result.split('\n').filter((l) => l.trim().startsWith('|') && !l.includes('---'));
    expect(dataLines).toHaveLength(4); // header + 3 data rows
    expect(result).not.toContain('|  |'); // no empty-cell rows
  });
});

// ─── normalizeKvParsedTable — parsed level ────────────────────────────────────

describe('normalizeKvParsedTable — parsed level', () => {
  test('normalizes 4-col KV parsed table; header row treated as data pairs', () => {
    const parsed = {
      headers: ['Employer name', 'Acme Corp', 'Certificate number', 'CRT-001'],
      rows: [
        ['Full Name', 'John Doe', 'Date of Birth', '01.01.1990'],
        ['Position', 'Engineer', 'Department', 'IT'],
      ],
    };
    const result = normalizeKvParsedTable(parsed);
    // Generic column headers
    expect(result.headers).toEqual(['Field', 'Value']);
    // All pairs preserved: 2 from header + 4 from data = 6 rows
    expect(result.rows).toHaveLength(6);
    // Header pairs come first
    expect(result.rows[0]).toEqual(['Employer name', 'Acme Corp']);
    expect(result.rows[1]).toEqual(['Certificate number', 'CRT-001']);
    // Data pairs follow
    expect(result.rows[2]).toEqual(['Full Name', 'John Doe']);
    expect(result.rows[3]).toEqual(['Date of Birth', '01.01.1990']);
    expect(result.rows[4]).toEqual(['Position', 'Engineer']);
    expect(result.rows[5]).toEqual(['Department', 'IT']);
  });

  test('returns unchanged table (same reference) for non-4-col input', () => {
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

  test('returns unchanged table when kind=visual_elements', () => {
    const parsed = {
      headers: ['Source page', 'Element', 'Position', 'Representation in translation'],
      rows: [
        ['1', 'Logo', 'header', 'Company logo'],
        ['1', 'Stamp/Seal', 'lower centre', 'Round company stamp'],
      ],
    };
    const result = normalizeKvParsedTable(parsed, { kind: 'visual_elements' });
    expect(result).toBe(parsed); // exact same reference
    expect(result.headers).toHaveLength(4);
  });

  test('returns unchanged table when kind=data_table', () => {
    const parsed = {
      headers: ['Month', 'Income', 'Deductions', 'Net'],
      rows: [['January', '5000', '500', '4500']],
    };
    expect(normalizeKvParsedTable(parsed, { kind: 'data_table' })).toBe(parsed);
  });

  test('empty row second pair is not emitted as a row', () => {
    const parsed = {
      headers: ['Employer', 'Acme Corp', 'BIN', '12345'],
      rows: [['Valid until', 'Dec 31, 2025', '', '']],
    };
    const result = normalizeKvParsedTable(parsed);
    // Header: 2 pairs; data row: 1 pair (empty second skipped)
    expect(result.rows).toHaveLength(3);
    expect(result.rows.every((r) => r[0] !== '' || r[1] !== '')).toBe(true);
  });
});

// ─── Multi-pair fixture ───────────────────────────────────────────────────────

describe('multi-pair fixture — all required values preserved', () => {
  test('all required values survive normalizeKvTables', () => {
    const normalized = normalizeKvTables(MULTI_PAIR_FIXTURE_MARKDOWN);
    for (const v of REQUIRED_VALUES) {
      expect(normalized).toContain(v);
    }
  });

  test('all required labels survive normalizeKvTables', () => {
    const normalized = normalizeKvTables(MULTI_PAIR_FIXTURE_MARKDOWN);
    for (const l of REQUIRED_LABELS) {
      expect(normalized).toContain(l);
    }
  });

  test('SALARY table is NOT normalized (6-col data table)', () => {
    const normalized = normalizeKvTables(MULTI_PAIR_FIXTURE_MARKDOWN);
    // The SALARY header must still have 6 cells
    const salaryHeaderLine = normalized
      .split('\n')
      .find((l) => l.includes('Calculation period'));
    expect(salaryHeaderLine).toBeTruthy();
    const cellCount = salaryHeaderLine!.split('|').filter((s) => s.trim()).length;
    expect(cellCount).toBe(6);
  });

  test('EMPLOYER KV table is normalized to 2 columns', () => {
    const normalized = normalizeKvTables(MULTI_PAIR_FIXTURE_MARKDOWN);
    const employerLine = normalized
      .split('\n')
      .find((l) => l.includes('Employer name') && l.includes('|'));
    expect(employerLine).toBeTruthy();
    const cellCount = employerLine!.split('|').filter((s) => s.trim()).length;
    expect(cellCount).toBe(2);
  });
});

// ─── Visual table fixture — must NOT be normalized ───────────────────────────

describe('visual elements table — not normalized via kind param', () => {
  test('4-col visual table stays 4-col when kind=visual_elements', () => {
    const parsed = {
      headers: ['Source page', 'Element', 'Position', 'Representation in translation'],
      rows: Array.from({ length: 6 }, (_, i) => [
        String(i + 1),
        'Stamp',
        'lower centre',
        'Round company stamp',
      ]),
    };
    const result = normalizeKvParsedTable(parsed, { kind: 'visual_elements' });
    expect(result.headers).toHaveLength(4);
    expect(result.rows).toHaveLength(6);
  });

  test('visual elements fixture markdown is left intact (no kind override at string level)', () => {
    // At string level there is no kind param — isDataTable must NOT catch visual tables
    // via structural heuristics (page numbers 1,2,3 are not month names or large amounts)
    // Therefore the visual table WILL be normalized at string level when kind is absent.
    // This test documents the known behavior: string-level normalization doesn't have
    // the visual section context; only the docx-renderer call (with kind param) is safe.
    const result = normalizeKvTables(VISUAL_TABLE_FIXTURE);
    // Just verify all element names survive (not testing column count here)
    expect(result).toContain('Logo');
    expect(result).toContain('Watermark');
    expect(result).toContain('Signature');
    expect(result).toContain('Stamp/Seal');
    expect(result).toContain('QR code');
  });
});
