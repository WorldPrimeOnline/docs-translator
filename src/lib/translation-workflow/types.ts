// OutputMode: what the pipeline stage produces
export type OutputMode =
  | 'translation_only'
  | 'translator_review_draft'
  | 'official_translation'
  | 'notarization_package';

// OutputPlan: computed from job flags, drives artifact generation
export interface OutputPlan {
  mode: OutputMode;
  requiresHumanReview: boolean;
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
  | 'unknown_image';

export interface VisualElement {
  page?: number;
  kind: VisualElementKind;
  text?: string;
  description?: string;
  position?: string;
  confidence?: number;
  source: 'mistral_ocr' | 'markdown_marker' | 'regex' | 'pdf_image_extraction' | 'manual';
}

// QA report produced after artifact generation
export interface TranslationQaReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
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
