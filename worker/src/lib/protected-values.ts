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
  const consumed: Array<{ start: number; end: number }> = [];
  const candidates: Candidate[] = [];
  let counter = 1;

  for (const { type, regex } of PATTERNS) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(markdown)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (consumed.some((r) => start < r.end && end > r.start)) continue;

      const original = match[0];
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
): { restoredMarkdown: string; missingTokens: string[]; remainingTokens: string[] } {
  let restoredMarkdown = translatedMarkdown;
  const missingTokens: string[] = [];

  for (const pv of values) {
    if (!restoredMarkdown.includes(pv.token)) {
      missingTokens.push(pv.token);
    } else {
      restoredMarkdown = restoredMarkdown.split(pv.token).join(pv.original);
    }
  }

  const remainingMatches = restoredMarkdown.match(/__WPO_PV_\d{4}__/g);
  const remainingTokens: string[] = remainingMatches
    ? [...new Set(remainingMatches)]
    : [];

  return { restoredMarkdown, missingTokens, remainingTokens };
}
