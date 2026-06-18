import Anthropic from '@anthropic-ai/sdk';
import { env } from './env';
import { buildTranslationPrompt, normalizeDocumentType } from './translation-prompts';

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const MODEL = 'claude-sonnet-4-5-20250929';
const MAX_RETRIES = 3;
const CHUNK_WORD_LIMIT = 3000;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).length;
}

function chunkMarkdown(markdown: string): string[] {
  if (wordCount(markdown) <= CHUNK_WORD_LIMIT) return [markdown];

  const paragraphs = markdown.split(/\n\n+/);
  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    const candidate = current ? `${current}\n\n${para}` : para;
    if (wordCount(candidate) > CHUNK_WORD_LIMIT && current) {
      chunks.push(current);
      current = para;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function translateChunk(
  chunk: string,
  sourceLang: string,
  targetLang: string,
  documentType: string,
): Promise<string> {
  let lastError: Error = new Error('Translation failed');

  const docType = normalizeDocumentType(documentType);
  const { systemPrompt, userPrompt } = buildTranslationPrompt({
    sourceLanguage: sourceLang,
    targetLanguage: targetLang,
    documentType: docType,
  });

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** attempt);
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 8192,
        temperature: 0,
        system: systemPrompt,
        messages: [{ role: 'user', content: `${userPrompt}\n\n${chunk}` }],
      });

      const block = response.content[0];
      if (block?.type !== 'text') throw new Error('Unexpected response type from Claude');
      return block.text;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[translator] attempt ${attempt + 1} failed:`, lastError.message);
    }
  }

  throw lastError;
}

/**
 * Strip internally generated chunk/page markers from translated output.
 *
 * Claude must not emit "Page X/Y" or "Страница X/Y" as standalone lines that
 * it invented as chunk separators. Source page references ("Page 1 of 2") are
 * preserved when embedded in prose. Only bare "N/M" or "Страница N/M" lines
 * generated as chunk metadata are removed.
 */
/** Exported for testing only. */
export function stripInternalChunkMarkersForTest(text: string): string {
  return stripInternalChunkMarkers(text);
}

function stripInternalChunkMarkers(text: string): string {
  // Standalone "Страница N/M" or "Page N/M" or "Chunk N/M" — NOT preceded by other text
  // Must be on its own line (nothing else on that line except optional whitespace)
  return text
    .split('\n')
    .filter(line => {
      const trimmed = line.trim();
      // Remove lines that are purely "Страница N/M", "Page N/M", "Chunk N/M"
      // Matches: "Page: 1 / 1", "Page 1 / 1", "Page 1/1", "Страница: 1/1", "Chunk 2/3"
      // "Страница N из N" uses "из" not "/" — that form is preserved as it may be source content.
      if (/^(?:страница|page|chunk):?\s*\d+\s*\/\s*\d+$/i.test(trimmed)) return false;
      return true;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

export async function translateDocument(
  markdown: string,
  sourceLang: string,
  targetLang: string,
  documentType: string,
): Promise<string> {
  const chunks = chunkMarkdown(markdown);
  console.log(`[translator] ${chunks.length} chunk(s), ${wordCount(markdown)} words`);
  const results = await Promise.all(
    chunks.map((c) => translateChunk(c, sourceLang, targetLang, documentType)),
  );
  const joined = results.join('\n\n');
  return stripInternalChunkMarkers(joined);
}

export async function retranslateWithCorrection(
  markdown: string,
  sourceLang: string,
  targetLang: string,
  documentType: string,
  correctionInstructions: string,
): Promise<string> {
  const docType = normalizeDocumentType(documentType);
  const { systemPrompt, userPrompt } = buildTranslationPrompt({
    sourceLanguage: sourceLang,
    targetLanguage: targetLang,
    documentType: docType,
  });

  const correctedSystemPrompt = `${systemPrompt}\n\n## CORRECTION REQUIRED\n${correctionInstructions}`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    temperature: 0,
    system: correctedSystemPrompt,
    messages: [{ role: 'user', content: `${userPrompt}\n\n${markdown}` }],
  });

  const block = response.content[0];
  if (block?.type !== 'text') throw new Error('Unexpected response type from Claude');
  return block.text;
}
