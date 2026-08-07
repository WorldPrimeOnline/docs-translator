import { normalizeDocumentType, DOCUMENT_TYPE } from '../index';
import { DOCUMENT_TYPE_PROMPTS } from '../document-prompts';

describe('normalizeDocumentType', () => {
  it('normalizes power_of_attorney to itself', () => {
    expect(normalizeDocumentType('power_of_attorney')).toBe('power_of_attorney');
  });

  it('falls back unknown/unmapped values to "other" (never throws)', () => {
    expect(normalizeDocumentType('nonexistent')).toBe(DOCUMENT_TYPE.other);
    expect(normalizeDocumentType('')).toBe(DOCUMENT_TYPE.other);
  });

  it('still maps pre-existing legacy aliases correctly (unaffected by the new type)', () => {
    expect(normalizeDocumentType('passport')).toBe('passport_id');
    expect(normalizeDocumentType('diploma')).toBe('diploma_transcript');
    expect(normalizeDocumentType('medical')).toBe('medical_document');
    expect(normalizeDocumentType('employment')).toBe('employment_document');
  });
});

describe('DOCUMENT_TYPE_PROMPTS', () => {
  it('has a non-empty entry for every DOCUMENT_TYPE key, including power_of_attorney', () => {
    for (const key of Object.values(DOCUMENT_TYPE)) {
      expect(typeof DOCUMENT_TYPE_PROMPTS[key]).toBe('string');
      expect(DOCUMENT_TYPE_PROMPTS[key].length).toBeGreaterThan(0);
    }
  });

  it('power_of_attorney prompt never claims guaranteed acceptance/validity', () => {
    const prompt = DOCUMENT_TYPE_PROMPTS.power_of_attorney;
    expect(prompt).not.toMatch(/guaranteed (to be )?accepted|guaranteed valid/i);
  });
});
