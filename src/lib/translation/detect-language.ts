import Anthropic from '@anthropic-ai/sdk';
import { env } from '@/lib/env';

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-5-20250929';
const MAX_RETRIES = 3;
const ALLOWED_LANGS = new Set(['en', 'ru', 'zh', 'ko', 'kk', 'tj', 'uz', 'tk', 'mn', 'ky', 'es', 'th']);

export async function detectSourceLanguage(ocrText: string): Promise<string | null> {
  const sample = ocrText.slice(0, 1500).trim();
  let lastErr: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) await new Promise<void>((r) => setTimeout(r, 1000 * 2 ** attempt));
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 10,
        system: 'Detect the dominant language of this document text. Reply with ONLY one lowercase ISO-639-1 code from this list: en ru zh ko kk tj uz tk mn ky es th. No other text.',
        messages: [{ role: 'user', content: sample }],
      });
      const block = response.content[0];
      if (block?.type !== 'text') throw new Error('Unexpected response type from Claude');
      const code = block.text.trim().toLowerCase();
      return ALLOWED_LANGS.has(code) ? code : null;
    } catch (err) {
      lastErr = err;
      console.error(`[detect-language] attempt ${attempt + 1} failed:`, err instanceof Error ? err.message : String(err));
    }
  }

  console.error('[detect-language] all retries exhausted, returning null', lastErr instanceof Error ? lastErr.message : String(lastErr));
  return null;
}
