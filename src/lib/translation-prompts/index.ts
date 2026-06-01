import { buildBasePrompt } from './base';
import { DOCUMENT_TYPE_PROMPTS } from './document-prompts';
import { DOCUMENT_TYPE } from './types';
import type { DocumentType, TranslationPromptParams, TranslationPromptResult } from './types';

export type { DocumentType, OutputMode, ServiceLevel, TranslationPromptParams, TranslationPromptResult } from './types';
export { DOCUMENT_TYPE } from './types';

const LEGACY_KEY_MAP: Record<string, DocumentType> = {
  passport: DOCUMENT_TYPE.passport_id,
  diploma: DOCUMENT_TYPE.diploma_transcript,
  medical: DOCUMENT_TYPE.medical_document,
  employment: DOCUMENT_TYPE.employment_document,
};

export function normalizeDocumentType(raw: string): DocumentType {
  const legacy = LEGACY_KEY_MAP[raw];
  if (legacy) return legacy;
  if (raw in DOCUMENT_TYPE) return raw as DocumentType;
  return DOCUMENT_TYPE.other;
}

export function buildTranslationPrompt(params: TranslationPromptParams): TranslationPromptResult {
  const {
    sourceLanguage,
    targetLanguage,
    documentType,
    outputMode = documentType === DOCUMENT_TYPE.presentation
      ? 'presentation_translation'
      : 'clean_official_translation',
  } = params;

  const basePrompt = buildBasePrompt(sourceLanguage, targetLanguage);
  const docExtension = DOCUMENT_TYPE_PROMPTS[documentType];
  const systemPrompt = `${basePrompt}\n\n---\n\n${docExtension}`;

  const sourceDisplay = sourceLanguage === 'auto' || sourceLanguage === 'auto-detect'
    ? 'its source language'
    : sourceLanguage;

  const userPrompt =
    outputMode === 'presentation_translation'
      ? `Translate the following presentation from ${sourceDisplay} to ${targetLanguage}. Return output in slide-by-slide Markdown format (# Slide N / ## Title / ## Body / ## Notes):`
      : `Translate the following document from ${sourceDisplay} to ${targetLanguage}:`;

  const expectedOutputFormat =
    outputMode === 'presentation_translation'
      ? 'Slide-by-slide Markdown: # Slide N / ## Title / ## Body / ## Notes'
      : 'Clean structured Markdown with headings, tables, and neutral element markers';

  return { systemPrompt, userPrompt, expectedOutputFormat };
}
