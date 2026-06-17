import { getRenderingProfile, getProfilePromptGuidance } from '@/lib/translation-ast/rendering-profiles';

describe('getRenderingProfile', () => {
  describe('all 9 document profiles mapped', () => {
    it('passport_id → identity_document', () => expect(getRenderingProfile('passport_id')).toBe('identity_document'));
    it('driver_license → identity_document', () => expect(getRenderingProfile('driver_license')).toBe('identity_document'));
    it('visa_documents → identity_document', () => expect(getRenderingProfile('visa_documents')).toBe('identity_document'));
    it('diploma_transcript → academic_document', () => expect(getRenderingProfile('diploma_transcript')).toBe('academic_document'));
    it('contract → legal_document', () => expect(getRenderingProfile('contract')).toBe('legal_document'));
    it('bank_statement → financial_document', () => expect(getRenderingProfile('bank_statement')).toBe('financial_document'));
    it('medical_document → medical_document', () => expect(getRenderingProfile('medical_document')).toBe('medical_document'));
    it('employment_document → structured_certificate', () => expect(getRenderingProfile('employment_document')).toBe('structured_certificate'));
    it('police_clearance → official_certificate', () => expect(getRenderingProfile('police_clearance')).toBe('official_certificate'));
    it('presentation → presentation', () => expect(getRenderingProfile('presentation')).toBe('presentation'));
    it('other → generic_document', () => expect(getRenderingProfile('other')).toBe('generic_document'));
  });

  it('unknown type falls back to generic_document', () => {
    expect(getRenderingProfile('unknown_type_xyz')).toBe('generic_document');
  });
});

describe('getProfilePromptGuidance', () => {
  it('returns non-empty string for all 9 profiles', () => {
    const profiles = [
      'identity_document', 'structured_certificate', 'academic_document', 'legal_document',
      'financial_document', 'medical_document', 'official_certificate', 'presentation', 'generic_document',
    ] as const;
    for (const profile of profiles) {
      const guidance = getProfilePromptGuidance(profile);
      expect(typeof guidance).toBe('string');
      expect(guidance.length).toBeGreaterThan(10);
    }
  });

  it('does not hardcode any specific language pair in guidance', () => {
    const profiles = [
      'identity_document', 'structured_certificate', 'academic_document', 'legal_document',
      'financial_document', 'medical_document', 'official_certificate', 'presentation', 'generic_document',
    ] as const;
    const forbiddenLangs = [' ru ', ' en ', ' it ', ' de ', ' fr ', ' es ', 'Russian', 'English', 'Italian', 'German', 'French'];
    for (const profile of profiles) {
      const guidance = getProfilePromptGuidance(profile);
      for (const lang of forbiddenLangs) {
        expect(guidance).not.toContain(lang);
      }
    }
  });
});
