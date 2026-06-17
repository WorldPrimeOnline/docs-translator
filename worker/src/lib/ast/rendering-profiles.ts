/**
 * Worker-local copy of rendering profile registry.
 * Keep in sync with src/lib/translation-ast/rendering-profiles.ts.
 */
import type { RenderingProfile } from './types';

const PROFILE_REGISTRY: Record<string, RenderingProfile> = {
  passport_id:         'identity_document',
  driver_license:      'identity_document',
  visa_documents:      'identity_document',
  diploma_transcript:  'academic_document',
  contract:            'legal_document',
  bank_statement:      'financial_document',
  medical_document:    'medical_document',
  employment_document: 'structured_certificate',
  police_clearance:    'official_certificate',
  presentation:        'presentation',
  other:               'generic_document',
};

export function getRenderingProfile(documentType: string): RenderingProfile {
  return PROFILE_REGISTRY[documentType] ?? 'generic_document';
}

export function getProfilePromptGuidance(profile: RenderingProfile): string {
  switch (profile) {
    case 'identity_document':
      return 'Identity document. Use key_value blocks for personal data. MRZ lines as visual_marker. Preserve all document numbers and codes exactly.';
    case 'structured_certificate':
      return 'Certificate/employment document. Use key_value for fields, paragraph for body, one signature block per signatory.';
    case 'academic_document':
      return 'Academic document. Use table blocks for grades — preserve every row. Use key_value for student/program data.';
    case 'legal_document':
      return 'Legal contract. Use clause blocks for numbered clauses. Preserve hierarchy. Do not simplify legal language.';
    case 'financial_document':
      return 'Financial document. Use table blocks for transactions — preserve every row in order. Preserve all amounts, IBAN, SWIFT/BIC exactly.';
    case 'medical_document':
      return 'Medical document. Use key_value for patient data and test parameters. Preserve all units, codes, and reference ranges.';
    case 'official_certificate':
      return 'Government certificate. Use key_value for subject data. Preserve all authority names and document identifiers.';
    case 'presentation':
      return 'Presentation slides. Preserve slide order. Each slide title is heading (level 2). Do not add official document structure.';
    case 'generic_document':
      return 'Auto-detected document. Use the most appropriate block types. Set detectedDocumentType to the best match.';
  }
}
