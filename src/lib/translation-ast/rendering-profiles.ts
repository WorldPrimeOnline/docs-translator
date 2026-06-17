import { DOCUMENT_TYPE } from '@/lib/translation-prompts/types';
import type { DocumentType } from '@/lib/translation-prompts/types';
import type { RenderingProfile } from './types';

const PROFILE_REGISTRY: Record<DocumentType, RenderingProfile> = {
  [DOCUMENT_TYPE.passport_id]:         'identity_document',
  [DOCUMENT_TYPE.driver_license]:      'identity_document',
  [DOCUMENT_TYPE.visa_documents]:      'identity_document',
  [DOCUMENT_TYPE.diploma_transcript]:  'academic_document',
  [DOCUMENT_TYPE.contract]:            'legal_document',
  [DOCUMENT_TYPE.bank_statement]:      'financial_document',
  [DOCUMENT_TYPE.medical_document]:    'medical_document',
  [DOCUMENT_TYPE.employment_document]: 'structured_certificate',
  [DOCUMENT_TYPE.police_clearance]:    'official_certificate',
  [DOCUMENT_TYPE.presentation]:        'presentation',
  [DOCUMENT_TYPE.other]:               'generic_document',
};

export function getRenderingProfile(documentType: DocumentType | string): RenderingProfile {
  return (PROFILE_REGISTRY as Record<string, RenderingProfile>)[documentType] ?? 'generic_document';
}

export function getProfilePromptGuidance(profile: RenderingProfile): string {
  switch (profile) {
    case 'identity_document':
      return 'Identity document (passport, ID card, driver license, visa). Use key_value blocks for all personal data fields. Preserve MRZ lines as visual_marker blocks with type "mrz". Names must follow ICAO 9303 transliteration conventions. All document numbers, codes, and dates are protected values — preserve exactly.';

    case 'structured_certificate':
      return 'Official certificate or employment document. Use key_value blocks for labeled fields, paragraph blocks for body text, and one signature block per signatory. Preserve organization names, position titles, and dates exactly as issued.';

    case 'academic_document':
      return 'Academic document (diploma, transcript, academic record). Use table blocks for grade tables — preserve every row, every grade value, every credit count. Use key_value blocks for student and program data. Do not convert grades between systems or interpret academic standing.';

    case 'legal_document':
      return 'Legal document (contract, agreement, deed). Use clause blocks for numbered clauses, preserving hierarchy. Each clause number, title, and sub-clause must be its own block or child. Do not simplify, summarize, or rephrase legal language. Preserve all obligation, liability, and penalty terms.';

    case 'financial_document':
      return 'Financial document (bank statement, financial report). Use table blocks for transaction tables — preserve every row in source order. Use key_value blocks for account metadata. All amounts, currencies, IBAN, SWIFT/BIC, and reference numbers are protected values — never alter or compute them.';

    case 'medical_document':
      return 'Medical document (medical certificate, lab results, discharge summary). Use key_value blocks for patient data and test parameters. Preserve all measurements, units, reference ranges, diagnostic codes (ICD, etc.) and drug names exactly. Do not interpret clinical data.';

    case 'official_certificate':
      return 'Official government certificate (police clearance, certificate of no criminal record, notarial act). Use key_value blocks for subject data. Preserve official authority names, issuing body, document series/number, and all legal references exactly.';

    case 'presentation':
      return 'Presentation document (slides). Preserve slide order strictly. Each slide title is a heading block (level 2). Slide body content uses paragraph and list blocks. Do not add official document structure, certification blocks, or visual element sections to the overall document — only apply official element markers to embedded scanned official documents within individual slides.';

    case 'generic_document':
      return 'Unknown or unclassified document. Auto-detect the structure and use the most appropriate block types: headings for sections, key_value for labeled field pairs, table for tabular data, paragraph for prose, clause for numbered legal-style items. Set detectedDocumentType to the best match from the available document types.';
  }
}
