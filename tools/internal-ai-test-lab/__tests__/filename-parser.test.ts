import { parseFilename, generateManifestTemplate } from '../lib/filename-parser';

describe('parseFilename — the 28-file 2026-07-03 QA pack', () => {
  const cases: Array<[string, { sourceLanguage: string | null; targetLanguage: string | null; documentTypeGuess: string }]> = [
    ['01_ru_kk_identity_card_complex.pdf', { sourceLanguage: 'ru', targetLanguage: 'kk', documentTypeGuess: 'identity_card' }],
    ['02_en_th_passport_biodata_visa.pdf', { sourceLanguage: 'en', targetLanguage: 'th', documentTypeGuess: 'passport' }],
    ['03_kk_birth_certificate_civil.pdf', { sourceLanguage: 'kk', targetLanguage: 'ru', documentTypeGuess: 'birth_certificate' }],
    ['04_ru_marriage_certificate_old_copy.pdf', { sourceLanguage: 'ru', targetLanguage: 'en', documentTypeGuess: 'marriage_certificate' }],
    ['05_es_birth_certificate_long_form.pdf', { sourceLanguage: 'es', targetLanguage: 'ru', documentTypeGuess: 'birth_certificate' }],
    ['06_en_bank_statement_3_pages.pdf', { sourceLanguage: 'en', targetLanguage: 'ru', documentTypeGuess: 'bank_statement' }],
    ['07_zh_bank_statement_table.pdf', { sourceLanguage: 'zh', targetLanguage: 'ru', documentTypeGuess: 'bank_statement' }],
    ['08_ru_bank_reference_letter.pdf', { sourceLanguage: 'ru', targetLanguage: 'en', documentTypeGuess: 'bank_reference' }],
    ['09_de_employment_salary_letter.pdf', { sourceLanguage: 'de', targetLanguage: 'ru', documentTypeGuess: 'employment_document' }],
    ['10_tr_salary_certificate_payroll.pdf', { sourceLanguage: 'tr', targetLanguage: 'ru', documentTypeGuess: 'salary_certificate' }],
    ['11_ru_labor_contract_6_pages.pdf', { sourceLanguage: 'ru', targetLanguage: 'en', documentTypeGuess: 'contract' }],
    ['12_kk_power_of_attorney.pdf', { sourceLanguage: 'kk', targetLanguage: 'ru', documentTypeGuess: 'power_of_attorney' }],
    ['13_en_service_agreement_4_pages.pdf', { sourceLanguage: 'en', targetLanguage: 'ru', documentTypeGuess: 'contract' }],
    ['14_en_academic_transcript_4_pages.pdf', { sourceLanguage: 'en', targetLanguage: 'ru', documentTypeGuess: 'academic_transcript' }],
    ['15_de_diploma_certificate_decorative.pdf', { sourceLanguage: 'de', targetLanguage: 'ru', documentTypeGuess: 'diploma' }],
    ['16_ru_kk_diploma_supplement.pdf', { sourceLanguage: 'ru', targetLanguage: 'kk', documentTypeGuess: 'diploma_supplement' }],
    ['17_ko_medical_discharge_summary.pdf', { sourceLanguage: 'ko', targetLanguage: 'ru', documentTypeGuess: 'medical_document' }],
    ['18_th_lab_results_medical.pdf', { sourceLanguage: 'th', targetLanguage: 'ru', documentTypeGuess: 'medical_document' }],
    ['19_en_ru_vaccination_certificate.pdf', { sourceLanguage: 'en', targetLanguage: 'ru', documentTypeGuess: 'medical_document' }],
    ['20_tj_tax_certificate.pdf', { sourceLanguage: 'tj', targetLanguage: 'ru', documentTypeGuess: 'tax_certificate' }],
    ['21_mn_police_clearance.pdf', { sourceLanguage: 'mn', targetLanguage: 'ru', documentTypeGuess: 'police_clearance' }],
    ['22_ky_driver_license_card.pdf', { sourceLanguage: 'ky', targetLanguage: 'ru', documentTypeGuess: 'driver_license' }],
    ['23_th_en_visa_application_form.pdf', { sourceLanguage: 'th', targetLanguage: 'en', documentTypeGuess: 'visa_application' }],
    ['24_uz_migration_registration_notice.pdf', { sourceLanguage: 'uz', targetLanguage: 'ru', documentTypeGuess: 'migration_document' }],
    ['25_ru_notarial_consent_child_travel.pdf', { sourceLanguage: 'ru', targetLanguage: 'en', documentTypeGuess: 'notarial_consent' }],
    ['26_en_invoice_business_multitable.pdf', { sourceLanguage: 'en', targetLanguage: 'ru', documentTypeGuess: 'invoice' }],
    ['28_ru_old_archive_certificate_low_quality.pdf', { sourceLanguage: 'ru', targetLanguage: 'en', documentTypeGuess: 'archival_certificate' }],
  ];

  for (const [fileName, expected] of cases) {
    it(`parses ${fileName}`, () => {
      const guess = parseFilename(fileName);
      expect(guess.sourceLanguage).toBe(expected.sourceLanguage);
      expect(guess.targetLanguage).toBe(expected.targetLanguage);
      expect(guess.documentTypeGuess).toBe(expected.documentTypeGuess);
    });
  }

  it('27_presentation_pitch_deck_6_slides.pdf — no language token present, guesses doc type but flags language for review', () => {
    const guess = parseFilename('27_presentation_pitch_deck_6_slides.pdf');
    expect(guess.index).toBe(27);
    expect(guess.sourceLanguage).toBeNull();
    expect(guess.targetLanguage).toBeNull();
    expect(guess.documentTypeGuess).toBe('presentation');
    expect(guess.documentTypeConfident).toBe(true);
    expect(guess.notes).toMatch(/No recognized language code/);
  });

  it('extracts the leading numeric index', () => {
    expect(parseFilename('01_ru_kk_identity_card_complex.pdf').index).toBe(1);
    expect(parseFilename('28_ru_old_archive_certificate_low_quality.pdf').index).toBe(28);
  });

  it('returns null index when filename has no leading number', () => {
    expect(parseFilename('random_file_name.pdf').index).toBeNull();
  });

  it('conservative fallback: unrecognized document type slug maps to "other" with a review note', () => {
    const guess = parseFilename('99_ru_en_some_totally_unknown_thing.pdf');
    expect(guess.documentTypeGuess).toBe('other');
    expect(guess.documentTypeConfident).toBe(false);
    expect(guess.notes).toMatch(/Please review/);
  });

  it('flags a single-language-token filename\'s guessed target for review', () => {
    const guess = parseFilename('06_en_bank_statement_3_pages.pdf');
    expect(guess.targetLanguageGuessed).toBe(true);
    expect(guess.notes).toMatch(/guessed as "ru"/);
  });

  it('does not flag a two-language-token filename\'s target for review', () => {
    const guess = parseFilename('01_ru_kk_identity_card_complex.pdf');
    expect(guess.targetLanguageGuessed).toBe(false);
  });
});

describe('generateManifestTemplate', () => {
  it('produces one manifest entry per input file name', () => {
    const files = ['01_ru_kk_identity_card_complex.pdf', '02_en_th_passport_biodata_visa.pdf'];
    const entries = generateManifestTemplate(files);
    expect(entries).toHaveLength(2);
  });

  it('every generated entry has all 5 required manifest fields present (even if some are empty placeholders)', () => {
    const entries = generateManifestTemplate(['01_ru_kk_identity_card_complex.pdf']);
    const entry = entries[0]!;
    expect(entry.file).toBe('01_ru_kk_identity_card_complex.pdf');
    expect(entry.sourceLanguage).toBe('ru');
    expect(entry.targetLanguage).toBe('kk');
    expect(entry.documentType).toBe('identity_card');
    expect(entry.serviceLevel).toBe('electronic_translation');
  });

  it('every generated entry is marked as a TEMPLATE requiring review', () => {
    const entries = generateManifestTemplate(['01_ru_kk_identity_card_complex.pdf']);
    expect(entries[0]!.notes).toMatch(/TEMPLATE — please review/);
  });

  it('does not rely on filename guessing for anything but the draft — output is valid JSON-serializable ManifestEntry objects', () => {
    const entries = generateManifestTemplate(['27_presentation_pitch_deck_6_slides.pdf']);
    expect(() => JSON.stringify(entries)).not.toThrow();
    expect(entries[0]!.documentType).toBe('presentation');
    expect(entries[0]!.sourceLanguage).toBe('');
    expect(entries[0]!.notes).toMatch(/No recognized language code/);
  });

  it('sorts entries alphabetically by file name (stable, predictable output)', () => {
    const entries = generateManifestTemplate(['b.pdf', 'a.pdf']);
    expect(entries.map((e) => e.file)).toEqual(['a.pdf', 'b.pdf']);
  });
});
