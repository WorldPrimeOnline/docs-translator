/**
 * Shared types for the Internal AI Translation Test Lab.
 * This tool is for internal algorithm/pricing testing only — see README.md.
 */

export type Environment = 'local' | 'staging' | 'production';

/** Canonical ServiceLevel — must match src/lib/pricing/types.ts / worker output-plan.ts exactly. */
export type CanonicalServiceLevel =
  | 'electronic'
  | 'official_with_translator_signature_and_provider_stamp'
  | 'notarization_through_partners';

/** Canonical DocumentType — must match worker/src/lib/translation-prompts/types.ts DOCUMENT_TYPE. */
export type CanonicalDocumentType =
  | 'passport_id'
  | 'diploma_transcript'
  | 'contract'
  | 'bank_statement'
  | 'medical_document'
  | 'employment_document'
  | 'police_clearance'
  | 'visa_documents'
  | 'driver_license'
  | 'presentation'
  | 'other';

export type CanonicalUrgencyLevel =
  | 'standard'
  | 'within_24h'
  | 'six_to_twelve_hours'
  | 'two_to_four_hours'
  | 'night_or_weekend';

export type CanonicalFulfillmentMethod = 'pickup' | 'delivery';

export interface CliOptions {
  envFile: string;
  file: string;
  sourceLanguage: string;
  targetLanguage: string;
  documentTypeRaw: string;
  serviceLevelRaw: string;
  urgencyRaw?: string;
  fulfillmentMethodRaw?: string;
  notaryCity?: string;
  deliveryCity?: string;
  outputDir: string;
  saveToR2: boolean;
  dryRunPricingOnly: boolean;
  skipRender: boolean;
  keepIntermediate: boolean;
  debug: boolean;
  debugFullText: boolean;
  confirmProduction: boolean;
}

export interface AiTranslationTestContext {
  runId: string;
  isInternalTest: true;
  environment: Environment;
  createPayment: false;
  createJira: false;
  createFiscalReceipt: false;
  sendEmail: false;
  saveToR2: boolean;
  outputDir: string;
  operatorEmail?: string;
}

export interface RunPaths {
  runId: string;
  runDir: string;
  sourceDir: string;
  ocrDir: string;
  translationDir: string;
  renderedDir: string;
  pricingDir: string;
  reportDir: string;
  logFile: string;
}
