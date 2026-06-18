/**
 * Structural translation review — focused Claude call to detect untranslated
 * or transliterated fragments in headings, labels, and table headers.
 *
 * This catches cases like phonetic Latin transcriptions of source-language words
 * that slip through script-level detection (which only catches actual Cyrillic/Arabic
 * characters, not ASCII representations of them).
 *
 * Never throws — returns empty array on any failure.
 */

const MODEL = 'claude-sonnet-4-5-20250929';
const MAX_TOKENS = 1024;

export type StructuralCorrectionReason =
  | 'untranslated'
  | 'transliterated_instead_of_translated'
  | 'ocr_corruption'
  | 'wrong_target_language'
  | 'broken_heading';

export interface StructuralTranslationCorrection {
  original: string;
  corrected: string;
  reason: StructuralCorrectionReason;
}

// Matches __WPO_PV_0001__ and __WPO_VIS_0001__ tokens
const PROTECTED_TOKEN_RE = /__WPO_(?:PV|VIS)_\d{4}__/;

/**
 * Extract structural elements (headings, KV labels, table headers) from markdown.
 * These are the elements most likely to contain untranslated/transliterated fragments.
 */
export function extractStructuralElements(markdown: string): string[] {
  const lines = markdown.split('\n');
  const elements: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? '';
    if (!line) continue;
    if (PROTECTED_TOKEN_RE.test(line)) continue;

    // Document title and section headings
    if (/^#{1,3}\s+/.test(line)) {
      const text = line.replace(/^#+\s+/, '').trim();
      if (text.length > 1 && !PROTECTED_TOKEN_RE.test(text)) {
        elements.push(text);
      }
      continue;
    }

    // Table rows
    if (line.startsWith('|')) {
      const next = lines[i + 1]?.trim() ?? '';
      const isSeparator = /^\|?[\s\-|:]+\|?$/.test(next);
      const cells = line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

      if (isSeparator) {
        // Header row: extract all cells
        cells.forEach((c) => {
          if (c.length > 1 && !PROTECTED_TOKEN_RE.test(c)) elements.push(c);
        });
      } else if (cells.length === 2) {
        // KV data row: extract the label (first cell only)
        const label = cells[0] ?? '';
        if (label.length > 1 && !PROTECTED_TOKEN_RE.test(label)) {
          elements.push(label);
        }
      }
    }
  }

  // Deduplicate preserving order
  const seen = new Set<string>();
  return elements.filter((e) => {
    if (seen.has(e)) return false;
    seen.add(e);
    return true;
  });
}

function isValidCorrection(item: unknown): item is StructuralTranslationCorrection {
  if (typeof item !== 'object' || item === null) return false;
  const obj = item as Record<string, unknown>;
  return (
    typeof obj['original'] === 'string' &&
    typeof obj['corrected'] === 'string' &&
    typeof obj['reason'] === 'string' &&
    obj['original'].length > 0 &&
    obj['corrected'].length > 0 &&
    obj['original'] !== obj['corrected']
  );
}

/**
 * Apply structural corrections to markdown via exact string replacement.
 * Protected tokens (__WPO_PV_*__, __WPO_VIS_*__) are never replaced.
 */
export function applyStructuralCorrections(
  markdown: string,
  corrections: StructuralTranslationCorrection[],
): string {
  let result = markdown;
  for (const { original, corrected } of corrections) {
    if (!original || !corrected || original === corrected) continue;
    if (PROTECTED_TOKEN_RE.test(original)) continue;
    const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(escaped, 'g'), corrected);
  }
  return result;
}

/**
 * Run a focused structural translation review.
 * Extracts headings and labels, asks Claude to identify non-target-language fragments,
 * then returns a list of exact corrections.
 * Returns empty array on failure — caller should log and continue.
 */
export async function runStructuralReview(
  markdown: string,
  targetLang: string,
  sourceLang: string,
): Promise<StructuralTranslationCorrection[]> {
  const elements = extractStructuralElements(markdown);
  if (elements.length === 0) return [];

  // Deferred imports — avoid top-level env validation in test environments
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Anthropic = (require('@anthropic-ai/sdk') as { default: typeof import('@anthropic-ai/sdk').default }).default;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { env } = require('./env') as typeof import('./env');
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const tgtName = LANG_DISPLAY[targetLang] ?? targetLang.toUpperCase();
  const srcName = LANG_DISPLAY[sourceLang] ?? sourceLang.toUpperCase();

  const systemPrompt =
    `You are a translation quality reviewer specializing in document localization.` +
    ` You will receive structural elements (headings, field labels, table headers) from a document` +
    ` translated into ${tgtName} from ${srcName}.` +
    ` Identify elements that contain words NOT in ${tgtName}, including:` +
    ` source-language words left untranslated, phonetic transliterations of source-language words` +
    ` written in the Latin alphabet, and OCR-corrupted sequences that appear as nonsense.` +
    ` Do NOT flag: proper nouns (person names, organization names, city/country names),` +
    ` codes (document numbers, reference codes, identifiers),` +
    ` numbers, dates, currency amounts, email addresses, URLs,` +
    ` standard international abbreviations (ID, IIN, BIN, IIK, IBAN, BIC, SWIFT, etc.),` +
    ` or tokens matching __WPO_PV_*__ / __WPO_VIS_*__ patterns.`;

  const userPrompt =
    `Structural elements to review:\n` +
    elements.join('\n') +
    `\n\nReturn a JSON array of corrections. If nothing needs correction, return [].` +
    ` Format: [{"original":"...","corrected":"...","reason":"untranslated|transliterated_instead_of_translated|ocr_corruption|wrong_target_language|broken_heading"}]`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const block = response.content[0];
    if (block?.type !== 'text') return [];

    const text = block.text.trim();
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed: unknown = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(isValidCorrection);
  } catch {
    return [];
  }
}

// Minimal display names for log messages
const LANG_DISPLAY: Record<string, string> = {
  en: 'English', ru: 'Russian', zh: 'Chinese', ko: 'Korean',
  kk: 'Kazakh', tj: 'Tajik', uz: 'Uzbek', tk: 'Turkmen',
  mn: 'Mongolian', ky: 'Kyrgyz', es: 'Spanish', th: 'Thai',
};
