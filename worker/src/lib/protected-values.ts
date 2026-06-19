/**
 * Minimal protected-values mechanism for critical document identifiers.
 *
 * Pattern: extract → placeholder token → LLM translation → exact restore.
 * Tokens use {{V0001}} format — template-like, LLM-resistant.
 */

const TOKEN_PREFIX = '{{V';
const TOKEN_SUFFIX = '}}';

export interface ProtectedEntry {
  token: string;
  value: string;
}

/**
 * Ordered patterns for critical identifier types.
 * More specific patterns come first to prevent partial overlaps.
 */
const PATTERNS: RegExp[] = [
  // IBAN / IIK: 2-letter country code + 2 check digits + 10–30 alphanumeric
  // e.g., KZ559876543210123456
  /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g,

  // BIC / SWIFT: 8 or 11 uppercase-alphanumeric chars (bank:4 + country:2 + loc:2 + branch?:3)
  // e.g., KCJBKZKX
  /\b[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/g,

  // IIN / BIN / certificate numbers: 9–12 consecutive digits
  // e.g., 047291638, 201240012345, 930208450176
  /\b\d{9,12}\b/g,

  // Passport / ID numbers: 1–2 uppercase letters followed by 6–9 digits
  // e.g., N14720583
  /\b[A-Z]{1,2}\d{6,9}\b/g,

  // Reference / verification codes: uppercase or Cyrillic-uppercase prefix +
  // 2+ separator-delimited segments (dash or slash).
  // e.g., SML-2026-06-17-071, SML-74-KZ-170626-Q8X5, ТД-2020/0914-38
  /(?<![A-Za-zА-ЯЁа-яё0-9])([A-ZА-ЯЁ]{2,5}(?:[-/][A-Z0-9А-ЯЁ.]{2,}){2,})(?![A-Za-zА-ЯЁа-яё0-9])/g,
];

function makeToken(index: number): string {
  return `${TOKEN_PREFIX}${String(index).padStart(4, '0')}${TOKEN_SUFFIX}`;
}

/**
 * Scan text for critical identifiers and replace them with opaque placeholder tokens.
 * Returns the protected text and a list of token→original mappings.
 */
export function extractProtectedValues(text: string): { protected: string; entries: ProtectedEntry[] } {
  type Span = { start: number; end: number; value: string };
  const spans: Span[] = [];

  for (const pattern of PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      // Capturing group (reference-code pattern) or full match
      const value = m[1] !== undefined ? m[1] : m[0];
      const matchStart = m.index + m[0].indexOf(value);
      const matchEnd = matchStart + value.length;
      const overlaps = spans.some(s => matchStart < s.end && matchEnd > s.start);
      if (!overlaps) {
        spans.push({ start: matchStart, end: matchEnd, value });
      }
    }
  }

  spans.sort((a, b) => a.start - b.start);

  const valueToToken = new Map<string, string>();
  const entries: ProtectedEntry[] = [];
  let result = '';
  let pos = 0;

  for (const span of spans) {
    result += text.slice(pos, span.start);
    if (!valueToToken.has(span.value)) {
      const token = makeToken(entries.length);
      valueToToken.set(span.value, token);
      entries.push({ token, value: span.value });
    }
    result += valueToToken.get(span.value)!;
    pos = span.end;
  }
  result += text.slice(pos);

  return { protected: result, entries };
}

/**
 * Replace placeholder tokens back with their original values.
 * Uses exact string replacement to avoid regex edge cases.
 */
export function restoreProtectedValues(text: string, entries: ProtectedEntry[]): string {
  let result = text;
  for (const { token, value } of entries) {
    result = result.split(token).join(value);
  }
  return result;
}
