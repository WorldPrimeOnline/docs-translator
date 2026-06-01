import Anthropic from '@anthropic-ai/sdk';
import { env } from '@/lib/env';
import { buildTranslationPrompt, normalizeDocumentType } from '@/lib/translation-prompts';

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

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
        system: systemPrompt,
        messages: [{ role: 'user', content: `${userPrompt}\n\n${chunk}` }],
      });

      const block = response.content[0];
      if (block?.type !== 'text') throw new Error('Unexpected response type from Claude');
      return block.text;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(`[translator] attempt ${attempt + 1} failed:`, {
        message: lastError.message,
        status: (err as Record<string, unknown>)?.status,
        error: (err as Record<string, unknown>)?.error,
      });
    }
  }

  throw lastError;
}

export async function translateDocument(
  markdown: string,
  sourceLang: string,
  targetLang: string,
  documentType: string,
): Promise<string> {
  const chunks = chunkMarkdown(markdown);
  const results = await Promise.all(
    chunks.map((chunk) => translateChunk(chunk, sourceLang, targetLang, documentType)),
  );
  return results.join('\n\n');
}
