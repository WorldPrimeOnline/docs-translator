import { extractAndProtectValues, restoreProtectedValues } from '../protected-values';
import { extractMarkdownTableShapes, compareMarkdownTableShapes } from '../table-shape';

const FIXTURE_MARKDOWN = `
# CERTIFICATE OF EMPLOYMENT

## Organization Details
| Field | Value |
|-------|-------|
| Organization | SML Group LLP |
| BIN | 047291638 |
| Certificate No. | SML-2026-06-17-071 |

## Employee Details
| Field | Value |
|-------|-------|
| Full Name | YUDENOV GLEB ALEXANDROVICH |
| IIN | 201240012345 |
| Passport | N14720583 |

## Employment Details
| Field | Value |
|-------|-------|
| Position | Senior Software Engineer |
| Contract | TD-2020/0914-38 |
| Department | Information Technology |

## Salary Information
| Calculation period | Base salary | Bonus | Compensation | Total gross amount | Amount payable |
|--------------------|-------------|-------|--------------|-------------------|----------------|
| March 2026 | 865 000,00 KZT | 95 000,00 KZT | 28 500,00 KZT | 988 500,00 KZT | 801 472,35 KZT |
| April 2026 | 865 000,00 KZT | 0,00 KZT | 28 500,00 KZT | 893 500,00 KZT | 724 618,10 KZT |
| May 2026 | 865 000,00 KZT | 127 500,00 KZT | 34 750,00 KZT | 1 027 250,00 KZT | 832 906,44 KZT |

## Bank Details
| Field | Value |
|-------|-------|
| IIK/IBAN | KZ559876543210123456 |
| BIC/SWIFT | KCJBKZKX |

## Manager
Chief Executive Officer

[round stamp]

[director signature]

Verification code: SML-74-KZ-170626-Q8X5

Manager IIN: 930208450176
`;

describe('protected-values: SML employment certificate', () => {
  it('extracts at least 9 protected values', () => {
    const { values } = extractAndProtectValues(FIXTURE_MARKDOWN);
    expect(values.length).toBeGreaterThanOrEqual(9);
  });

  it('finds 047291638 as document_number', () => {
    const { values } = extractAndProtectValues(FIXTURE_MARKDOWN);
    const pv = values.find((v) => v.original === '047291638');
    expect(pv).toBeDefined();
    expect(pv!.type).toBe('document_number');
  });

  it('finds N14720583 as passport_number with N prefix', () => {
    const { values } = extractAndProtectValues(FIXTURE_MARKDOWN);
    const pv = values.find((v) => v.original === 'N14720583');
    expect(pv).toBeDefined();
    expect(pv!.type).toBe('passport_number');
    expect(pv!.original.startsWith('N')).toBe(true);
  });

  it('finds 201240012345 as identity_number', () => {
    const { values } = extractAndProtectValues(FIXTURE_MARKDOWN);
    const pv = values.find((v) => v.original === '201240012345');
    expect(pv).toBeDefined();
    expect(pv!.type).toBe('identity_number');
  });

  it('finds 930208450176 as identity_number', () => {
    const { values } = extractAndProtectValues(FIXTURE_MARKDOWN);
    const pv = values.find((v) => v.original === '930208450176');
    expect(pv).toBeDefined();
    expect(pv!.type).toBe('identity_number');
  });

  it('finds KZ559876543210123456 as bank_account (IBAN)', () => {
    const { values } = extractAndProtectValues(FIXTURE_MARKDOWN);
    const pv = values.find((v) => v.original === 'KZ559876543210123456');
    expect(pv).toBeDefined();
    expect(pv!.type).toBe('bank_account');
  });

  it('finds KCJBKZKX as bic_swift', () => {
    const { values } = extractAndProtectValues(FIXTURE_MARKDOWN);
    const pv = values.find((v) => v.original === 'KCJBKZKX');
    expect(pv).toBeDefined();
    expect(pv!.type).toBe('bic_swift');
  });

  it('finds TD-2020/0914-38 as verification_code', () => {
    const { values } = extractAndProtectValues(FIXTURE_MARKDOWN);
    const pv = values.find((v) => v.original === 'TD-2020/0914-38');
    expect(pv).toBeDefined();
    expect(pv!.type).toBe('verification_code');
  });

  it('finds SML-74-KZ-170626-Q8X5 as verification_code', () => {
    const { values } = extractAndProtectValues(FIXTURE_MARKDOWN);
    const pv = values.find((v) => v.original === 'SML-74-KZ-170626-Q8X5');
    expect(pv).toBeDefined();
    expect(pv!.type).toBe('verification_code');
  });

  it('finds SML-2026-06-17-071 as verification_code', () => {
    const { values } = extractAndProtectValues(FIXTURE_MARKDOWN);
    const pv = values.find((v) => v.original === 'SML-2026-06-17-071');
    expect(pv).toBeDefined();
    expect(pv!.type).toBe('verification_code');
  });

  it('finds 865 000,00 KZT as money', () => {
    const { values } = extractAndProtectValues(FIXTURE_MARKDOWN);
    const pv = values.find((v) => v.original === '865 000,00 KZT');
    expect(pv).toBeDefined();
    expect(pv!.type).toBe('money');
  });

  it('protectedMarkdown does not contain any raw protected originals', () => {
    const { protectedMarkdown, values } = extractAndProtectValues(FIXTURE_MARKDOWN);
    for (const pv of values) {
      expect(protectedMarkdown).not.toContain(pv.original);
    }
  });

  it('protected values have no leading/trailing spaces in original', () => {
    const { values } = extractAndProtectValues(FIXTURE_MARKDOWN);
    for (const pv of values) {
      expect(pv.original).toBe(pv.original.trim());
    }
  });

  it('round-trip: restoreProtectedValues on protectedMarkdown equals original', () => {
    const { protectedMarkdown, values } = extractAndProtectValues(FIXTURE_MARKDOWN);
    const { restoredMarkdown } = restoreProtectedValues(protectedMarkdown, values);
    expect(restoredMarkdown).toBe(FIXTURE_MARKDOWN);
  });

  it('missingTokens is empty on perfect round-trip', () => {
    const { protectedMarkdown, values } = extractAndProtectValues(FIXTURE_MARKDOWN);
    const { missingTokens } = restoreProtectedValues(protectedMarkdown, values);
    expect(missingTokens).toHaveLength(0);
  });

  it('remainingTokens is empty on perfect round-trip', () => {
    const { protectedMarkdown, values } = extractAndProtectValues(FIXTURE_MARKDOWN);
    const { remainingTokens } = restoreProtectedValues(protectedMarkdown, values);
    expect(remainingTokens).toHaveLength(0);
  });

  it('partial restore: missing one token leaves others intact', () => {
    const { protectedMarkdown, values } = extractAndProtectValues(FIXTURE_MARKDOWN);
    // Simulate Claude dropping the first token
    const firstToken = values[0]!.token;
    const withMissingToken = protectedMarkdown.replace(firstToken, '');
    const { missingTokens, restoredMarkdown } = restoreProtectedValues(withMissingToken, values);
    expect(missingTokens).toContain(firstToken);
    // All other tokens should be restored
    for (const pv of values.slice(1)) {
      expect(restoredMarkdown).not.toContain(pv.token);
    }
  });

  it('extractMarkdownTableShapes returns 5 tables', () => {
    const shapes = extractMarkdownTableShapes(FIXTURE_MARKDOWN);
    expect(shapes).toHaveLength(5);
  });

  it('salary table (index 3) has 6 columns and 3 data rows', () => {
    const shapes = extractMarkdownTableShapes(FIXTURE_MARKDOWN);
    const salaryTable = shapes[3];
    expect(salaryTable).toBeDefined();
    expect(salaryTable!.columnCount).toBe(6);
    expect(salaryTable!.dataRowCount).toBe(3);
  });

  it('compareMarkdownTableShapes with identical shapes returns empty mismatches', () => {
    const shapes = extractMarkdownTableShapes(FIXTURE_MARKDOWN);
    const mismatches = compareMarkdownTableShapes(shapes, shapes);
    expect(mismatches).toHaveLength(0);
  });

  it('compareMarkdownTableShapes detects column count change', () => {
    const shapes = extractMarkdownTableShapes(FIXTURE_MARKDOWN);
    const modified = shapes.map((s, i) =>
      i === 3 ? { ...s, columnCount: 5 } : s,
    );
    const mismatches = compareMarkdownTableShapes(shapes, modified);
    const salaryMismatch = mismatches.find((m) => m.tableIndex === 3);
    expect(salaryMismatch).toBeDefined();
    expect(salaryMismatch!.issues.some((issue) => issue.includes('6 columns'))).toBe(true);
  });
});
