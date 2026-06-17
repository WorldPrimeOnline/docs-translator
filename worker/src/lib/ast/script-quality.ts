/**
 * Worker-local copy of script-aware OCR quality assessment.
 * Keep in sync with src/lib/translation-ast/script-quality.ts.
 */
import { resolveScriptProfile } from '../document-language';
import type { ScriptProfile } from '../document-language';

export interface OcrQualityResult {
  pass: boolean;
  wordCountEstimate: number;
  charCount: number;
  junkRatio: number;
  scriptProfile: ScriptProfile;
  failReason?: string;
}

function estimateWordUnits(text: string, profile: ScriptProfile): number {
  if (profile.hasWordSpaces) return text.trim().split(/\s+/).filter(Boolean).length;
  const contentChars = text.replace(/\s+/g, '').length;
  return Math.ceil(contentChars / profile.estimatedCharsPerWord);
}

function countJunkChars(text: string): number {
  let count = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0xFFFD) { count++; continue; }
    if (cp >= 0xE000 && cp <= 0xF8FF) { count++; continue; }
    if (cp >= 0xFFF0 && cp <= 0xFFFF) { count++; continue; }
    if (cp < 0x20 && cp !== 0x09 && cp !== 0x0A && cp !== 0x0D) count++;
  }
  return count;
}

function detectDominantScript(text: string): string {
  const nonWs = text.replace(/\s/g, '');
  if (!nonWs.length) return 'unknown';
  let cjk = 0, arabic = 0, cyrillic = 0, thai = 0, hebrew = 0;
  let devanagari = 0, hangul = 0, latin = 0;
  for (const ch of nonWs) {
    const cp = ch.codePointAt(0) ?? 0;
    if ((cp >= 0x4E00 && cp <= 0x9FFF) || (cp >= 0x3000 && cp <= 0x30FF) ||
        (cp >= 0xF900 && cp <= 0xFAFF) || (cp >= 0x3400 && cp <= 0x4DBF)) { cjk++; continue; }
    if ((cp >= 0x0600 && cp <= 0x06FF) || (cp >= 0xFB50 && cp <= 0xFDFF)) { arabic++; continue; }
    if ((cp >= 0x0590 && cp <= 0x05FF) || (cp >= 0xFB00 && cp <= 0xFB4F)) { hebrew++; continue; }
    if ((cp >= 0x0400 && cp <= 0x04FF) || (cp >= 0x0500 && cp <= 0x052F)) { cyrillic++; continue; }
    if (cp >= 0x0E00 && cp <= 0x0E7F) { thai++; continue; }
    if (cp >= 0x0900 && cp <= 0x097F) { devanagari++; continue; }
    if (cp >= 0xAC00 && cp <= 0xD7AF) { hangul++; continue; }
    if ((cp >= 0x0041 && cp <= 0x007A) || (cp >= 0x00C0 && cp <= 0x024F)) latin++;
  }
  const scores: [string, number][] = [
    ['zh', cjk], ['ar', arabic], ['he', hebrew], ['ru', cyrillic],
    ['th', thai], ['hi', devanagari], ['ko', hangul], ['en', latin],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  const top = scores[0];
  return top && top[1] > 0 ? top[0] : 'unknown';
}

export function assessOcrQuality(markdown: string, sourceLangCode?: string): OcrQualityResult {
  const charCount = markdown.length;
  const dominantCode =
    sourceLangCode && sourceLangCode !== 'auto' && sourceLangCode !== 'auto-detect'
      ? sourceLangCode
      : detectDominantScript(markdown);
  const scriptProfile = resolveScriptProfile(dominantCode);
  const wordCountEstimate = estimateWordUnits(markdown, scriptProfile);
  const junkChars = countJunkChars(markdown);
  const junkRatio = charCount > 0 ? junkChars / charCount : 0;

  if (charCount < scriptProfile.minQualityChars) {
    return { pass: false, wordCountEstimate, charCount, junkRatio, scriptProfile,
      failReason: `Too few characters for ${scriptProfile.name} (${charCount} < ${scriptProfile.minQualityChars})` };
  }
  if (wordCountEstimate < 5) {
    return { pass: false, wordCountEstimate, charCount, junkRatio, scriptProfile,
      failReason: `Too few word units (${wordCountEstimate} < 5)` };
  }
  if (junkRatio > 0.3) {
    return { pass: false, wordCountEstimate, charCount, junkRatio, scriptProfile,
      failReason: `Junk ratio too high: ${(junkRatio * 100).toFixed(1)}%` };
  }
  return { pass: true, wordCountEstimate, charCount, junkRatio, scriptProfile };
}
