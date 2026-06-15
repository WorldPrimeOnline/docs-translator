/**
 * Worker-local QA checks.
 * Keep in sync with src/lib/translation-workflow/qa.ts.
 */
import type { OutputMode } from './output-plan';

export interface TranslationQaReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
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
