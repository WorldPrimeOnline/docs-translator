/**
 * Worker AST translator — uses Anthropic tool use to produce structured TranslationDocumentAst.
 * Keep in sync with src/lib/translation-ast/translator.ts.
 */
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../env';
import { resolveDocumentLanguage } from '../document-language';
import { getRenderingProfile, getProfilePromptGuidance } from './rendering-profiles';
import { getStaticLexicon, validateLexicon, mergeLexiconWithFallback, ENGLISH_FALLBACK_LEXICON } from './lexicon';
import { TRANSLATION_AST_TOOL, TranslationDocumentAstSchema } from './tool-schema';
import type { TranslationDocumentAst, DocumentRenderLexicon } from './types';

const MODEL = 'claude-sonnet-4-5-20250929';
const MAX_RETRIES = 3;
const MAX_TOKENS = 16000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface TranslateToAstParams {
  ocrMarkdown: string;
  sourceLanguage: string;
  targetLanguage: string;
  documentType: string;
  pageCount: number;
}

export interface TranslateToAstResult {
  ast: TranslationDocumentAst;
  usedFallback: boolean;
  lexiconWarning?: string;
}

function normalizeDocumentType(raw: string): string {
  const legacyMap: Record<string, string> = {
    passport: 'passport_id', diploma: 'diploma_transcript',
    medical: 'medical_document', employment: 'employment_document',
  };
  return legacyMap[raw] ?? raw;
}

function buildSystemPrompt(
  sourceLanguage: string,
  targetLanguage: string,
  docType: string,
  profileGuidance: string,
  hasStaticLexicon: boolean,
): string {
  const sourcePart =
    !sourceLanguage || sourceLanguage === 'auto' || sourceLanguage === 'auto-detect'
      ? 'the source language detected from the document content'
      : sourceLanguage;

  const lexiconInstruction = hasStaticLexicon
    ? `The renderLexicon for "${targetLanguage}" is pre-verified — use the exact values provided.`
    : `Produce a complete renderLexicon entirely in the TARGET language "${targetLanguage}". Every string must be in ${targetLanguage}. Not in English. Not in the source language.`;

  return `You are a professional document translation assistant. Use the produce_translation_ast tool to return a fully structured translation.

TASK: Translate the OCR-extracted document from ${sourcePart} into ${targetLanguage}.
DOCUMENT TYPE: ${docType}
PROFILE GUIDANCE: ${profileGuidance}

CORE RULES:
1. Translate only what is present — never invent, summarize, or omit.
2. All translated text must be in ${targetLanguage}. Do not mix languages.
3. Protected values (document numbers, IDs, IBAN, SWIFT/BIC, amounts, dates, MRZ, verification codes, leading zeros) must be preserved exactly.
4. All blocks must appear in the same order as in the source.
5. Each source page boundary produces a page_break block.
6. Each signatory is a separate signature block. Never merge.
7. Tables: preserve ALL rows in source order.
8. Clauses: preserve hierarchy — numbered children become ClauseBlock.children.
9. Names: transliterate if target script differs; preserve passport Latin spelling.
10. No Markdown, HTML, or layout in text fields.
11. Do not claim certification, notarization, or official acceptance.

BLOCK SELECTION: headings→heading, field pairs→key_value, prose→paragraph, tables→table, lists→list, legal clauses→clause, signatures/stamps→signature+visual_marker, QR/barcode/emblem/photo→visual_marker, MRZ/codes→verificationItems, translator uncertainty→note(translator).

VISUAL MARKERS: All marker text in ${targetLanguage}. Use lexicon visualMarkers strings.
${lexiconInstruction}

FORBIDDEN: AI, Claude, Mistral, OCR, JSON, Markdown, renderer, parser, serviceLevel, document_type, fallback, debug.

Return ONLY the tool call. No text outside the tool call.`;
}

export async function translateToAst(
  params: TranslateToAstParams,
  anthropicClient?: Anthropic,
): Promise<TranslateToAstResult> {
  const client = anthropicClient ?? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const docType = normalizeDocumentType(params.documentType);
  const renderingProfile = getRenderingProfile(docType);
  const profileGuidance = getProfilePromptGuidance(renderingProfile);
  const sourceLang = resolveDocumentLanguage(params.sourceLanguage);
  const targetLang = resolveDocumentLanguage(params.targetLanguage);
  const staticLexicon = getStaticLexicon(params.targetLanguage);

  const systemPrompt = buildSystemPrompt(
    params.sourceLanguage, params.targetLanguage, docType, profileGuidance, !!staticLexicon,
  );

  const lexiconContext = staticLexicon
    ? `\n\nPRE-VERIFIED LEXICON FOR ${targetLang.displayName.toUpperCase()} — use these exact values in renderLexicon:\n${JSON.stringify(staticLexicon, null, 2)}`
    : '';

  const userContent = `Document: ${docType} | Pages: ${params.pageCount} | Source: ${params.sourceLanguage} | Target: ${params.targetLanguage}${lexiconContext}\n\n---\n\n${params.ocrMarkdown}`;

  let lastError: Error = new Error('Translation failed after all retries');

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** attempt);
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        tools: [TRANSLATION_AST_TOOL],
        tool_choice: { type: 'tool', name: 'produce_translation_ast' },
        messages: [{ role: 'user', content: userContent }],
      });

      const toolUse = response.content.find((b) => b.type === 'tool_use');
      if (!toolUse || toolUse.type !== 'tool_use') throw new Error('Model did not return a tool_use block');

      const rawInput = toolUse.input as Record<string, unknown>;
      let lexiconWarning: string | undefined;
      const providedLexicon = rawInput['renderLexicon'];

      if (staticLexicon) {
        if (!validateLexicon(providedLexicon)) {
          rawInput['renderLexicon'] = staticLexicon;
          lexiconWarning = 'Lexicon replaced with static verified pack';
        }
      } else if (!validateLexicon(providedLexicon)) {
        rawInput['renderLexicon'] = mergeLexiconWithFallback(
          (providedLexicon ?? {}) as Partial<DocumentRenderLexicon>,
          ENGLISH_FALLBACK_LEXICON,
        );
        lexiconWarning = 'Lexicon incomplete — merged with English fallback';
      }

      const parsed = TranslationDocumentAstSchema.parse(rawInput);
      const ast: TranslationDocumentAst = {
        ...parsed,
        schemaVersion: '1.0',
        sourceLanguage: sourceLang,
        targetLanguage: targetLang,
        requestedDocumentType: docType,
        detectedDocumentType: parsed.detectedDocumentType || docType,
        renderingProfile,
        renderLexicon: rawInput['renderLexicon'] as DocumentRenderLexicon,
      } as TranslationDocumentAst;

      return { ast, usedFallback: false, lexiconWarning };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(`[ast-translator] attempt ${attempt + 1} failed:`, lastError.message);
    }
  }

  throw lastError;
}
