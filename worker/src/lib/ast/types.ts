/**
 * Worker-local copy of translation AST types.
 * Keep in sync with src/lib/translation-ast/types.ts.
 */

import type { DocumentLanguage, ScriptName } from '../document-language';
import type { VisualElementKind } from '../visual-elements';

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

export interface HeadingBlock { type: 'heading'; id: string; level: 1 | 2 | 3; text: string; sourcePage?: number; }
export interface ParagraphBlock { type: 'paragraph'; id: string; text: string; sourcePage?: number; }
export interface KeyValueField { id: string; label: string; value: string; sourcePage?: number; preserveExactly?: boolean; retainOriginal?: boolean; }
export interface KeyValueBlock { type: 'key_value'; id: string; title?: string; fields: KeyValueField[]; }
export interface TableColumn { id: string; header: string; semanticType?: 'text' | 'date' | 'number' | 'money' | 'code' | 'percentage'; preferredWidthWeight?: number; align?: 'start' | 'center' | 'end'; }
export interface TableRow { id: string; cells: Record<string, string>; }
export interface TableBlock { type: 'table'; id: string; title?: string; columns: TableColumn[]; rows: TableRow[]; }
export interface ListItem { id: string; text: string; children?: ListItem[]; }
export interface ListBlock { type: 'list'; id: string; ordered: boolean; items: ListItem[]; sourcePage?: number; }
export interface ClauseBlock { type: 'clause'; id: string; number?: string; title?: string; paragraphs: string[]; children?: ClauseBlock[]; }
export interface SignatureBlock { type: 'signature'; id: string; role?: string; name?: string; title?: string; organization?: string; date?: string; visualMarker: string; sourcePage?: number; }
export interface VisualMarkerBlock { type: 'visual_marker'; id: string; markerText: string; description?: string; sourcePage?: number; }
export interface NoteBlock { type: 'note'; id: string; text: string; noteType?: 'translator' | 'check' | 'illegible' | 'general'; }
export interface PageBreakBlock { type: 'page_break'; id: string; afterSourcePage: number; }

export type TranslationBlock =
  | HeadingBlock | ParagraphBlock | KeyValueBlock | TableBlock | ListBlock
  | ClauseBlock | SignatureBlock | VisualMarkerBlock | NoteBlock | PageBreakBlock;

export interface TranslationVisualElement { id: string; kind: VisualElementKind; markerText: string; description?: string; sourcePage?: number; position?: string; }
export interface VerificationItem { id: string; label: string; value: string; type: 'qr' | 'barcode' | 'url' | 'code' | 'mrz' | 'other'; }
export interface SourceWarning { blockId?: string; code: 'illegible' | 'truncated' | 'ambiguous' | 'missing_translation' | 'ocr_uncertain'; message: string; }

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

export interface TranslationDocumentAst {
  schemaVersion: '1.0';
  sourceLanguage: DocumentLanguage;
  targetLanguage: DocumentLanguage;
  requestedDocumentType: string;
  detectedDocumentType: string;
  detectedSubtype?: string;
  renderingProfile: RenderingProfile;
  sourcePageCount: number;
  documentTitle?: string;
  documentSubtitle?: string;
  blocks: TranslationBlock[];
  visualElements: TranslationVisualElement[];
  verificationItems: VerificationItem[];
  renderLexicon: DocumentRenderLexicon;
  sourceWarnings: SourceWarning[];
  translatorNotes: string[];
}
