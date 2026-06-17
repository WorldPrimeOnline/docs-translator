import type { DocumentType } from '@/lib/translation-prompts/types';
import type { DocumentLanguage, ScriptName } from '@/lib/document-language';
import type { VisualElementKind } from '@/lib/translation-workflow/types';

export type { DocumentLanguage, ScriptName };

export type RenderingProfile =
  | 'identity_document'
  | 'structured_certificate'
  | 'academic_document'
  | 'legal_document'
  | 'financial_document'
  | 'medical_document'
  | 'official_certificate'
  | 'presentation'
  | 'generic_document';

// ─── Block types ──────────────────────────────────────────────────────────────

export interface HeadingBlock {
  type: 'heading';
  id: string;
  level: 1 | 2 | 3;
  text: string;
  sourcePage?: number;
}

export interface ParagraphBlock {
  type: 'paragraph';
  id: string;
  text: string;
  sourcePage?: number;
}

export interface KeyValueField {
  id: string;
  label: string;
  value: string;
  sourcePage?: number;
  /** Value must be reproduced byte-for-byte (document numbers, IDs, etc.) */
  preserveExactly?: boolean;
  /** Show source text alongside translation */
  retainOriginal?: boolean;
}

export interface KeyValueBlock {
  type: 'key_value';
  id: string;
  title?: string;
  fields: KeyValueField[];
}

export interface TableColumn {
  id: string;
  header: string;
  semanticType?: 'text' | 'date' | 'number' | 'money' | 'code' | 'percentage';
  preferredWidthWeight?: number;
  align?: 'start' | 'center' | 'end';
}

export interface TableRow {
  id: string;
  cells: Record<string, string>;
}

export interface TableBlock {
  type: 'table';
  id: string;
  title?: string;
  columns: TableColumn[];
  rows: TableRow[];
}

export interface ListItem {
  id: string;
  text: string;
  children?: ListItem[];
}

export interface ListBlock {
  type: 'list';
  id: string;
  ordered: boolean;
  items: ListItem[];
  sourcePage?: number;
}

/** Recursive legal clause (contracts, agreements). Children preserve hierarchy. */
export interface ClauseBlock {
  type: 'clause';
  id: string;
  number?: string;
  title?: string;
  paragraphs: string[];
  children?: ClauseBlock[];
}

/** One signatory = one block. Multiple signatories are separate blocks. */
export interface SignatureBlock {
  type: 'signature';
  id: string;
  role?: string;
  name?: string;
  title?: string;
  organization?: string;
  date?: string;
  /** Visual marker text in the target language, e.g. "[подпись директора]" */
  visualMarker: string;
  sourcePage?: number;
}

export interface VisualMarkerBlock {
  type: 'visual_marker';
  id: string;
  markerText: string;
  description?: string;
  sourcePage?: number;
}

export interface NoteBlock {
  type: 'note';
  id: string;
  text: string;
  noteType?: 'translator' | 'check' | 'illegible' | 'general';
}

export interface PageBreakBlock {
  type: 'page_break';
  id: string;
  afterSourcePage: number;
}

export type TranslationBlock =
  | HeadingBlock
  | ParagraphBlock
  | KeyValueBlock
  | TableBlock
  | ListBlock
  | ClauseBlock
  | SignatureBlock
  | VisualMarkerBlock
  | NoteBlock
  | PageBreakBlock;

// ─── Supplementary collections ────────────────────────────────────────────────

export interface TranslationVisualElement {
  id: string;
  kind: VisualElementKind;
  /** Marker text in target language */
  markerText: string;
  description?: string;
  sourcePage?: number;
  position?: string;
}

export interface VerificationItem {
  id: string;
  label: string;
  value: string;
  type: 'qr' | 'barcode' | 'url' | 'code' | 'mrz' | 'other';
}

export interface SourceWarning {
  blockId?: string;
  code: 'illegible' | 'truncated' | 'ambiguous' | 'missing_translation' | 'ocr_uncertain';
  message: string;
}

// ─── Render lexicon ───────────────────────────────────────────────────────────

/**
 * All UI strings emitted by the renderer, in the target language.
 * Prevents hardcoded RU/EN strings in renderer logic.
 */
export interface DocumentRenderLexicon {
  translationHeading: string;
  visualElementsHeading: string;
  originalPageLabel: string;
  elementLabel: string;
  positionLabel: string;
  representationLabel: string;

  translatorBlockHeading: string;
  translatorNameLabel: string;
  translatorQualificationLabel: string;
  translatorSignatureLabel: string;
  translationDateLabel: string;
  providerStampPlaceholder: string;

  pageLabel: string;
  pageOfLabel: string;

  visualMarkers: Partial<Record<VisualElementKind, string>>;
}

// ─── Full AST ─────────────────────────────────────────────────────────────────

export interface TranslationDocumentAst {
  schemaVersion: '1.0';

  sourceLanguage: DocumentLanguage;
  targetLanguage: DocumentLanguage;

  requestedDocumentType: DocumentType;
  detectedDocumentType: DocumentType;
  /** More specific subtype detected from content (e.g. "employment_certificate_kz") */
  detectedSubtype?: string;

  renderingProfile: RenderingProfile;

  sourcePageCount: number;

  documentTitle?: string;
  documentSubtitle?: string;

  blocks: TranslationBlock[];

  visualElements: TranslationVisualElement[];
  verificationItems: VerificationItem[];

  /** All lexicon strings in the target language — renderer reads ONLY from here */
  renderLexicon: DocumentRenderLexicon;

  sourceWarnings: SourceWarning[];
  translatorNotes: string[];
}
