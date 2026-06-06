import type { VisualElement, VisualElementKind } from './types';

// Guess kind from image alt text
function kindFromAlt(alt: string): VisualElementKind {
  const a = alt.toLowerCase();
  if (a.includes('logo') || a.includes('логотип')) return 'logo';
  if (a.includes('emblem') || a.includes('герб') || a.includes('coat of arms')) return 'emblem';
  if (a.includes('photo') || a.includes('фото') || a.includes('portrait')) return 'photo';
  if (a.includes('qr') || a.includes('qr-код')) return 'qr';
  if (a.includes('barcode') || a.includes('штрих')) return 'barcode';
  if (a.includes('stamp') || a.includes('seal') || a.includes('печать')) return 'stamp';
  if (a.includes('signature') || a.includes('подпись')) return 'signature';
  if (a.includes('watermark') || a.includes('водяной')) return 'watermark';
  if (a.includes('electronic') || a.includes('электронн')) return 'electronic_approval';
  return 'unknown_image';
}

// Strip base64 payload from data URIs, return only the protocol prefix
function safeAlt(alt: string, src: string): string {
  if (src.startsWith('data:')) {
    // Keep only the media type part, not the base64 payload
    const mediaType = src.slice(5, src.indexOf(';'));
    return alt || `[image: ${mediaType}]`;
  }
  return alt;
}

// MRZ line: 30+ chars of A-Z, 0-9, < and optionally space
const MRZ_LINE_RE = /^[A-Z0-9<]{30,}$/;

function isMrzLine(line: string): boolean {
  return MRZ_LINE_RE.test(line.trim());
}

function hasMrzBlock(text: string): boolean {
  const lines = text.split('\n');
  let consecutive = 0;
  for (const line of lines) {
    if (isMrzLine(line)) {
      consecutive++;
      if (consecutive >= 2) return true;
    } else {
      consecutive = 0;
    }
  }
  return false;
}

function getMrzText(text: string): string {
  const lines = text.split('\n');
  const mrzLines: string[] = [];
  let consecutive = 0;
  for (const line of lines) {
    if (isMrzLine(line)) {
      consecutive++;
      mrzLines.push(line.trim());
    } else {
      if (consecutive >= 2) break;
      consecutive = 0;
      mrzLines.length = 0;
    }
  }
  return mrzLines.join('\n');
}

// Bracket marker pattern
const BRACKET_MARKER_RE = /\[([^\]]{1,120})\]/gi;

interface BracketMatch {
  fullMatch: string;
  content: string;
}

function extractBracketMatches(text: string): BracketMatch[] {
  const matches: BracketMatch[] = [];
  let m: RegExpExecArray | null;
  const re = /\[([^\]]{1,120})\]/gi;
  while ((m = re.exec(text)) !== null) {
    matches.push({ fullMatch: m[0], content: m[1] ?? '' });
  }
  return matches;
}

function bracketKind(content: string): VisualElementKind | null {
  const c = content.toLowerCase();
  if (c.startsWith('qr') || c.includes('qr-код') || c === 'qr code present') return 'qr';
  if (c.startsWith('barcode') || c.includes('штрих-код') || c.includes('штрих')) return 'barcode';
  if (c.includes('stamp') || c.includes('печать') || c.includes('round stamp') || c.includes('круглая печать') || c.includes('bank stamp') || c.includes('банковская печать') || c.includes('institution stamp')) return 'stamp';
  if (c.includes('signature') || c.includes('подпись')) return 'signature';
  if (c.includes('watermark') || c.includes('водяной знак')) return 'watermark';
  if (c.startsWith('logo') || c.includes('логотип')) return 'logo';
  if (c.includes('emblem') || c.includes('герб') || c.includes('coat of arms')) return 'emblem';
  if (c.startsWith('photo') || c.includes('фото') || c.includes('holder photo') || c.includes('applicant photo') || c.includes('фотография')) return 'photo';
  if (c.includes('electronic') || c.includes('электронн')) return 'electronic_approval';
  return null;
}

export function extractVisualElementsFromOcr(
  ocrMarkdown: string,
  pageMarkdowns?: string[],
): VisualElement[] {
  const elements: VisualElement[] = [];

  // Process per-page for image extraction with page numbers
  const pages = pageMarkdowns && pageMarkdowns.length > 0 ? pageMarkdowns : [ocrMarkdown];
  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const pageText = pages[pageIdx] ?? '';
    const pageNum = pageMarkdowns && pageMarkdowns.length > 0 ? pageIdx + 1 : undefined;

    // Extract markdown images ![alt](src)
    const imgRe = /!\[([^\]]*)\]\(([^)]*)\)/g;
    let imgMatch: RegExpExecArray | null;
    while ((imgMatch = imgRe.exec(pageText)) !== null) {
      const alt = imgMatch[1] ?? '';
      const src = imgMatch[2] ?? '';
      const kind = kindFromAlt(alt);
      elements.push({
        page: pageNum,
        kind,
        text: safeAlt(alt, src),
        source: 'mistral_ocr',
      });
    }

    // Extract bracket markers
    const bracketMatches = extractBracketMatches(pageText);
    for (const { content } of bracketMatches) {
      const kind = bracketKind(content);
      if (kind) {
        elements.push({
          page: pageNum,
          kind,
          text: `[${content}]`,
          source: 'markdown_marker',
        });
      }
    }
  }

  // Full text scans (on joined markdown)
  // Verification URLs
  const urlRe = /https?:\/\/[^\s<>\[\]"]{10,}/g;
  let urlMatch: RegExpExecArray | null;
  while ((urlMatch = urlRe.exec(ocrMarkdown)) !== null) {
    elements.push({
      kind: 'verification_string',
      text: urlMatch[0],
      source: 'regex',
    });
  }
  // www. URLs
  const wwwRe = /www\.[^\s<>\[\]"]{5,}/g;
  let wwwMatch: RegExpExecArray | null;
  while ((wwwMatch = wwwRe.exec(ocrMarkdown)) !== null) {
    elements.push({
      kind: 'verification_string',
      text: wwwMatch[0],
      source: 'regex',
    });
  }

  // MRZ detection
  if (hasMrzBlock(ocrMarkdown)) {
    elements.push({
      kind: 'mrz',
      text: getMrzText(ocrMarkdown),
      source: 'regex',
    });
  }

  return deduplicateElements(elements);
}

export function extractVisualElementsFromTranslated(translatedMarkdown: string): VisualElement[] {
  const elements: VisualElement[] = [];
  const bracketMatches = extractBracketMatches(translatedMarkdown);
  for (const { content } of bracketMatches) {
    const kind = bracketKind(content);
    if (kind) {
      elements.push({
        kind,
        text: `[${content}]`,
        source: 'markdown_marker',
      });
    }
  }
  return deduplicateElements(elements);
}

export function mergeVisualElements(a: VisualElement[], b: VisualElement[]): VisualElement[] {
  return deduplicateElements([...a, ...b]);
}

function deduplicateElements(elements: VisualElement[]): VisualElement[] {
  const seen = new Set<string>();
  return elements.filter((el) => {
    const key = `${el.kind}:${el.text ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Re-export BRACKET_MARKER_RE for use in other modules
export { BRACKET_MARKER_RE };
