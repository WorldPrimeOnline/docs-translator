export const DOCUMENT_TYPE = {
  passport_id: 'passport_id',
  diploma_transcript: 'diploma_transcript',
  contract: 'contract',
  bank_statement: 'bank_statement',
  medical_document: 'medical_document',
  employment_document: 'employment_document',
  police_clearance: 'police_clearance',
  driver_license: 'driver_license',
  presentation: 'presentation',
  other: 'other',
} as const;

export type DocumentType = (typeof DOCUMENT_TYPE)[keyof typeof DOCUMENT_TYPE];

export type OutputMode =
  | 'clean_official_translation'
  | 'mirror_layout_translation'
  | 'presentation_translation';

export type ServiceLevel =
  | 'electronic'
  | 'official_with_translator_signature_and_provider_stamp'
  | 'notarization_through_partners';

export interface TranslationPromptParams {
  sourceLanguage: string;
  targetLanguage: string;
  documentType: DocumentType;
  outputMode?: OutputMode;
  serviceLevel?: ServiceLevel;
  locale?: string;
}

export interface TranslationPromptResult {
  systemPrompt: string;
  userPrompt: string;
  expectedOutputFormat: string;
}
