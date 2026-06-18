export type ProtectedValueType =
  | 'document_number'
  | 'identity_number'
  | 'passport_number'
  | 'tax_identifier'
  | 'bank_account'
  | 'bic_swift'
  | 'contract_number'
  | 'phone'
  | 'email'
  | 'url'
  | 'verification_code'
  | 'money'
  | 'mrz'
  | 'other_code';

export type ProtectedValue = {
  token: string;
  original: string;
  type: ProtectedValueType;
  occurrenceIndex: number;
};

// ── Unicode confusable maps ───────────────────────────────────────────────────
// Cyrillic characters visually confusable with Latin ASCII (both cases where applicable)

const CYRILLIC_TO_LATIN: Readonly<Record<string, string>> = {
  // Uppercase Cyrillic → Latin
  'А': 'A', 'В': 'B', 'С': 'C', 'Е': 'E', 'Н': 'H',
  'І': 'I', 'Ј': 'J', 'К': 'K', 'М': 'M', 'О': 'O',
  'Р': 'P', 'Ѕ': 'S', 'Т': 'T', 'Х': 'X',
  // Lowercase Cyrillic → Latin
  'а': 'a', 'с': 'c', 'е': 'e', 'і': 'i', 'о': 'o',
  'р': 'p', 'х': 'x',
};

// Latin uppercase → most common Cyrillic confusable (for building match regex)
const LATIN_TO_CYRILLIC: Readonly<Record<string, string>> = {
  'A': 'А', 'B': 'В', 'C': 'С', 'E': 'Е', 'H': 'Н',
  'I': 'І', 'J': 'Ј', 'K': 'К', 'M': 'М', 'O': 'О',
  'P': 'Р', 'S': 'Ѕ', 'T': 'Т', 'X': 'Х',
};

/** Replace Cyrillic confusable characters with their Latin ASCII equivalents. */
export function normalizeConfusables(str: string): string {
  let result = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]!;
    result += CYRILLIC_TO_LATIN[ch] ?? ch;
  }
  return result;
}

/**
 * Returns true if the string contains both ASCII Latin letters and Cyrillic
 * characters that are visually confusable with Latin letters.
 */
export function detectMixedScriptConfusables(str: string): boolean {
  const hasLatin = /[A-Za-z]/.test(str);
  if (!hasLatin) return false;
  return Object.keys(CYRILLIC_TO_LATIN).some(ch => str.includes(ch));
}

/**
 * Build a regex that matches `original` OR any confusable-Cyrillic variant of it.
 * Used in post-restoration scanning.
 */
function buildConfusableRegex(original: string): RegExp {
  const pattern = original
    .split('')
    .map(ch => {
      const cyrillicVariant = LATIN_TO_CYRILLIC[ch.toUpperCase()];
      if (!cyrillicVariant) return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Match either the original char or its Cyrillic confusable
      const latinChar = ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return `[${latinChar}${cyrillicVariant}]`;
    })
    .join('');
  return new RegExp(pattern, 'g');
}

// Code-type fields where values must be pure ASCII — normalise confusables on extract
const CODE_TYPES = new Set<ProtectedValueType>([
  'bic_swift', 'bank_account', 'document_number', 'identity_number',
  'passport_number', 'verification_code', 'tax_identifier', 'contract_number',
]);

// Priority-ordered patterns — first match per position wins
const PATTERNS: Array<{ type: ProtectedValueType; regex: RegExp }> = [
  { type: 'mrz', regex: /[A-Z0-9<]{30,}/g },
  { type: 'bank_account', regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g },
  { type: 'bic_swift', regex: /\b[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/g },
  { type: 'url', regex: /https?:\/\/[^\s<>"']+/g },
  { type: 'email', regex: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g },
  { type: 'phone', regex: /\+[1-9]\d{0,2}[\s\-()]?\d{3}[\s\-()]?\d{3}[\s\-()]?\d{2}[\s\-()]?\d{2}/g },
  { type: 'verification_code', regex: /\b[A-Z][A-Z0-9]{1,9}(?:[-/][A-Z0-9]{2,10}){2,}\b/g },
  { type: 'money', regex: /\b\d{1,3}(?:\s\d{3})*(?:[,.]\d{2})?\s*(?:KZT|USD|EUR|RUB|GBP|THB|CNY|JPY|AED)\b/g },
  { type: 'identity_number', regex: /\b\d{12}\b/g },
  { type: 'passport_number', regex: /\b[A-Z]\d{7,9}\b/g },
  { type: 'document_number', regex: /\b\d{7,9}\b/g },
];

type Candidate = {
  start: number;
  end: number;
  token: string;
  original: string;
  type: ProtectedValueType;
  occurrenceIndex: number;
};

export function extractAndProtectValues(markdown: string): {
  protectedMarkdown: string;
  values: ProtectedValue[];
} {
  // Normalise confusables so patterns (which use [A-Z]) can match OCR-noisy codes.
  // Positions are 1:1 since normalizeConfusables is a char-for-char substitution.
  const normalizedMarkdown = normalizeConfusables(markdown);

  const consumed: Array<{ start: number; end: number }> = [];
  const candidates: Candidate[] = [];
  let counter = 1;

  for (const { type, regex } of PATTERNS) {
    // Run pattern on normalized text so confusable-containing codes are also caught
    const searchText = CODE_TYPES.has(type) ? normalizedMarkdown : markdown;
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(searchText)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (consumed.some((r) => start < r.end && end > r.start)) continue;

      // Extract from original text (same positions since normalisation is 1:1)
      const originalInSource = markdown.slice(start, end);
      // For code types: normalize confusables so the stored original is clean ASCII.
      // This handles OCR noise where e.g. Cyrillic Х is mixed into a BIC.
      const original = CODE_TYPES.has(type)
        ? normalizeConfusables(originalInSource)
        : originalInSource;

      const token = `__WPO_PV_${counter.toString().padStart(4, '0')}__`;
      const occurrenceIndex = candidates.filter((c) => c.original === original).length;

      candidates.push({ start, end, token, original, type, occurrenceIndex });
      consumed.push({ start, end });
      counter++;
    }
  }

  candidates.sort((a, b) => a.start - b.start);

  let protectedMarkdown = '';
  let pos = 0;
  for (const c of candidates) {
    protectedMarkdown += markdown.slice(pos, c.start);
    protectedMarkdown += c.token;
    pos = c.end;
  }
  protectedMarkdown += markdown.slice(pos);

  const values: ProtectedValue[] = candidates.map((c) => ({
    token: c.token,
    original: c.original,
    type: c.type,
    occurrenceIndex: c.occurrenceIndex,
  }));

  return { protectedMarkdown, values };
}

export function restoreProtectedValues(
  translatedMarkdown: string,
  values: ProtectedValue[],
): {
  restoredMarkdown: string;
  missingTokens: string[];
  remainingTokens: string[];
  forcedRestores: string[];
} {
  let restoredMarkdown = translatedMarkdown;
  const missingTokens: string[] = [];
  const forcedRestores: string[] = [];

  for (const pv of values) {
    if (restoredMarkdown.includes(pv.token)) {
      restoredMarkdown = restoredMarkdown.split(pv.token).join(pv.original);
    } else {
      // Token not found verbatim — try confusable-normalized search.
      // Claude may have replaced Latin chars in the token with Cyrillic confusables
      // (e.g. __WPO_РV_0005__ instead of __WPO_PV_0005__).
      // pv.token is pure ASCII so normalizeConfusables(pv.token) === pv.token.
      // Normalising the translated text maps Cyrillic confusables back to Latin,
      // which lets us find the corrupted token at the original position.
      const normalizedTranslation = normalizeConfusables(restoredMarkdown);
      const tokenIdx = normalizedTranslation.indexOf(pv.token);

      if (tokenIdx >= 0) {
        const before = restoredMarkdown.slice(0, tokenIdx);
        const after = restoredMarkdown.slice(tokenIdx + pv.token.length);
        restoredMarkdown = before + pv.original + after;
        forcedRestores.push(`${pv.token}:token_confusable`);
      } else {
        missingTokens.push(pv.token);
      }
    }
  }

  // ── Post-restoration confusable scan (code fields only) ─────────────────────
  // For code-type fields where the original is clean ASCII (which it always is after
  // normalizeConfusables in extraction), scan for any confusable-corrupted variant
  // that may have been written by Claude if the BIC wasn't caught by the regex.
  for (const pv of values) {
    if (!CODE_TYPES.has(pv.type)) continue;
    // pv.original is clean ASCII after extraction normalisation.
    // Build regex that matches original OR any per-char Cyrillic confusable variant.
    const re = buildConfusableRegex(pv.original);
    const newMarkdown = restoredMarkdown.replace(re, (match) => {
      if (match !== pv.original) {
        forcedRestores.push(`${pv.token}:confusable_scan:${match}`);
        return pv.original;
      }
      return match;
    });
    if (newMarkdown !== restoredMarkdown) {
      restoredMarkdown = newMarkdown;
    }
  }

  const remainingMatches = restoredMarkdown.match(/__WPO_PV_\d{4}__/g);
  const remainingTokens: string[] = remainingMatches
    ? [...new Set(remainingMatches)]
    : [];

  return { restoredMarkdown, missingTokens, remainingTokens, forcedRestores };
}
