/**
 * Worker-local copy of visual element types and extraction functions.
 * Keep in sync with src/lib/translation-workflow/visual-elements.ts.
 */

// ---- Types (mirrored from src/lib/translation-workflow/types.ts) ----

export type VisualElementKind =
  | 'logo'
  | 'emblem'
  | 'photo'
  | 'qr'
  | 'barcode'
  | 'stamp'
  | 'signature'
  | 'watermark'
  | 'verification_string'
  | 'mrz'
  | 'handwritten_note'
  | 'electronic_approval'
  | 'accreditation_mark'
  | 'certification_mark'
  | 'label'
  | 'unknown_image';

export type VisualPosition =
  | 'upper_left' | 'upper_center' | 'upper_right'
  | 'center_left' | 'center' | 'center_right'
  | 'lower_left' | 'lower_center' | 'lower_right'
  | 'full_page';

export interface VisualElement {
  page?: number;
  kind: VisualElementKind;
  text?: string;
  description?: string;
  position?: string;
  confidence?: number;
  source: 'mistral_ocr' | 'markdown_marker' | 'regex' | 'pdf_image_extraction' | 'manual';
}

// ---- Extraction logic ----

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

function safeAlt(alt: string, src: string): string {
  if (src.startsWith('data:')) {
    const mediaType = src.slice(5, src.indexOf(';'));
    return alt || `[image: ${mediaType}]`;
  }
  return alt;
}

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

interface BracketMatch {
  content: string;
}

function extractBracketMatches(text: string): BracketMatch[] {
  const matches: BracketMatch[] = [];
  let m: RegExpExecArray | null;
  const re = /\[([^\]]{1,120})\]/gi;
  while ((m = re.exec(text)) !== null) {
    matches.push({ content: m[1] ?? '' });
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

function deduplicateElements(elements: VisualElement[]): VisualElement[] {
  const seen = new Set<string>();
  return elements.filter((el) => {
    const key = `${el.kind}:${el.text ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function extractVisualElementsFromOcr(
  ocrMarkdown: string,
  pageMarkdowns?: string[],
): VisualElement[] {
  const elements: VisualElement[] = [];

  const pages = pageMarkdowns && pageMarkdowns.length > 0 ? pageMarkdowns : [ocrMarkdown];
  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const pageText = pages[pageIdx] ?? '';
    const pageNum = pageMarkdowns && pageMarkdowns.length > 0 ? pageIdx + 1 : undefined;

    // Extract markdown images
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

// ---- Visual elements block builder (mirrored from visual-elements-block.ts) ----

type DisplayLang = 'ru' | 'en';

function displayLang(targetLang: string): DisplayLang {
  return targetLang === 'ru' ? 'ru' : 'en';
}

const KIND_LABEL_RU: Record<VisualElementKind, string> = {
  logo: 'Логотип',
  emblem: 'Герб/эмблема',
  photo: 'Фотография',
  qr: 'QR-код',
  barcode: 'Штрих-код',
  stamp: 'Печать',
  signature: 'Подпись',
  watermark: 'Водяной знак',
  verification_string: 'Строка проверки',
  mrz: 'Машиночитаемая зона (MRZ)',
  handwritten_note: 'Рукописная пометка',
  electronic_approval: 'Электронное утверждение',
  accreditation_mark: 'Знак аккредитации',
  certification_mark: 'Знак сертификации',
  label: 'Этикетка',
  unknown_image: 'Изображение',
};

const KIND_LABEL_EN: Record<VisualElementKind, string> = {
  logo: 'Logo',
  emblem: 'Emblem/Coat of arms',
  photo: 'Photo',
  qr: 'QR code',
  barcode: 'Barcode',
  stamp: 'Stamp/Seal',
  signature: 'Signature',
  watermark: 'Watermark',
  verification_string: 'Verification string',
  mrz: 'Machine-readable zone (MRZ)',
  handwritten_note: 'Handwritten note',
  electronic_approval: 'Electronic approval',
  accreditation_mark: 'Accreditation mark',
  certification_mark: 'Certification mark',
  label: 'Label',
  unknown_image: 'Image',
};

function kindLabel(kind: VisualElementKind, lang: DisplayLang): string {
  return lang === 'ru' ? KIND_LABEL_RU[kind] : KIND_LABEL_EN[kind];
}

export function buildVisualElementsBlock(elements: VisualElement[], targetLang: string): string {
  const lang = displayLang(targetLang);

  const heading =
    lang === 'ru'
      ? '## Описание нетекстовых элементов оригинала'
      : '## Description of non-text elements in the original';

  if (elements.length === 0) {
    const empty =
      lang === 'ru'
        ? 'Нет явно распознанных нетекстовых элементов.'
        : 'No clearly identified non-text elements.';
    return `${heading}\n\n${empty}`;
  }

  let table: string;
  if (lang === 'ru') {
    table = '| Страница оригинала | Элемент | Расположение | Передача в переводе |\n';
    table += '|---|---|---|---|\n';
    for (const el of elements) {
      const page = el.page != null ? String(el.page) : '—';
      const element = kindLabel(el.kind, 'ru');
      const position = el.position ?? '—';
      const representation = el.text ?? '—';
      table += `| ${page} | ${element} | ${position} | ${representation} |\n`;
    }
  } else {
    table = '| Page | Element | Position | Representation in translation |\n';
    table += '|---|---|---|---|\n';
    for (const el of elements) {
      const page = el.page != null ? String(el.page) : '—';
      const element = kindLabel(el.kind, 'en');
      const position = el.position ?? '—';
      const representation = el.text ?? '—';
      table += `| ${page} | ${element} | ${position} | ${representation} |\n`;
    }
  }

  return `${heading}\n\n${table}`;
}

const VISUAL_ELEMENTS_HEADING_PATTERNS = [
  /описание нетекстовых элементов/i,
  /description of non-text elements/i,
  /нетекстовые элементы/i,
  /visual elements/i,
];

export function ensureVisualElementsBlock(
  translatedMarkdown: string,
  elements: VisualElement[],
  targetLang: string,
): string {
  for (const pattern of VISUAL_ELEMENTS_HEADING_PATTERNS) {
    if (pattern.test(translatedMarkdown)) {
      return translatedMarkdown;
    }
  }
  const block = buildVisualElementsBlock(elements, targetLang);
  return `${translatedMarkdown.trimEnd()}\n\n${block}`;
}
