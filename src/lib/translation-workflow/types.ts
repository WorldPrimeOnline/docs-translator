// OutputMode: what the pipeline stage produces
export type OutputMode =
  | 'translation_only'
  | 'translator_review_draft'
  | 'official_translation'
  | 'notarization_package';

// OutputPlan: computed from service_level, drives artifact generation
export interface OutputPlan {
  mode: OutputMode;
  requiresHumanReview: boolean;
  /** True only for notarization_through_partners — job proceeds to notary after translator review */
  requiresNotaryReview: boolean;
  generateDocx: boolean;
  generatePreviewPdf: boolean;
  generateFinalPdf: boolean;
  releaseToCustomerImmediately: boolean;
}

// VisualElement: extracted from OCR or detected in translated markdown
export type VisualElementKind =
  | 'logo'
  | 'emblem'
  | 'photo'
  | 'qr'
  | 'barcode'
  | 'stamp'
  | 'signature'
  | 'watermark'
  | 'verification_string'
  | 'mrz'
  | 'handwritten_note'
  | 'electronic_approval'
  | 'accreditation_mark'
  | 'certification_mark'
  | 'label'
  | 'unknown_image';

export type VisualPosition =
  | 'upper_left' | 'upper_center' | 'upper_right'
  | 'center_left' | 'center' | 'center_right'
  | 'lower_left' | 'lower_center' | 'lower_right'
  | 'full_page';

export interface VisualElement {
  page?: number;
  kind: VisualElementKind;
  text?: string;
  description?: string;
  position?: string;
  confidence?: number;
  source: 'mistral_ocr' | 'markdown_marker' | 'regex' | 'pdf_image_extraction' | 'manual';
}

export interface MixedScriptWarning {
  code: 'MIXED_SCRIPT_TOKEN_REQUIRES_REVIEW';
  tokenPreview: string;
  severity: 'warning';
}

// QA report produced after artifact generation
export interface TranslationQaReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  mixedScriptWarnings?: MixedScriptWarning[];
  pages?: number;
  hasTranslatorBlock: boolean;
  hasVisualElementsBlock: boolean;
  hasVerificationBlock: boolean;
  hasForbiddenTechnicalTerms: boolean;
  hasBrokenGlyphs: boolean;
  hasPotentialTableClipping: boolean;
  hasOrphanHeadings?: boolean;
  requiresHumanReview: boolean;
}
