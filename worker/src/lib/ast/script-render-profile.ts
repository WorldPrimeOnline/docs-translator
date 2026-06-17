/**
 * Worker-local copy. Keep in sync with src/lib/translation-ast/script-render-profile.ts.
 */
import type { ScriptName } from '../document-language';

export type ScriptRenderProfile = {
  direction: 'ltr' | 'rtl';
  fontFamily: string;
  fallbackFonts: string[];
  supportsWordBreaking: boolean;
  lineHeightMultiplier: number;
  defaultFontSizePt: number;
};

const SCRIPT_RENDER_PROFILES: Record<ScriptName, ScriptRenderProfile> = {
  latin:      { direction: 'ltr', fontFamily: 'Noto Serif',            fallbackFonts: ['Times New Roman', 'serif'],          supportsWordBreaking: true,  lineHeightMultiplier: 1.5, defaultFontSizePt: 11 },
  cyrillic:   { direction: 'ltr', fontFamily: 'Noto Serif',            fallbackFonts: ['Times New Roman', 'serif'],          supportsWordBreaking: true,  lineHeightMultiplier: 1.5, defaultFontSizePt: 11 },
  greek:      { direction: 'ltr', fontFamily: 'Noto Serif',            fallbackFonts: ['Times New Roman', 'serif'],          supportsWordBreaking: true,  lineHeightMultiplier: 1.5, defaultFontSizePt: 11 },
  armenian:   { direction: 'ltr', fontFamily: 'Noto Serif',            fallbackFonts: ['Times New Roman', 'serif'],          supportsWordBreaking: true,  lineHeightMultiplier: 1.5, defaultFontSizePt: 11 },
  georgian:   { direction: 'ltr', fontFamily: 'Noto Serif',            fallbackFonts: ['Times New Roman', 'serif'],          supportsWordBreaking: true,  lineHeightMultiplier: 1.5, defaultFontSizePt: 11 },
  arabic:     { direction: 'rtl', fontFamily: 'Noto Sans Arabic',      fallbackFonts: ['Arial', 'sans-serif'],               supportsWordBreaking: true,  lineHeightMultiplier: 1.8, defaultFontSizePt: 12 },
  hebrew:     { direction: 'rtl', fontFamily: 'Noto Sans Hebrew',      fallbackFonts: ['Arial', 'sans-serif'],               supportsWordBreaking: true,  lineHeightMultiplier: 1.6, defaultFontSizePt: 12 },
  chinese:    { direction: 'ltr', fontFamily: 'Noto Serif CJK SC',     fallbackFonts: ['Noto Sans CJK SC', 'serif'],         supportsWordBreaking: false, lineHeightMultiplier: 1.8, defaultFontSizePt: 11 },
  japanese:   { direction: 'ltr', fontFamily: 'Noto Serif CJK JP',     fallbackFonts: ['Noto Sans CJK JP', 'serif'],         supportsWordBreaking: false, lineHeightMultiplier: 1.8, defaultFontSizePt: 11 },
  korean:     { direction: 'ltr', fontFamily: 'Noto Serif CJK KR',     fallbackFonts: ['Noto Sans CJK KR', 'serif'],         supportsWordBreaking: false, lineHeightMultiplier: 1.8, defaultFontSizePt: 11 },
  thai:       { direction: 'ltr', fontFamily: 'Noto Sans Thai',        fallbackFonts: ['Garuda', 'sans-serif'],              supportsWordBreaking: false, lineHeightMultiplier: 2.0, defaultFontSizePt: 12 },
  devanagari: { direction: 'ltr', fontFamily: 'Noto Serif Devanagari', fallbackFonts: ['Noto Sans Devanagari', 'serif'],     supportsWordBreaking: true,  lineHeightMultiplier: 1.8, defaultFontSizePt: 12 },
  ethiopic:   { direction: 'ltr', fontFamily: 'Noto Sans Ethiopic',    fallbackFonts: ['Noto Sans', 'Arial', 'sans-serif'],  supportsWordBreaking: false, lineHeightMultiplier: 2.0, defaultFontSizePt: 12 },
  khmer:      { direction: 'ltr', fontFamily: 'Noto Sans Khmer',       fallbackFonts: ['Noto Sans', 'Arial', 'sans-serif'],  supportsWordBreaking: false, lineHeightMultiplier: 2.0, defaultFontSizePt: 12 },
  myanmar:    { direction: 'ltr', fontFamily: 'Noto Sans Myanmar',     fallbackFonts: ['Noto Sans', 'Arial', 'sans-serif'],  supportsWordBreaking: false, lineHeightMultiplier: 2.0, defaultFontSizePt: 12 },
  tibetan:    { direction: 'ltr', fontFamily: 'Noto Serif Tibetan',    fallbackFonts: ['Noto Sans', 'Arial', 'sans-serif'],  supportsWordBreaking: false, lineHeightMultiplier: 2.0, defaultFontSizePt: 12 },
  unknown:    { direction: 'ltr', fontFamily: 'Noto Sans',             fallbackFonts: ['Arial', 'sans-serif'],               supportsWordBreaking: true,  lineHeightMultiplier: 1.6, defaultFontSizePt: 11 },
};

export function getScriptRenderProfile(scriptName: ScriptName): ScriptRenderProfile {
  return SCRIPT_RENDER_PROFILES[scriptName] ?? SCRIPT_RENDER_PROFILES.unknown;
}

export function getCssFont(profile: ScriptRenderProfile): string {
  const all = [profile.fontFamily, ...profile.fallbackFonts];
  return all.map((f) => (f.includes(' ') ? `"${f}"` : f)).join(', ');
}
