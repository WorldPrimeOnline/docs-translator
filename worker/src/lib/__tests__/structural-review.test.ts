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
