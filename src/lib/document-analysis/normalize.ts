/**
 * normalizeSourceTextForPricing — shared text normalization before character counting
 * (2026-07-17 decision). Mistral OCR returns markdown, not clean prose — counting raw
 * markdown would bill the customer for table pipes, heading hashes, and other OCR
 * formatting noise. DOCX/PDF-text-layer extraction is cleaner but can still carry stray
 * control characters or inconsistent whitespace.
 *
 * This is the SAME function used by the real document_analysis pipeline (once wired into
 * checkout) and by the internal Pricing Lab's file-mode — never a separate/simplified copy.
 */

// Zero-width and control characters that carry no visible content, as explicit \u escapes
// (never literal invisible characters in source, so this is unambiguous on any editor/diff):
// ZWSP U+200B, ZWNJ U+200C, ZWJ U+200D, LRM U+200E, RLM U+200F, BOM U+FEFF, plus C0 control
// characters other than \n/\t/\r (which are normalized to spaces separately below).
const ZERO_WIDTH_AND_CONTROL_RE = /[\u200B-\u200F\uFEFF\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

// Markdown structural tokens that carry no real document content — only the syntax is
// stripped, never the surrounding text. Order matters: table rows/separators first (before
// generic pipe stripping would otherwise mangle real "|" characters that are actual content
// in the rare case a document contains a literal pipe).
function stripMarkdownStructure(text: string): string {
  return text
    // Table separator rows: |---|---| or | :--- | :---: |
    .replace(/^\s*\|?[\s:|-]+\|[\s:|-]*$/gm, '')
    // Table rows: strip leading/trailing pipes and convert cell separators to spaces
    .replace(/^\s*\|(.+)\|\s*$/gm, (_m, inner: string) => inner.split('|').join(' '))
    // Heading markers (keep the heading text itself)
    .replace(/^#{1,6}\s+/gm, '')
    // Mistral page-separator markers (e.g. "---" alone on a line, or explicit page breaks)
    .replace(/^\s*-{3,}\s*$/gm, '')
    // Markdown emphasis/bold/italic markers around otherwise-real text — strip syntax only
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2');
}

export interface NormalizeResult {
  normalizedText: string;
  characterCount: number;
}

export function normalizeSourceTextForPricing(rawText: string): NormalizeResult {
  let text = rawText.normalize('NFC');
  text = text.replace(ZERO_WIDTH_AND_CONTROL_RE, '');
  text = stripMarkdownStructure(text);
  // Collapse tabs/newlines to a single space, then collapse repeated whitespace.
  text = text.replace(/[\t\n\r]+/g, ' ').replace(/ {2,}/g, ' ').trim();

  // Count Unicode CODE POINTS, not UTF-16 code units — matters for CJK/emoji/combining marks.
  const characterCount = Array.from(text).length;

  return { normalizedText: text, characterCount };
}
