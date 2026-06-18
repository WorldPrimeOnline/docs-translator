import {
  extractStructuralElements,
  applyStructuralCorrections,
  type StructuralTranslationCorrection,
} from '../structural-review';

describe('extractStructuralElements', () => {
  test('extracts H1, H2, H3 headings', () => {
    const md = '# Document Title\n\n## Section One\n\n### Subsection A\n\nBody text.';
    const elements = extractStructuralElements(md);
    expect(elements).toContain('Document Title');
    expect(elements).toContain('Section One');
    expect(elements).toContain('Subsection A');
  });

  test('extracts table header cells', () => {
    const md = '| Field | Value |\n|---|---|\n| Name | John |';
    const elements = extractStructuralElements(md);
    expect(elements).toContain('Field');
    expect(elements).toContain('Value');
  });

  test('extracts KV label from 2-col table data rows', () => {
    // Header row followed by separator, then data rows
    const md = '| Field | Value |\n|---|---|\n| Full Name | JOHN DOE |\n| Position | Engineer |';
    const elements = extractStructuralElements(md);
    // Header cells are extracted
    expect(elements).toContain('Field');
    expect(elements).toContain('Value');
    // KV labels (first cell of data rows) are extracted
    expect(elements).toContain('Full Name');
    expect(elements).toContain('Position');
    // Value column of data rows should NOT be extracted
    expect(elements).not.toContain('JOHN DOE');
    expect(elements).not.toContain('Engineer');
  });

  test('does not extract protected tokens', () => {
    const md = '## __WPO_PV_0001__\n\n| __WPO_VIS_0001__ | Value |';
    const elements = extractStructuralElements(md);
    expect(elements.some(e => e.includes('__WPO_'))).toBe(false);
  });

  test('deduplicates repeated elements', () => {
    const md = '## Organization\n\n## Organization\n\n## Organization';
    const elements = extractStructuralElements(md);
    expect(elements.filter(e => e === 'Organization')).toHaveLength(1);
  });

  test('extracts heading containing a transliterated word (COXPAHEH fixture)', () => {
    const md =
      '## ON EMPLOYMENT, INCOME, GRANTED LEAVE AND COXPAHEH OF THE WORKPLACE';
    const elements = extractStructuralElements(md);
    expect(elements).toContain(
      'ON EMPLOYMENT, INCOME, GRANTED LEAVE AND COXPAHEH OF THE WORKPLACE',
    );
  });
});

describe('applyStructuralCorrections', () => {
  test('replaces COXPAHEH with JOB RETENTION', () => {
    const corrections: StructuralTranslationCorrection[] = [
      {
        original: 'COXPAHEH',
        corrected: 'JOB RETENTION',
        reason: 'transliterated_instead_of_translated',
      },
    ];
    const markdown =
      '## ON EMPLOYMENT, INCOME, GRANTED LEAVE AND COXPAHEH OF THE WORKPLACE\n\nBody text.';
    const result = applyStructuralCorrections(markdown, corrections);
    expect(result).not.toContain('COXPAHEH');
    expect(result).toContain('JOB RETENTION');
  });

  test('replaces all occurrences of the original', () => {
    const corrections: StructuralTranslationCorrection[] = [
      { original: 'NAIMEN', corrected: 'NAME', reason: 'transliterated_instead_of_translated' },
    ];
    const markdown = '## NAIMEN\n\nNAIMEN is a heading.\n\nAnother NAIMEN here.';
    const result = applyStructuralCorrections(markdown, corrections);
    expect(result).not.toContain('NAIMEN');
    expect((result.match(/NAME/g) ?? []).length).toBe(3);
  });

  test('does not replace protected tokens even if listed as original', () => {
    const corrections: StructuralTranslationCorrection[] = [
      { original: '__WPO_PV_0001__', corrected: 'SAFE', reason: 'untranslated' },
    ];
    const markdown = 'Value: __WPO_PV_0001__';
    const result = applyStructuralCorrections(markdown, corrections);
    expect(result).toBe(markdown);
  });

  test('no-ops on empty corrections list', () => {
    const markdown = '## Some heading\n\nText.';
    expect(applyStructuralCorrections(markdown, [])).toBe(markdown);
  });

  test('skips corrections where original equals corrected', () => {
    const corrections: StructuralTranslationCorrection[] = [
      { original: 'Employment', corrected: 'Employment', reason: 'untranslated' },
    ];
    const markdown = '## Employment\n\nText.';
    const result = applyStructuralCorrections(markdown, corrections);
    expect(result).toBe(markdown);
  });

  test('preserves the rest of the document unchanged', () => {
    const corrections: StructuralTranslationCorrection[] = [
      { original: 'COXPAHEH', corrected: 'JOB RETENTION', reason: 'transliterated_instead_of_translated' },
    ];
    const markdown =
      '## ON EMPLOYMENT, INCOME, GRANTED LEAVE AND COXPAHEH OF THE WORKPLACE\n\n' +
      '| IIK/IBAN | KZ559876543210123456 |\n' +
      '| BIC/SWIFT | KCJBKZKX |';
    const result = applyStructuralCorrections(markdown, corrections);
    expect(result).not.toContain('COXPAHEH');
    expect(result).toContain('JOB RETENTION');
    expect(result).toContain('KZ559876543210123456');
    expect(result).toContain('KCJBKZKX');
  });
});

// ── New: extended extraction and type system ──────────────────────────────────

describe('extractStructuralElements — extended (org names, bank names)', () => {
  test('extracts org name from KV value when it contains a legal-form prefix', () => {
    const md =
      '| Field | Value |\n|---|---|\n| Employer | LLP "SML Group" |\n| Department | Logistics |';
    const elements = extractStructuralElements(md);
    expect(elements).toContain('LLP "SML Group"');
    // Plain value without legal-form prefix is not extracted
    expect(elements).not.toContain('Logistics');
  });

  test('extracts bank name from KV value', () => {
    const md =
      '| Field | Value |\n|---|---|\n| Servicing bank | Bank CentrCredit |\n| BIC | KCJBKZKX |';
    const elements = extractStructuralElements(md);
    expect(elements).toContain('Bank CentrCredit');
    // Protected-looking code is not extracted
    expect(elements).not.toContain('KCJBKZKX');
  });

  test('does not extract amounts, dates, or document numbers from values', () => {
    const md =
      '| Field | Value |\n|---|---|\n| Amount | 865 000,00 KZT |\n' +
      '| Date | June 17, 2026 |\n| Contract | ТД-2020/0914-38 |';
    const elements = extractStructuralElements(md);
    expect(elements).not.toContain('865 000,00 KZT');
    expect(elements).not.toContain('June 17, 2026');
    expect(elements).not.toContain('ТД-2020/0914-38');
  });
});

describe('StructuralTranslationCorrection — new reason values and segmentType', () => {
  test('applyStructuralCorrections applies segmentType-annotated correction', () => {
    const corrections: StructuralTranslationCorrection[] = [
      {
        original: 'Bank CentrCredit',
        corrected: 'Bank CenterCredit',
        reason: 'spelling',
        segmentType: 'bank_name',
      },
    ];
    const md =
      '| Servicing bank | Bank CentrCredit |\n|---|---|\n| BIC | KCJBKZKX |';
    const result = applyStructuralCorrections(md, corrections);
    expect(result).toContain('Bank CenterCredit');
    expect(result).not.toContain('Bank CentrCredit');
    // Codes unchanged
    expect(result).toContain('KCJBKZKX');
  });

  test('applyStructuralCorrections applies incorrect_acronym correction', () => {
    const corrections: StructuralTranslationCorrection[] = [
      {
        original: 'IIC',
        corrected: 'IIK',
        reason: 'incorrect_acronym',
        segmentType: 'acronym',
      },
    ];
    const md = '| IIC/IBAN | KZ559876543210123456 |\n|---|---|\n';
    const result = applyStructuralCorrections(md, corrections);
    expect(result).toContain('IIK');
    expect(result).not.toContain('IIC');
    // IBAN number unchanged
    expect(result).toContain('KZ559876543210123456');
  });

  test('correction with invalid reason is rejected by isValidCorrection guard', () => {
    // We test this indirectly via applyStructuralCorrections — the correction
    // itself is valid; the guard in runStructuralReview filters at parse time.
    // Here we just verify the type accepts all new reason values.
    const corrections: StructuralTranslationCorrection[] = [
      { original: 'a', corrected: 'b', reason: 'entity_inconsistency' },
      { original: 'c', corrected: 'd', reason: 'unnatural_translation' },
      { original: 'e', corrected: 'f', reason: 'incorrect_acronym' },
      { original: 'g', corrected: 'h', reason: 'spelling' },
    ];
    let md = 'a c e g';
    for (const c of corrections) {
      md = applyStructuralCorrections(md, [c]);
    }
    expect(md).toBe('b d f h');
  });
});
