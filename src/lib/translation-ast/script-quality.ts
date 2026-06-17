import { resolveScriptProfile } from '@/lib/document-language';
import type { ScriptProfile } from '@/lib/document-language';

export interface OcrQualityResult {
  pass: boolean;
  wordCountEstimate: number;
  charCount: number;
  junkRatio: number;
  scriptProfile: ScriptProfile;
  failReason?: string;
}

/**
 * Count semantic units in a script-aware way.
 * Space-separated scripts: count whitespace tokens.
 * Non-space scripts (CJK, Thai, Khmer, Myanmar, Tibetan): estimate from character count.
 */
function estimateWordUnits(text: string, profile: ScriptProfile): number {
  if (profile.hasWordSpaces) {
    return text.trim().split(/\s+/).filter(Boolean).length;
  }
  const contentChars = text.replace(/\s+/g, '').length;
  return Math.ceil(contentChars / profile.estimatedCharsPerWord);
}

/**
 * Count only characters that are genuinely garbage (replacement chars, PUA, control chars).
 * Does NOT flag Arabic, Thai, Hebrew, CJK, Devanagari, etc. as junk.
 */
function countJunkChars(text: string): number {
  let count = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0xFFFD) { count++; continue; }                          // replacement char
    if (cp >= 0xE000 && cp <= 0xF8FF) { count++; continue; }          // Private Use Area
    if (cp >= 0xFFF0 && cp <= 0xFFFF) { count++; continue; }          // Specials block
    if (cp < 0x20 && cp !== 0x09 && cp !== 0x0A && cp !== 0x0D) {     // control chars
      count++;
    }
  }
  return count;
}

/**
 * Detect the dominant script family in a text sample.
 * Used when sourceLangCode is unknown or 'auto'.
 */
function detectDominantScript(text: string): string {
  const nonWs = text.replace(/\s/g, '');
  if (!nonWs.length) return 'unknown';

  let cjk = 0, arabic = 0, cyrillic = 0, thai = 0, hebrew = 0;
  let devanagari = 0, hangul = 0, latin = 0;

  for (const ch of nonWs) {
    const cp = ch.codePointAt(0) ?? 0;
    if ((cp >= 0x4E00 && cp <= 0x9FFF) || (cp >= 0x3000 && cp <= 0x30FF) ||
        (cp >= 0xF900 && cp <= 0xFAFF) || (cp >= 0x3400 && cp <= 0x4DBF) ||
        (cp >= 0x20000 && cp <= 0x2A6DF)) { cjk++; continue; }
    if ((cp >= 0x0600 && cp <= 0x06FF) || (cp >= 0xFB50 && cp <= 0xFDFF) ||
        (cp >= 0xFE70 && cp <= 0xFEFF)) { arabic++; continue; }
    if ((cp >= 0x0590 && cp <= 0x05FF) || (cp >= 0xFB00 && cp <= 0xFB4F)) { hebrew++; continue; }
    if ((cp >= 0x0400 && cp <= 0x04FF) || (cp >= 0x0500 && cp <= 0x052F)) { cyrillic++; continue; }
    if (cp >= 0x0E00 && cp <= 0x0E7F) { thai++; continue; }
    if (cp >= 0x0900 && cp <= 0x097F) { devanagari++; continue; }
    if (cp >= 0xAC00 && cp <= 0xD7AF) { hangul++; continue; }
    if ((cp >= 0x0041 && cp <= 0x007A) || (cp >= 0x00C0 && cp <= 0x024F)) { latin++; continue; }
    // non-script codepoint — no counter needed
  }

  const scores: [string, number][] = [
    ['zh', cjk], ['ar', arabic], ['he', hebrew], ['ru', cyrillic],
    ['th', thai], ['hi', devanagari], ['ko', hangul], ['en', latin],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  const top = scores[0];
  return top && top[1] > 0 ? top[0] : 'unknown';
}

/**
 * Assess OCR quality in a script-aware manner.
 * Replaces the old whitespace-split heuristic that falsely rejected CJK, Thai, Arabic, etc.
 */
export function assessOcrQuality(
  markdown: string,
  sourceLangCode?: string,
): OcrQualityResult {
  const charCount = markdown.length;
  const dominantCode =
    sourceLangCode && sourceLangCode !== 'auto' && sourceLangCode !== 'auto-detect'
      ? sourceLangCode
      : detectDominantScript(markdown);

  const scriptProfile = resolveScriptProfile(dominantCode);
  const wordCountEstimate = estimateWordUnits(markdown, scriptProfile);
  const junkChars = countJunkChars(markdown);
  const junkRatio = charCount > 0 ? junkChars / charCount : 0;

  const MIN_CHARS = scriptProfile.minQualityChars;
  const MIN_UNITS = 5;
  const MAX_JUNK = 0.3;

  if (charCount < MIN_CHARS) {
    return {
      pass: false,
      wordCountEstimate,
      charCount,
      junkRatio,
      scriptProfile,
      failReason: `Too few characters for ${scriptProfile.name} script (${charCount} < ${MIN_CHARS})`,
    };
  }

  if (wordCountEstimate < MIN_UNITS) {
    return {
      pass: false,
      wordCountEstimate,
      charCount,
      junkRatio,
      scriptProfile,
      failReason: `Too few word units (${wordCountEstimate} < ${MIN_UNITS})`,
    };
  }

  if (junkRatio > MAX_JUNK) {
    return {
      pass: false,
      wordCountEstimate,
      charCount,
      junkRatio,
      scriptProfile,
      failReason: `Junk character ratio too high: ${(junkRatio * 100).toFixed(1)}%`,
    };
  }

  return { pass: true, wordCountEstimate, charCount, junkRatio, scriptProfile };
}
