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

export type CliMode = 'single' | 'batch' | 'generate-manifest-template';

/**
 * Flat (non-discriminated) on purpose: single-file mode is the pre-existing,
 * unchanged contract — all its fields are still validated as required by
 * parseCliArgs() at runtime, same as before. Turning this into a
 * discriminated union would force every existing call site/test to narrow by
 * `.mode` before reading `.file`/`.sourceLanguage`/etc, which is exactly the
 * kind of churn "do not break the existing single-file CLI" rules out.
 */
export interface CliOptions {
  mode: CliMode;

  // ── shared ──
  envFile?: string;
  outputDir: string;
  saveToR2: boolean;
  dryRunPricingOnly: boolean;
  skipRender: boolean;
  keepIntermediate: boolean;
  debug: boolean;
  debugFullText: boolean;
  confirmProduction: boolean;

  // ── single-file mode (mode === 'single') ──
  file?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  documentTypeRaw?: string;
  serviceLevelRaw?: string;
  urgencyRaw?: string;
  fulfillmentMethodRaw?: string;
  notaryCity?: string;
  deliveryCity?: string;

  // ── batch mode (mode === 'batch') ──
  inputDir?: string;
  manifest?: string;
  continueOnError: boolean;
  stopOnError: boolean;
  limit?: number;
  only?: string;
  skipExisting: boolean;
  /** Sequential (1) by default. Hard-capped at 2 — see parseCliArgs. */
  concurrency: number;

  // ── --generate-manifest-template mode ──
  outputManifest?: string;
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

/** One entry in batch-manifest.json — see lib/manifest.ts for validation. */
export interface ManifestEntry {
  file: string;
  sourceLanguage: string;
  targetLanguage: string;
  documentType: string;
  serviceLevel: string;
  urgency?: string;
  fulfillmentMethod?: string;
  notaryCity?: string;
  deliveryCity?: string;
  notes?: string;
  expectedWarnings?: string[];
  tags?: string[];
}

/** One row of batch-summary.{json,csv,html} — see lib/batch-summary.ts. */
export interface BatchSummaryRow {
  index: number;
  file: string;
  sourceLanguage: string;
  targetLanguage: string;
  documentType: string;
  serviceLevel: string;
  status: 'completed' | 'failed' | 'skipped';
  itemFolder: string;
  finalPriceKzt: number | null;
  reconciliationStatus: string | null;
  outputDocxPath: string | null;
  outputHtmlPath: string | null;
  outputPdfDiagnosticPath: string | null;
  reportPath: string | null;
  ocrPageCount: number | null;
  extractedWordCount: number | null;
  warningsCount: number;
  warnings: string[];
  errorCode: string | null;
  errorMessage: string | null;
  durationSeconds: number;
  notes?: string;
}
