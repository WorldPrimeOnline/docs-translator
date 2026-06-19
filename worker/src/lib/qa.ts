/**
 * Worker-local QA checks.
 * Keep in sync with src/lib/translation-workflow/qa.ts.
 */
import type { OutputMode } from './output-plan';

/**
 * Advisory warning codes that may be added to TranslationQaReport.warnings.
 * These are informational only — qa.ok === false is NEVER a blocker for translator handoff.
 * The processor must always pass the document to the next stage regardless of QA result.
 */
export const QA_ADVISORY_CODES = {
  SIGNATURE_COUNT_CHANGED: 'SIGNATURE_COUNT_CHANGED',
  TABLE_ROW_COUNT: 'TABLE_ROW_COUNT',
  PROTECTED_VALUE_CHANGED: 'PROTECTED_VALUE_CHANGED',
  MIXED_SCRIPT_TOKEN_REQUIRES_REVIEW: 'MIXED_SCRIPT_TOKEN_REQUIRES_REVIEW',
} as const;

export interface MixedScriptWarning {
  code: 'MIXED_SCRIPT_TOKEN_REQUIRES_REVIEW';
  tokenPreview: string;
  severity: 'warning';
}

export interface TranslationQaReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  mixedScriptWarnings?: MixedScriptWarning[];
  pages?: number;
  hasTranslatorBlock: boolean;
  hasVisualElementsBlock: boolean;
  hasVerificationBlock: boolean;
  hasForbiddenTechnicalTerms: boolean;
  hasBrokenGlyphs: boolean;
  hasPotentialTableClipping: boolean;
  hasOrphanHeadings?: boolean;
  requiresHumanReview: boolean;
}

const FORBIDDEN_TERMS = [
  'Claude',
  'Mistral',
  ' OCR ',
  'fallback',
  'serviceLevel',
  'document_type',
  'JSON',
  'Markdown',
  'renderer',
  'parser',
  'debug',
];

/**
 * Find compact machine-like tokens that contain both Latin and Cyrillic letters.
 * Conditions: 4-40 chars, no spaces, letters/digits/hyphens/slashes, both scripts present.
 * Does NOT flag multi-word phrases or pure-script tokens.
 */
function findMixedScriptTokens(text: string): string[] {
  const results: string[] = [];
  for (const token of text.split(/[\s,;:'"()\[\]{}«»]+/)) {
    if (token.length < 4 || token.length > 40) continue;
    if (!/^[A-Za-zЀ-ӿ0-9\-\/]+$/.test(token)) continue;
    if (/[A-Za-z]/.test(token) && /[Ѐ-ӿ]/.test(token)) {
      results.push(token);
    }
  }
  return results;
}

function makeTokenPreview(token: string): string {
  return token.length > 6 ? token.slice(0, 2) + '…' + token.slice(-2) : token;
}

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

function checkForbiddenTerms(visibleText: string): boolean {
  for (const term of FORBIDDEN_TERMS) {
    if (term.includes(' ')) {
      if (visibleText.includes(term)) return true;
    } else {
      const re = new RegExp(`(?<![a-zA-Z])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-zA-Z])`);
      if (re.test(visibleText)) return true;
    }
  }
  return false;
}

export function runQaChecks(
  html: string,
  mode: OutputMode,
  pdfPageCount?: number,
): TranslationQaReport {
  const visibleText = stripHtmlTags(html);
  const htmlLower = html.toLowerCase();

  const hasTranslatorBlock =
    html.includes('Переводчик') || html.includes('Translator:');

  const hasVisualElementsBlock =
    htmlLower.includes('нетекстовых элементов') ||
    htmlLower.includes('non-text elements');

  const hasVerificationBlock =
    htmlLower.includes('электронной проверки') ||
    htmlLower.includes('verification');

  const hasForbiddenTechnicalTerms = checkForbiddenTerms(visibleText);

  const hasBrokenGlyphs =
    visibleText.includes('�') ||
    visibleText.includes('□') ||
    /□{3,}/.test(visibleText);

  const hasPotentialTableClipping =
    /<t[dhr][^>]*style="[^"]*overflow:\s*hidden[^"]*"/i.test(html) ||
    /<table[^>]*style="[^"]*overflow:\s*hidden[^"]*"/i.test(html);

  const requiresHumanReview =
    mode === 'translator_review_draft' ||
    mode === 'notarization_package';

  const errors: string[] = [];
  const warnings: string[] = [];

  if (hasBrokenGlyphs) {
    errors.push('Output contains broken or replacement glyphs (□ or �).');
  }

  if (hasForbiddenTechnicalTerms) {
    errors.push('Output contains forbidden technical terms (AI service names, internal parameters).');
  }

  if (hasPotentialTableClipping) {
    warnings.push('Table overflow:hidden detected — content may be clipped in PDF output.');
  }

  // Mixed-script machine tokens: flag for human review, never block delivery
  const rawMixedTokens = findMixedScriptTokens(visibleText);
  const mixedScriptWarnings: MixedScriptWarning[] = rawMixedTokens.map((token) => ({
    code: 'MIXED_SCRIPT_TOKEN_REQUIRES_REVIEW' as const,
    tokenPreview: makeTokenPreview(token),
    severity: 'warning' as const,
  }));
  if (mixedScriptWarnings.length > 0) {
    const previews = mixedScriptWarnings.map((w) => w.tokenPreview).join(', ');
    warnings.push(
      `MIXED_SCRIPT_TOKEN_REQUIRES_REVIEW: ${previews} — ` +
      'Обнаружено значение со смешанными латинскими и кириллическими символами. Сверьте его с оригиналом.',
    );
  }

  let ok: boolean;

  switch (mode) {
    case 'translation_only':
      ok = !hasForbiddenTechnicalTerms && !hasBrokenGlyphs;
      break;

    case 'translator_review_draft':
      if (!hasTranslatorBlock) {
        warnings.push('Translator certification block not found — expected for review draft.');
      }
      if (!hasVisualElementsBlock) {
        warnings.push('Visual elements section not found in draft.');
      }
      ok = !hasBrokenGlyphs;
      break;

    case 'notarization_package':
      if (!hasTranslatorBlock) {
        errors.push('Translator certification block missing — required for official translation.');
      }
      if (!hasVisualElementsBlock) {
        errors.push('Visual elements section missing — required for official translation.');
      }
      ok =
        hasTranslatorBlock &&
        hasVisualElementsBlock &&
        !hasForbiddenTechnicalTerms &&
        !hasBrokenGlyphs;
      break;

    default:
      ok = !hasForbiddenTechnicalTerms && !hasBrokenGlyphs;
  }

  return {
    ok,
    errors,
    warnings,
    mixedScriptWarnings: mixedScriptWarnings.length > 0 ? mixedScriptWarnings : undefined,
    pages: pdfPageCount,
    hasTranslatorBlock,
    hasVisualElementsBlock,
    hasVerificationBlock,
    hasForbiddenTechnicalTerms,
    hasBrokenGlyphs,
    hasPotentialTableClipping,
    requiresHumanReview,
  };
}
