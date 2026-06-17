/**
 * Worker-local copy of document language resolution.
 * Keep in sync with src/lib/document-language/index.ts.
 */

export type ScriptName =
  | 'latin' | 'cyrillic' | 'arabic' | 'hebrew' | 'chinese' | 'japanese'
  | 'korean' | 'thai' | 'devanagari' | 'greek' | 'georgian' | 'armenian'
  | 'ethiopic' | 'khmer' | 'myanmar' | 'tibetan' | 'unknown';

export interface ScriptProfile {
  name: ScriptName;
  direction: 'ltr' | 'rtl';
  hasWordSpaces: boolean;
  minQualityChars: number;
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
  en: 'latin', fr: 'latin', de: 'latin', es: 'latin', it: 'latin',
  pt: 'latin', nl: 'latin', pl: 'latin', cs: 'latin', sk: 'latin',
  ro: 'latin', hu: 'latin', hr: 'latin', sl: 'latin', lt: 'latin',
  lv: 'latin', et: 'latin', fi: 'latin', sv: 'latin', da: 'latin',
  no: 'latin', nb: 'latin', nn: 'latin', id: 'latin', ms: 'latin',
  vi: 'latin', tr: 'latin', az: 'latin', tk: 'latin', uz: 'latin',
  sw: 'latin', yo: 'latin', ig: 'latin', ha: 'latin', so: 'latin',
  la: 'latin', sq: 'latin', mt: 'latin', eu: 'latin', ca: 'latin',
  af: 'latin', cy: 'latin', ga: 'latin', is: 'latin',
  ru: 'cyrillic', uk: 'cyrillic', be: 'cyrillic', bg: 'cyrillic',
  sr: 'cyrillic', mk: 'cyrillic', kk: 'cyrillic', ky: 'cyrillic',
  tg: 'cyrillic', tj: 'cyrillic', mn: 'cyrillic', ba: 'cyrillic',
  ar: 'arabic', fa: 'arabic', ur: 'arabic', ps: 'arabic',
  ku: 'arabic', sd: 'arabic', ug: 'arabic',
  he: 'hebrew', yi: 'hebrew',
  zh: 'chinese', 'zh-hans': 'chinese', 'zh-hant': 'chinese',
  'zh-cn': 'chinese', 'zh-tw': 'chinese', 'zh-hk': 'chinese',
  ja: 'japanese',
  ko: 'korean',
  th: 'thai',
  hi: 'devanagari', mr: 'devanagari', ne: 'devanagari', sa: 'devanagari',
  el: 'greek',
  ka: 'georgian',
  hy: 'armenian',
  am: 'ethiopic', ti: 'ethiopic',
  km: 'khmer',
  my: 'myanmar',
  bo: 'tibetan',
};

const LANG_DISPLAY_NAMES: Record<string, string> = {
  en: 'English', fr: 'French', de: 'German', es: 'Spanish', it: 'Italian',
  pt: 'Portuguese', nl: 'Dutch', pl: 'Polish', cs: 'Czech', sk: 'Slovak',
  ro: 'Romanian', hu: 'Hungarian', id: 'Indonesian', ms: 'Malay',
  vi: 'Vietnamese', tr: 'Turkish', az: 'Azerbaijani', tk: 'Turkmen', uz: 'Uzbek',
  ru: 'Russian', uk: 'Ukrainian', be: 'Belarusian', bg: 'Bulgarian',
  sr: 'Serbian', mk: 'Macedonian', kk: 'Kazakh', ky: 'Kyrgyz',
  tg: 'Tajik', tj: 'Tajik', mn: 'Mongolian',
  ar: 'Arabic', fa: 'Persian', ur: 'Urdu', ps: 'Pashto',
  he: 'Hebrew', yi: 'Yiddish',
  zh: 'Chinese', 'zh-hans': 'Chinese (Simplified)', 'zh-hant': 'Chinese (Traditional)',
  'zh-cn': 'Chinese (Simplified)', 'zh-tw': 'Chinese (Traditional)',
  ja: 'Japanese', ko: 'Korean', th: 'Thai',
  hi: 'Hindi', mr: 'Marathi', ne: 'Nepali',
  el: 'Greek', ka: 'Georgian', hy: 'Armenian',
  am: 'Amharic', km: 'Khmer', my: 'Burmese', bo: 'Tibetan',
};

function normalizeCode(raw: string): string {
  const lower = raw.toLowerCase().replace(/_/g, '-');
  if (lower.startsWith('zh-')) {
    const variant = lower.slice(3, 7);
    if (['hans', 'hant'].includes(variant)) return `zh-${variant}`;
    const reg = lower.slice(3, 5);
    if (['cn', 'tw', 'hk', 'sg'].includes(reg)) return `zh-${reg}`;
    return 'zh';
  }
  const parts = lower.split('-');
  if (parts.length > 1 && parts[1]!.length === 2 && /^[a-z]{2}$/.test(parts[1]!)) {
    return parts[0]!;
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
    return { code: 'auto', normalizedCode: 'auto', displayName: 'Auto-detected', script: 'unknown', direction: 'ltr' };
  }
  const normalizedCode = normalizeCode(code);
  const script = LANG_TO_SCRIPT[normalizedCode] ?? 'unknown';
  const direction = SCRIPT_PROFILES[script].direction;
  const displayName = LANG_DISPLAY_NAMES[normalizedCode] ?? code.toUpperCase();
  return { code, normalizedCode, displayName, script, direction, localeForFormatting: normalizedCode };
}
