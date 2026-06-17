/**
 * Language-agnostic document language model.
 * Intentionally decoupled from UI locales — supports any BCP-47 code.
 */

export type ScriptName =
  | 'latin'
  | 'cyrillic'
  | 'arabic'
  | 'hebrew'
  | 'chinese'
  | 'japanese'
  | 'korean'
  | 'thai'
  | 'devanagari'
  | 'greek'
  | 'georgian'
  | 'armenian'
  | 'ethiopic'
  | 'khmer'
  | 'myanmar'
  | 'tibetan'
  | 'unknown';

export interface ScriptProfile {
  name: ScriptName;
  direction: 'ltr' | 'rtl';
  /** False for scripts that don't use whitespace as word boundaries (CJK, Thai, Khmer, etc.) */
  hasWordSpaces: boolean;
  /** Minimum characters that constitute a meaningful OCR result */
  minQualityChars: number;
  /** Approximate characters per "word unit" for word-count estimation in no-space scripts */
  estimatedCharsPerWord: number;
}

export interface DocumentLanguage {
  code: string;
  normalizedCode: string;
  displayName: string;
  script: ScriptName;
  direction: 'ltr' | 'rtl';
  localeForFormatting?: string;
}

const SCRIPT_PROFILES: Record<ScriptName, ScriptProfile> = {
  latin:      { name: 'latin',      direction: 'ltr', hasWordSpaces: true,  minQualityChars: 30,  estimatedCharsPerWord: 5 },
  cyrillic:   { name: 'cyrillic',   direction: 'ltr', hasWordSpaces: true,  minQualityChars: 30,  estimatedCharsPerWord: 6 },
  arabic:     { name: 'arabic',     direction: 'rtl', hasWordSpaces: true,  minQualityChars: 20,  estimatedCharsPerWord: 4 },
  hebrew:     { name: 'hebrew',     direction: 'rtl', hasWordSpaces: true,  minQualityChars: 20,  estimatedCharsPerWord: 4 },
  chinese:    { name: 'chinese',    direction: 'ltr', hasWordSpaces: false, minQualityChars: 10,  estimatedCharsPerWord: 2 },
  japanese:   { name: 'japanese',   direction: 'ltr', hasWordSpaces: false, minQualityChars: 10,  estimatedCharsPerWord: 2 },
  korean:     { name: 'korean',     direction: 'ltr', hasWordSpaces: true,  minQualityChars: 15,  estimatedCharsPerWord: 3 },
  thai:       { name: 'thai',       direction: 'ltr', hasWordSpaces: false, minQualityChars: 15,  estimatedCharsPerWord: 3 },
  devanagari: { name: 'devanagari', direction: 'ltr', hasWordSpaces: true,  minQualityChars: 20,  estimatedCharsPerWord: 4 },
  greek:      { name: 'greek',      direction: 'ltr', hasWordSpaces: true,  minQualityChars: 30,  estimatedCharsPerWord: 5 },
  georgian:   { name: 'georgian',   direction: 'ltr', hasWordSpaces: true,  minQualityChars: 25,  estimatedCharsPerWord: 5 },
  armenian:   { name: 'armenian',   direction: 'ltr', hasWordSpaces: true,  minQualityChars: 25,  estimatedCharsPerWord: 5 },
  ethiopic:   { name: 'ethiopic',   direction: 'ltr', hasWordSpaces: true,  minQualityChars: 20,  estimatedCharsPerWord: 4 },
  khmer:      { name: 'khmer',      direction: 'ltr', hasWordSpaces: false, minQualityChars: 15,  estimatedCharsPerWord: 3 },
  myanmar:    { name: 'myanmar',    direction: 'ltr', hasWordSpaces: false, minQualityChars: 15,  estimatedCharsPerWord: 3 },
  tibetan:    { name: 'tibetan',    direction: 'ltr', hasWordSpaces: false, minQualityChars: 15,  estimatedCharsPerWord: 3 },
  unknown:    { name: 'unknown',    direction: 'ltr', hasWordSpaces: true,  minQualityChars: 30,  estimatedCharsPerWord: 5 },
};

const LANG_TO_SCRIPT: Record<string, ScriptName> = {
  // Latin
  en: 'latin', fr: 'latin', de: 'latin', es: 'latin', it: 'latin',
  pt: 'latin', nl: 'latin', pl: 'latin', cs: 'latin', sk: 'latin',
  ro: 'latin', hu: 'latin', hr: 'latin', sl: 'latin', lt: 'latin',
  lv: 'latin', et: 'latin', fi: 'latin', sv: 'latin', da: 'latin',
  no: 'latin', nb: 'latin', nn: 'latin', id: 'latin', ms: 'latin',
  vi: 'latin', tr: 'latin', az: 'latin', tk: 'latin', uz: 'latin',
  sw: 'latin', yo: 'latin', ig: 'latin', ha: 'latin', so: 'latin',
  la: 'latin', sq: 'latin', mt: 'latin', eu: 'latin', ca: 'latin',
  af: 'latin', cy: 'latin', ga: 'latin', is: 'latin',
  // Cyrillic
  ru: 'cyrillic', uk: 'cyrillic', be: 'cyrillic', bg: 'cyrillic',
  sr: 'cyrillic', mk: 'cyrillic', kk: 'cyrillic', ky: 'cyrillic',
  tg: 'cyrillic', tj: 'cyrillic', mn: 'cyrillic', ba: 'cyrillic',
  // Arabic
  ar: 'arabic', fa: 'arabic', ur: 'arabic', ps: 'arabic',
  ku: 'arabic', sd: 'arabic', ug: 'arabic', prs: 'arabic',
  // Hebrew
  he: 'hebrew', yi: 'hebrew',
  // Chinese
  zh: 'chinese',
  'zh-hans': 'chinese', 'zh-hant': 'chinese',
  'zh-cn': 'chinese', 'zh-tw': 'chinese', 'zh-hk': 'chinese',
  'zh-sg': 'chinese',
  // Japanese
  ja: 'japanese',
  // Korean
  ko: 'korean',
  // Thai
  th: 'thai',
  // Devanagari
  hi: 'devanagari', mr: 'devanagari', ne: 'devanagari', sa: 'devanagari',
  bho: 'devanagari', mai: 'devanagari',
  // Greek
  el: 'greek',
  // Georgian
  ka: 'georgian',
  // Armenian
  hy: 'armenian',
  // Ethiopic
  am: 'ethiopic', ti: 'ethiopic', om: 'ethiopic',
  // Khmer
  km: 'khmer',
  // Myanmar
  my: 'myanmar',
  // Tibetan
  bo: 'tibetan',
};

const LANG_DISPLAY_NAMES: Record<string, string> = {
  en: 'English', fr: 'French', de: 'German', es: 'Spanish', it: 'Italian',
  pt: 'Portuguese', nl: 'Dutch', pl: 'Polish', cs: 'Czech', sk: 'Slovak',
  ro: 'Romanian', hu: 'Hungarian', hr: 'Croatian', sl: 'Slovenian',
  lt: 'Lithuanian', lv: 'Latvian', et: 'Estonian', fi: 'Finnish',
  sv: 'Swedish', da: 'Danish', no: 'Norwegian', nb: 'Norwegian Bokmål',
  id: 'Indonesian', ms: 'Malay', vi: 'Vietnamese', tr: 'Turkish',
  az: 'Azerbaijani', tk: 'Turkmen', uz: 'Uzbek', af: 'Afrikaans',
  cy: 'Welsh', ga: 'Irish', is: 'Icelandic',
  ru: 'Russian', uk: 'Ukrainian', be: 'Belarusian', bg: 'Bulgarian',
  sr: 'Serbian', mk: 'Macedonian', kk: 'Kazakh', ky: 'Kyrgyz',
  tg: 'Tajik', tj: 'Tajik', mn: 'Mongolian', ba: 'Bashkir',
  ar: 'Arabic', fa: 'Persian', ur: 'Urdu', ps: 'Pashto',
  ku: 'Kurdish', sd: 'Sindhi', ug: 'Uyghur',
  he: 'Hebrew', yi: 'Yiddish',
  zh: 'Chinese', 'zh-hans': 'Chinese (Simplified)', 'zh-hant': 'Chinese (Traditional)',
  'zh-cn': 'Chinese (Simplified)', 'zh-tw': 'Chinese (Traditional)',
  'zh-hk': 'Chinese (Traditional, HK)',
  ja: 'Japanese', ko: 'Korean', th: 'Thai',
  hi: 'Hindi', mr: 'Marathi', ne: 'Nepali', sa: 'Sanskrit',
  el: 'Greek', ka: 'Georgian', hy: 'Armenian',
  am: 'Amharic', ti: 'Tigrinya',
  km: 'Khmer', my: 'Burmese', bo: 'Tibetan',
};

/** Normalize raw code: lowercase, underscore→dash, strip pure-region subtags except for Chinese variants. */
function normalizeCode(raw: string): string {
  const lower = raw.toLowerCase().replace(/_/g, '-');
  // Chinese variants: keep zh-hans, zh-hant, zh-cn, zh-tw, zh-hk, zh-sg
  if (lower.startsWith('zh-')) {
    const variant = lower.slice(3, 7);
    if (['hans', 'hant'].includes(variant)) return `zh-${variant}`;
    if (['cn', 'tw', 'hk', 'sg'].includes(lower.slice(3, 5))) return `zh-${lower.slice(3, 5)}`;
    return 'zh';
  }
  // Strip region subtag for other codes: en-US → en, pt-BR → pt
  const parts = lower.split('-');
  if (parts.length > 1 && parts[1] !== undefined && parts[1].length === 2 && /^[a-z]{2}$/.test(parts[1])) {
    return parts[0] ?? lower;
  }
  return lower;
}

export function resolveScriptProfile(codeOrScript: string): ScriptProfile {
  const normalized = normalizeCode(codeOrScript);
  const script = LANG_TO_SCRIPT[normalized] ?? 'unknown';
  return SCRIPT_PROFILES[script];
}

export function resolveTextDirection(code: string): 'ltr' | 'rtl' {
  if (!code || code === 'auto' || code === 'auto-detect') return 'ltr';
  const normalized = normalizeCode(code);
  const script = LANG_TO_SCRIPT[normalized];
  if (!script) return 'ltr';
  return SCRIPT_PROFILES[script].direction;
}

export function resolveDocumentLanguage(code: string): DocumentLanguage {
  if (!code || code === 'auto' || code === 'auto-detect') {
    return {
      code: 'auto',
      normalizedCode: 'auto',
      displayName: 'Auto-detected',
      script: 'unknown',
      direction: 'ltr',
    };
  }

  const normalizedCode = normalizeCode(code);
  const script = LANG_TO_SCRIPT[normalizedCode] ?? 'unknown';
  const direction = SCRIPT_PROFILES[script].direction;
  const displayName = LANG_DISPLAY_NAMES[normalizedCode] ?? code.toUpperCase();

  return {
    code,
    normalizedCode,
    displayName,
    script,
    direction,
    localeForFormatting: normalizedCode !== 'unknown' ? normalizedCode : undefined,
  };
}
