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
  // QR — universal abbreviation used in all language markers
  if (c.includes('qr') || c.includes('qr-код')) return 'qr';
  // Barcode
  if (c.startsWith('barcode') || c.includes('штрих-код') || c.includes('штрих') ||
      c.includes('barra') || c.includes('strichcode') || c.includes('code-barres')) return 'barcode';
  // Stamp / Seal — multilingual keywords
  if (c.includes('stamp') || c.includes('seal') || c.includes('печать') ||
      c.includes('timbro') || c.includes('cachet') || c.includes('tampon') ||
      c.includes('sello') || c.includes('stempel') || c.includes('siegel') ||
      c.includes('мөр') || c.includes('muhr') || c.includes('mühür') ||
      c.includes('damga') || c.includes('ختم') || c.includes('طابع') ||
      c.includes('印章') || c.includes('도장') || c.includes('인감') ||
      c.includes('印鑑') || c.includes('ตราประทับ')) return 'stamp';
  // Signature — multilingual keywords
  if (c.includes('signature') || c.includes('подпись') || c.includes('firma') ||
      c.includes('unterschrift') || c.includes('imza') || c.includes('imzo') ||
      c.includes('توقيع') || c.includes('қолтаңба') || c.includes('署名') ||
      c.includes('서명') || c.includes('ลายมือชื่อ') || c.includes('手書き') ||
      c.includes('手写签名')) return 'signature';
  // Watermark — multilingual keywords
  if (c.includes('watermark') || c.includes('водяной знак') || c.includes('filigrana') ||
      c.includes('filigrane') || c.includes('filigran') || c.includes('wasserzeichen') ||
      c.includes('marca de agua') || c.includes('علامة مائية') || c.includes('su belgisi') ||
      c.includes('水印') || c.includes('워터마크') || c.includes('透かし') ||
      c.includes('ลายน้ำ')) return 'watermark';
  // Logo — multilingual (most use 'logo' prefix; add CJK/Arabic variants)
  if (c.startsWith('logo') || c.includes('логотип') || c.includes('로고') ||
      c.includes('ロゴ') || c.includes('标志') || c.includes('شعار')) return 'logo';
  // Emblem
  if (c.includes('emblem') || c.includes('герб') || c.includes('coat of arms') ||
      c.includes('emblema') || c.includes('emblème') || c.includes('wappen') ||
      c.includes('紋章')) return 'emblem';
  // Photo
  if (c.startsWith('photo') || c.includes('фото') || c.includes('holder photo') ||
      c.includes('applicant photo') || c.includes('фотография') || c.includes('foto') ||
      c.includes('fotografia') || c.includes('fotografía') || c.includes('fotoğraf') ||
      c.includes('写真') || c.includes('사진') || c.includes('照片') ||
      c.includes('รูปถ่าย') || c.includes('صورة') || c.includes('фотосурет')) return 'photo';
  // Electronic approval
  if (c.includes('electronic') || c.includes('электронн') || c.includes('elektronisch') ||
      c.includes('électronique') || c.includes('electrónic') || c.includes('電子')) return 'electronic_approval';
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

/**
 * Remove verification_string elements that were found via URL regex (plain printed text).
 * Such strings appear in the document body as website addresses, not as visual elements.
 * QR code content is captured separately as kind:'qr' via bracket markers.
 */
export function filterPrintedVerificationStrings(elements: VisualElement[]): VisualElement[] {
  return elements.filter(
    (el) => !(el.kind === 'verification_string' && el.source === 'regex'),
  );
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
