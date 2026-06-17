import Anthropic from '@anthropic-ai/sdk';
import { env } from '@/lib/env';
import { resolveDocumentLanguage } from '@/lib/document-language';
import { normalizeDocumentType } from '@/lib/translation-prompts';
import type { DocumentType } from '@/lib/translation-prompts/types';
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

function buildSystemPrompt(
  sourceLanguage: string,
  targetLanguage: string,
  docType: DocumentType,
  profileGuidance: string,
  hasStaticLexicon: boolean,
): string {
  const sourcePart =
    !sourceLanguage || sourceLanguage === 'auto' || sourceLanguage === 'auto-detect'
      ? 'the source language detected from the document content'
      : sourceLanguage;

  const lexiconInstruction = hasStaticLexicon
    ? `The renderLexicon for "${targetLanguage}" is pre-verified — use the exact values provided in context.`
    : `Produce a complete renderLexicon entirely in the TARGET language "${targetLanguage}". Every string must be in ${targetLanguage}. Not in English. Not in the source language.`;

  return `You are a professional document translation assistant. Use the produce_translation_ast tool to return a fully structured translation.

TASK: Translate the OCR-extracted document from ${sourcePart} into ${targetLanguage}.

DOCUMENT TYPE: ${docType}
PROFILE GUIDANCE: ${profileGuidance}

CORE TRANSLATION RULES:
1. Translate only what is present — never invent, summarize, or omit content.
2. All translated text must be in ${targetLanguage}. Do not mix languages.
3. Protected values (document numbers, IDs, passport numbers, IBAN, SWIFT/BIC, amounts, dates, MRZ lines, verification codes, leading zeros) must be preserved exactly — byte-for-byte.
4. All blocks must appear in the same order as in the source document.
5. Each source page boundary produces a page_break block.
6. Each signatory is a separate signature block. Never merge signatories.
7. Tables: preserve ALL rows in source order. Do not drop or reorder rows.
8. Legal clauses: preserve number hierarchy — numbered children become ClauseBlock.children.
9. Names: transliterate if target script differs; keep passport Latin spelling if present.
10. Do not produce Markdown formatting, HTML tags, or layout in text fields.
11. Do not add marketing text or disclaimers.
12. Do not claim certification, notarization, or official acceptance.

BLOCK SELECTION:
- Document/section titles → heading (level 1–2)
- Subsection labels → heading (level 3)
- Labeled field pairs (Name: …, Date: …) → key_value
- Plain prose → paragraph
- Tabular data with columns → table
- Bullet or numbered lists → list
- Numbered legal clauses → clause (with children for subclauses)
- Signatures / stamps → signature + visual_marker blocks
- QR / barcode / emblem / photo → visual_marker
- MRZ / verification strings → verificationItems array
- Translator uncertainty notes → note (noteType: "translator")

VISUAL MARKERS: All marker text must be in ${targetLanguage}, never in English or the source language. Use the lexicon visualMarkers strings.

${lexiconInstruction}

FORBIDDEN IN BLOCKS: AI, Claude, Mistral, OCR, JSON, Markdown, renderer, parser, serviceLevel, document_type, fallback, debug.

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
    params.sourceLanguage,
    params.targetLanguage,
    docType,
    profileGuidance,
    !!staticLexicon,
  );

  const lexiconContext = staticLexicon
    ? `\n\nPRE-VERIFIED LEXICON FOR ${targetLang.displayName.toUpperCase()} — use these exact values in renderLexicon:\n${JSON.stringify(staticLexicon, null, 2)}`
    : '';

  const userContent =
    `Document: ${params.documentType} | Pages: ${params.pageCount} | Source: ${params.sourceLanguage} | Target: ${params.targetLanguage}${lexiconContext}\n\n---\n\n${params.ocrMarkdown}`;

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
      if (!toolUse || toolUse.type !== 'tool_use') {
        throw new Error('Model did not return a tool_use block');
      }

      const rawInput = toolUse.input as Record<string, unknown>;

      // Validate and potentially fix lexicon
      let lexiconWarning: string | undefined;
      const providedLexicon = rawInput['renderLexicon'];
      if (staticLexicon) {
        if (!validateLexicon(providedLexicon)) {
          rawInput['renderLexicon'] = staticLexicon;
          lexiconWarning = 'Lexicon replaced with static verified pack — model-provided lexicon failed validation';
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
        detectedDocumentType: (parsed.detectedDocumentType as DocumentType) || docType,
        renderingProfile,
        renderLexicon: (rawInput['renderLexicon'] as DocumentRenderLexicon),
      } as TranslationDocumentAst;

      return { ast, usedFallback: false, lexiconWarning };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(`[ast-translator] attempt ${attempt + 1} failed:`, lastError.message);
    }
  }

  throw lastError;
}
