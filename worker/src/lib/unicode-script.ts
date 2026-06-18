export type ScriptKind =
  | 'latin'
  | 'cyrillic'
  | 'thai'
  | 'arabic'
  | 'hebrew'
  | 'cjk'
  | 'devanagari'
  | 'common'
  | 'unknown';

export interface ScriptSegment {
  text: string;
  script: ScriptKind;
}

export function detectUnicodeScript(cp: number): ScriptKind {
  if (cp <= 0x002F) return 'common';                          // control + !"#$%&'()*+,-./
  if (cp >= 0x0030 && cp <= 0x0039) return 'common';         // 0–9
  if (cp >= 0x003A && cp <= 0x0040) return 'common';         // :;<=>?@
  if (cp >= 0x005B && cp <= 0x0060) return 'common';         // [\]^_`
  if (cp >= 0x007B && cp <= 0x00BF) return 'common';         // {|}~, Latin-1 symbols ¡¢£…¿
  // Latin (ASCII + Extended-A/B + Additional)
  if (
    (cp >= 0x0041 && cp <= 0x007A) ||
    (cp >= 0x00C0 && cp <= 0x024F) ||
    (cp >= 0x1E00 && cp <= 0x1EFF)
  ) return 'latin';
  // Cyrillic
  if (
    (cp >= 0x0400 && cp <= 0x04FF) ||
    (cp >= 0x0500 && cp <= 0x052F) ||
    (cp >= 0x2DE0 && cp <= 0x2DFF) ||
    (cp >= 0xA640 && cp <= 0xA69F)
  ) return 'cyrillic';
  // Thai (base block + supplemental)
  if (cp >= 0x0E00 && cp <= 0x0E7F) return 'thai';
  // Arabic
  if (
    (cp >= 0x0600 && cp <= 0x06FF) ||
    (cp >= 0x0750 && cp <= 0x077F) ||
    (cp >= 0xFB50 && cp <= 0xFDFF) ||
    (cp >= 0xFE70 && cp <= 0xFEFF)
  ) return 'arabic';
  // Hebrew
  if (
    (cp >= 0x0590 && cp <= 0x05FF) ||
    (cp >= 0xFB00 && cp <= 0xFB4F)
  ) return 'hebrew';
  // Devanagari
  if (cp >= 0x0900 && cp <= 0x097F) return 'devanagari';
  // CJK: radicals, unified ideographs, Hiragana, Katakana, Hangul, compat
  if (
    (cp >= 0x2E80 && cp <= 0x2FFF) ||
    (cp >= 0x3000 && cp <= 0x9FFF) ||
    (cp >= 0xA000 && cp <= 0xA4CF) ||
    (cp >= 0xAC00 && cp <= 0xD7AF) ||
    (cp >= 0xF900 && cp <= 0xFAFF) ||
    (cp >= 0x20000 && cp <= 0x2A6DF) ||
    (cp >= 0x2A700 && cp <= 0x2CEAF)
  ) return 'cjk';
  return 'unknown';
}

/**
 * Split text into script-homogeneous segments.
 *
 * Common characters (punctuation, spaces, digits) attach to the immediately
 * preceding non-common segment (left-leaning). Leading commons attach to
 * the first real-script segment. Trailing commons become their own segment.
 */
export function splitTextByScript(text: string): ScriptSegment[] {
  if (!text) return [];

  let currentScript: ScriptKind | null = null;
  let currentText = '';
  let pendingCommon = '';
  const segments: ScriptSegment[] = [];

  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    const script = detectUnicodeScript(cp);

    if (script === 'common' || script === 'unknown') {
      pendingCommon += char;
    } else if (script === currentScript) {
      // Same script: absorb pending common into the current run
      currentText += pendingCommon + char;
      pendingCommon = '';
    } else {
      // Script change (or first script encountered)
      if (currentText) {
        // Attach pending common to the outgoing run (left-leaning punctuation attachment)
        segments.push({ text: currentText + pendingCommon, script: currentScript! });
        currentText = '';
        pendingCommon = '';
      } else if (pendingCommon) {
        // Leading common before any script: attach to the incoming script
        currentText = pendingCommon;
        pendingCommon = '';
      }
      currentScript = script;
      currentText += char;
    }
  }

  if (currentText) {
    // Trailing common chars (digits, punctuation) attach to the final real-script run.
    // This keeps identifiers like "N14720583" or "IBAN KZ55..." in a single TextRun.
    segments.push({ text: currentText + pendingCommon, script: currentScript! });
  } else if (pendingCommon) {
    // String composed entirely of common chars (e.g., "2026-06-18")
    segments.push({ text: pendingCommon, script: 'common' });
  }

  return segments;
}

/**
 * Returns true when the text is predominantly right-to-left (Arabic or Hebrew).
 * Used to set paragraph bidirectional and alignment properties.
 * "Dominant" means > 50% of non-common code points are RTL script.
 */
export function hasDominantRtlScript(text: string): boolean {
  let rtlCount = 0;
  let totalCount = 0;
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    const script = detectUnicodeScript(cp);
    if (script !== 'common' && script !== 'unknown') {
      totalCount++;
      if (script === 'arabic' || script === 'hebrew') rtlCount++;
    }
  }
  return totalCount > 0 && rtlCount / totalCount > 0.5;
}
