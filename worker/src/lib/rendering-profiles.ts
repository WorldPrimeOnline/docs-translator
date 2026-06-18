/**
 * Lightweight rendering profile registry.
 * Maps document type → LegacyRenderingProfile.
 * No AST involvement — used by docx-renderer for layout hints only.
 */

export type LegacyRenderingProfile =
  | 'identity_document'       // passport, driver's license
  | 'structured_certificate'  // employment cert, HR certificate
  | 'academic_document'       // diploma, transcript, grades
  | 'legal_document'          // contract, agreement
  | 'financial_document'      // bank statement, financial report
  | 'medical_document'        // lab report, medical certificate
  | 'official_certificate'    // police clearance, government cert
  | 'generic_document'        // other / unknown
  | 'presentation';           // slide deck — separate pipeline

const DOC_TYPE_TO_PROFILE: Record<string, LegacyRenderingProfile> = {
  passport_id:         'identity_document',
  driver_license:      'identity_document',
  employment_document: 'structured_certificate',
  diploma_transcript:  'academic_document',
  contract:            'legal_document',
  bank_statement:      'financial_document',
  medical_document:    'medical_document',
  police_clearance:    'official_certificate',
  visa_documents:      'official_certificate',
  presentation:        'presentation',
  other:               'generic_document',
};

export function getProfile(documentType: string): LegacyRenderingProfile {
  return DOC_TYPE_TO_PROFILE[documentType] ?? 'generic_document';
}

/** Returns true when the profile should include a translator-certification block. */
export function needsTranslatorBlock(profile: LegacyRenderingProfile): boolean {
  return profile !== 'presentation';
}

/** Returns true when the profile typically has a large data table (salary, transactions). */
export function hasLargeDataTable(profile: LegacyRenderingProfile): boolean {
  return profile === 'financial_document' || profile === 'structured_certificate';
}
