/**
 * Unexpected-script validation for translated Markdown.
 *
 * Detects fragments where characters from the source script appear in
 * target-language headings, labels, or paragraph text.
 * Examples: Cyrillic "COXPAHEH" in an English heading.
 *
 * NOT flagged:
 * - Protected identifiers (__WPO_PV_*__, __WPO_VIS_*__)
 * - Passport/MRZ strings (ALL_CAPS with digits)
 * - Parenthesized originals "(Оригинал)"
 * - Known multilingual markers: [stamp], [подпись], etc.
 * - URLs and emails
 * - Organisation names in quotes or after known markers
 */

export type ScriptFamily = 'Latin' | 'Cyrillic' | 'Arabic' | 'Hebrew' | 'CJK' | 'Thai' | 'Devanagari' | 'Mixed' | 'Neutral';

const LANG_TO_SCRIPT: Record<string, ScriptFamily> = {
  en: 'Latin', es: 'Latin', de: 'Latin', fr: 'Latin', it: 'Latin',
  pt: 'Latin', nl: 'Latin', pl: 'Latin', cs: 'Latin', tr: 'Latin',
  uz: 'Latin', tk: 'Latin',
  ru: 'Cyrillic', kk: 'Cyrillic', mn: 'Cyrillic', ky: 'Cyrillic', tj: 'Cyrillic',
  ar: 'Arabic', fa: 'Arabic', ur: 'Arabic',
  he: 'Hebrew',
  zh: 'CJK', ja: 'CJK', ko: 'CJK',
  th: 'Thai',
  hi: 'Devanagari', ne: 'Devanagari',
};

export function getScriptFamily(lang: string): ScriptFamily {
  return LANG_TO_SCRIPT[lang] ?? 'Latin';
}

// Unicode range checks
function hasCyrillic(s: string): boolean { return /[Ѐ-ӿԀ-ԯ]/.test(s); }
function hasLatin(s: string): boolean { return /[A-Za-z]/.test(s); }
function hasArabic(s: string): boolean { return /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/.test(s); }
function hasCJK(s: string): boolean { return /[一-鿿぀-ヿ가-퟿]/.test(s); }
function hasThai(s: string): boolean { return /[฀-๿]/.test(s); }
function hasDevanagari(s: string): boolean { return /[ऀ-ॿ]/.test(s); }
function hasHebrew(s: string): boolean { return /[֐-׿ﬀ-ﭏ]/.test(s); }

function getActualScript(word: string): ScriptFamily {
  if (hasCyrillic(word)) return 'Cyrillic';
  if (hasArabic(word)) return 'Arabic';
  if (hasCJK(word)) return 'CJK';
  if (hasThai(word)) return 'Thai';
  if (hasDevanagari(word)) return 'Devanagari';
  if (hasHebrew(word)) return 'Hebrew';
  if (hasLatin(word)) return 'Latin';
  return 'Neutral';
}

// Skip these token patterns (protected values, codes, markers)
const SKIP_RE = /^(__WPO_[A-Z_]+_\d{4}__|https?:\/\/|www\.|[A-Z0-9]{2,4}[0-9]{8,}|[A-Z]{4}[A-Z]{2}[A-Z0-9]{2,5}|[+\d][\d\s\-()]{6,}|\[.*\]|\(.+\))$/;
// Looks like an ALL-CAPS code or MRZ fragment
const ALL_CAPS_CODE_RE = /^[A-Z0-9\-_/]+$/;
// Protected WPO token
const WPO_TOKEN_RE = /__WPO_/;

function isProtected(word: string): boolean {
  return WPO_TOKEN_RE.test(word) || SKIP_RE.test(word);
}

function shouldSkipLine(line: string): boolean {
  // Skip table separator, HTML comments, visual inventory lines
  return /^[\|\-\s:]+$/.test(line) || /<!--/.test(line) || /__WPO_VIS_/.test(line);
}

export interface ScriptIssue {
  line: number;
  text: string;
  foundScript: ScriptFamily;
  expectedScript: ScriptFamily;
}

/**
 * Scan translated Markdown for fragments with unexpected script characters.
 * Checks headings (##), key-value labels, and paragraph words.
 * Returns list of suspicious fragments.
 */
export function validateTranslationScript(
  translatedMarkdown: string,
  targetLang: string,
): ScriptIssue[] {
  const expectedScript = getScriptFamily(targetLang);
  // Some locales legitimately mix scripts
  if (expectedScript === 'CJK' || expectedScript === 'Mixed') return [];
  // CJK targets (zh/ja/ko) may contain Latin freely
  if (['zh', 'ja', 'ko'].includes(targetLang)) return [];

  const issues: ScriptIssue[] = [];
  const lines = translatedMarkdown.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (shouldSkipLine(line)) continue;

    // Only check headings and non-table lines for unexpected-script issues
    const isHeading = /^#{1,3}\s/.test(line);
    const isTableRow = line.trim().startsWith('|');
    const isParagraph = !isHeading && !isTableRow && line.trim().length > 2;

    if (!isHeading && !isParagraph) continue;

    // Extract words — split on whitespace and common punctuation
    const words = line.replace(/^#+\s+/, '').split(/[\s,;:!?.()\[\]{}|\/\\]+/).filter(w => w.length >= 3);

    for (const word of words) {
      if (isProtected(word)) continue;
      if (ALL_CAPS_CODE_RE.test(word) && word.length <= 12) continue; // short codes OK

      const actualScript = getActualScript(word);
      if (actualScript === 'Neutral' || actualScript === expectedScript) continue;

      // Latin targets may have Cyrillic confusables (handled by confusable scanner elsewhere)
      // but if a whole word is Cyrillic in English heading — it's a real issue
      if (expectedScript === 'Latin' && actualScript === 'Cyrillic') {
        // Only flag if word is entirely Cyrillic (not just has a confusable char)
        if (!hasLatin(word)) {
          issues.push({
            line: i + 1,
            text: word,
            foundScript: 'Cyrillic',
            expectedScript: 'Latin',
          });
        }
      } else if (expectedScript === 'Cyrillic' && actualScript === 'Latin') {
        // Cyrillic targets may have Latin abbreviations — only flag if it looks like a word
        if (!hasCyrillic(word) && word.length > 4 && !/^\d/.test(word)) {
          issues.push({
            line: i + 1,
            text: word,
            foundScript: 'Latin',
            expectedScript: 'Cyrillic',
          });
        }
      } else if (
        (expectedScript === 'Latin' || expectedScript === 'Cyrillic') &&
        (actualScript === 'Thai' || actualScript === 'Arabic' || actualScript === 'Hebrew' || actualScript === 'Devanagari')
      ) {
        // Non-Latin/Cyrillic script word in a Latin or Cyrillic target document.
        // Short originals in parentheses are acceptable; longer words indicate missed translation.
        // Table cells are excluded from this check — they may legitimately contain
        // short source-language original values.
        if (!isTableRow && word.length > 3) {
          issues.push({
            line: i + 1,
            text: word,
            foundScript: actualScript,
            expectedScript,
          });
        }
      }
    }
  }

  // Deduplicate by text
  const seen = new Set<string>();
  return issues.filter(i => {
    if (seen.has(i.text)) return false;
    seen.add(i.text);
    return true;
  });
}

/**
 * Build a targeted correction prompt for unexpected-script fragments.
 * Sends Claude the specific lines with issues and requests correction only.
 */
export function buildScriptCorrectionPrompt(
  issues: ScriptIssue[],
  targetLang: string,
): string {
  const fragments = issues.map(i => `Line ${i.line}: "${i.text}"`).join('\n');
  return `The following fragments appear to contain characters from the wrong script for ${targetLang}. Please re-translate ONLY these specific words/phrases to ${targetLang} and return the corrected full document:\n\n${fragments}\n\nReturn the complete corrected document, not just the fragments.`;
}
