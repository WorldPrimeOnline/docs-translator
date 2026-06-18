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
const MAX_TOKENS = 1536;

export type StructuralCorrectionReason =
  | 'untranslated'
  | 'transliterated_instead_of_translated'
  | 'ocr_corruption'
  | 'wrong_target_language'
  | 'broken_heading'
  | 'spelling'
  | 'unnatural_translation'
  | 'entity_inconsistency'
  | 'incorrect_acronym';

export type StructuralSegmentType =
  | 'title'
  | 'heading'
  | 'label'
  | 'table_header'
  | 'organization_name'
  | 'bank_name'
  | 'acronym';

export interface StructuralTranslationCorrection {
  original: string;
  corrected: string;
  reason: StructuralCorrectionReason;
  /** Identifies the kind of document element corrected. Optional for backward compatibility. */
  segmentType?: StructuralSegmentType;
}

// Matches __WPO_PV_0001__ and __WPO_VIS_0001__ tokens
const PROTECTED_TOKEN_RE = /__WPO_(?:PV|VIS)_\d{4}__/;

// Values that look like organization/bank names (heuristic, language-agnostic legal-form prefixes)
const LEGAL_FORM_RE =
  /\b(LLP|LLC|JSC|PJSC|OJSC|Inc\.|Ltd\.|GmbH|S\.A\.|Bank|АО|ОАО|ЗАО|ТОО|ТОВ|ИП|ООО|Банк|Товарищество|Акционерное)/i;

// Numbers, dates, codes — must NOT be reviewed
const SKIP_VALUE_RE =
  /^\d|^[A-Z]{2}\d{2}|[#№]\s*\d|\d{4}-\d{2}|\d{2}\.\d{2}\.\d{4}|@|https?:\/\//i;

/**
 * Extract structural elements from markdown: headings, labels, table headers,
 * and cell values that look like organization names or bank names.
 * Numbers, codes, dates, protected tokens are excluded.
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
        // Also extract the value if it looks like an organization or bank name
        const value = cells[1] ?? '';
        if (
          value.length > 2 &&
          !PROTECTED_TOKEN_RE.test(value) &&
          !SKIP_VALUE_RE.test(value) &&
          LEGAL_FORM_RE.test(value)
        ) {
          elements.push(value);
        }
      } else if (cells.length >= 3 && !isSeparator) {
        // Multi-column table data row: extract first cell if it looks like a label or org name
        const first = cells[0] ?? '';
        if (first.length > 2 && !PROTECTED_TOKEN_RE.test(first) && !SKIP_VALUE_RE.test(first)) {
          elements.push(first);
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

const VALID_REASONS = new Set<string>([
  'untranslated', 'transliterated_instead_of_translated', 'ocr_corruption',
  'wrong_target_language', 'broken_heading', 'spelling',
  'unnatural_translation', 'entity_inconsistency', 'incorrect_acronym',
]);

function isValidCorrection(item: unknown): item is StructuralTranslationCorrection {
  if (typeof item !== 'object' || item === null) return false;
  const obj = item as Record<string, unknown>;
  if (
    typeof obj['original'] !== 'string' ||
    typeof obj['corrected'] !== 'string' ||
    typeof obj['reason'] !== 'string'
  ) return false;
  if (!obj['original'].length || !obj['corrected'].length) return false;
  if (obj['original'] === obj['corrected']) return false;
  if (!VALID_REASONS.has(obj['reason'])) return false;
  // Protected tokens must never appear in original
  if (PROTECTED_TOKEN_RE.test(obj['original'] as string)) return false;
  return true;
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
    `You are a translation quality reviewer specializing in official document localization.` +
    ` You receive structural elements (document titles, headings, field labels, table headers,` +
    ` organization names, bank names) from a document translated into ${tgtName} from ${srcName}.` +
    ` Identify and correct ONLY the following issues:\n` +
    ` (1) untranslated — source-language words left in the text;\n` +
    ` (2) transliterated_instead_of_translated — phonetic Latin transcription of source-language words;\n` +
    ` (3) ocr_corruption — garbled sequences (e.g. "lIIC", "Centr" instead of "Center");\n` +
    ` (4) wrong_target_language — text in a third language;\n` +
    ` (5) broken_heading — structurally malformed title or heading;\n` +
    ` (6) spelling — clear spelling error in a structural element;\n` +
    ` (7) unnatural_translation — awkward calque that a ${tgtName} speaker would never write;\n` +
    ` (8) entity_inconsistency — same organization/bank name spelled differently in the same document;\n` +
    ` (9) incorrect_acronym — acronym that is wrong for the target language (e.g. IIC vs IIK).\n\n` +
    ` STRICT EXCLUSIONS — do NOT flag or change:\n` +
    ` - Person names, city names, country names;\n` +
    ` - Amounts, numbers, account/document codes, dates;\n` +
    ` - Email addresses and URLs;\n` +
    ` - __WPO_PV_*__ and __WPO_VIS_*__ tokens;\n` +
    ` - Organization names that are registered trademarks or brands (leave as-is unless there is a clear spelling error);\n` +
    ` - Standard international abbreviations: IIN, BIN, IIK, IBAN, BIC, SWIFT, KZT, USD, etc.`;

  const reasonValues =
    `untranslated|transliterated_instead_of_translated|ocr_corruption|` +
    `wrong_target_language|broken_heading|spelling|unnatural_translation|` +
    `entity_inconsistency|incorrect_acronym`;
  const segmentValues =
    `title|heading|label|table_header|organization_name|bank_name|acronym`;

  const userPrompt =
    `Structural elements to review:\n` +
    elements.join('\n') +
    `\n\nReturn a JSON array of corrections. If nothing needs correction, return [].` +
    ` Format: [{"original":"...","corrected":"...","reason":"${reasonValues}","segmentType":"${segmentValues}"}]` +
    ` Emit only corrections where you are highly confident. Do not guess.`;

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
