import type { DetectedVisualElement } from './detected-visual-element';

// Token format: __WPO_VIS_0001__
function makeVisToken(index: number): string {
  return `__WPO_VIS_${String(index).padStart(4, '0')}__`;
}

const VIS_TOKEN_RE = /__WPO_VIS_\d{4}__/g;

export interface InventoryEntry {
  token: string;
  kind: string;
  page: number;
  position: string;
  description: string;
  visibleText?: string;
  element: DetectedVisualElement;
}

export interface ParsedInventoryEntry {
  token: string;
  kind: string;
  page: number;
  position: string;
  description: string;
  visibleText?: string;
}

/**
 * Build a concise base description for an element.
 * Uses visibleText to enrich descriptions for watermarks and stamps.
 * QR/barcode visibleText is withheld from Claude (protected identifier).
 */
function buildSourceDescription(el: DetectedVisualElement): string {
  const base = el.description ?? '';

  // For watermarks: append visibleText as a quoted value so Claude can translate it
  if (el.kind === 'watermark' && el.visibleText) {
    const text = el.visibleText.trim();
    if (text && !base.toLowerCase().includes(text.toLowerCase())) {
      return (base ? `${base} ` : 'Watermark') + `with text: "${text}"`;
    }
    return base || `Watermark with text: "${el.visibleText}"`;
  }

  // For stamps: append visibleText when present and description doesn't already contain it
  if (el.kind === 'stamp' && el.visibleText) {
    const text = el.visibleText.trim();
    if (text && !base.toLowerCase().includes(text.toLowerCase())) {
      return (base ? `${base} ` : 'Round company stamp') + `with text: "${text}"`;
    }
    return base || `Round company stamp with text: "${el.visibleText}"`;
  }

  return base;
}

/**
 * Serialize detected visual elements into a protected Markdown block.
 * The block is prepended to the document before translation.
 * Claude is asked to translate description= values and preserve __WPO_VIS_NNNN__ tokens.
 * visibleText= is present in the line but marked as [preserve exactly].
 */
export function serializeVisualInventory(
  elements: DetectedVisualElement[],
  targetLanguage: string,
): { inventoryBlock: string; entries: InventoryEntry[] } {
  if (elements.length === 0) return { inventoryBlock: '', entries: [] };

  const entries: InventoryEntry[] = elements.map((el, i) => ({
    token: makeVisToken(i + 1),
    kind: el.kind,
    page: el.page,
    position: el.position,
    description: buildSourceDescription(el),
    visibleText: (el.kind !== 'qr' && el.kind !== 'barcode') ? el.visibleText : undefined,
    element: el,
  }));

  const lines: string[] = [
    '<!-- WPO_VISUAL_BLOCK_START -->',
    '## VISUAL ELEMENTS OF THE SOURCE DOCUMENT',
    '',
    `Translate the description= values to ${targetLanguage}. Preserve all __WPO_VIS_NNNN__ tokens exactly. Do not remove any token occurrence.`,
    '',
  ];

  for (const entry of entries) {
    const descPart = entry.description ? `; description=${entry.description}` : '';
    // visibleText is included so Claude can translate descriptions that reference it,
    // but Claude must NOT translate the visibleText= value itself (it is original text from document).
    const visPart = entry.visibleText ? `; visibleText=${entry.visibleText}` : '';
    lines.push(`- ${entry.token}: kind=${entry.kind}; page=${entry.page}; position=${entry.position}${descPart}${visPart}`);
  }

  lines.push('', '---', '');

  return { inventoryBlock: lines.join('\n'), entries };
}

/**
 * Find and remove the visual inventory block from translated markdown.
 * Parses __WPO_VIS_NNNN__ entries, extracts translated descriptions,
 * restores missing tokens from source entries.
 */
export function parseAndRemoveInventoryBlock(
  translatedMarkdown: string,
  sourceEntries: InventoryEntry[],
): {
  parsedEntries: ParsedInventoryEntry[];
  cleanedMarkdown: string;
  missingTokens: string[];
} {
  const lines = translatedMarkdown.split('\n');

  // Regex to parse inventory lines:
  // - __WPO_VIS_0001__: kind=logo; page=1; position=header[; description=...][; visibleText=...]
  const ENTRY_LINE_RE =
    /^-\s*(__WPO_VIS_\d{4}__):\s*kind=([^;]+);\s*page=(\d+);\s*position=([^;]+?)(?:;\s*description=([^;]*))?(?:;\s*visibleText=(.*))?$/;

  const inventoryLineIndices = new Set<number>();
  const parsedEntries: ParsedInventoryEntry[] = [];

  // Find block boundaries
  let blockStart = -1;
  let blockEnd = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    if (line.includes('WPO_VISUAL_BLOCK_START') || line.includes('VISUAL ELEMENTS OF THE SOURCE DOCUMENT')) {
      if (blockStart < 0) blockStart = i;
    }

    if (VIS_TOKEN_RE.test(line)) {
      VIS_TOKEN_RE.lastIndex = 0;
      inventoryLineIndices.add(i);
      const m = ENTRY_LINE_RE.exec(line.trim());
      if (m) {
        parsedEntries.push({
          token: m[1]!,
          kind: m[2]!.trim(),
          page: parseInt(m[3]!, 10),
          position: m[4]!.trim(),
          description: m[5]?.trim() ?? '',
          visibleText: m[6]?.trim() || undefined,
        });
      }
    }

    // Detect closing '---' after inventory lines
    if (blockStart >= 0 && blockEnd < 0 && inventoryLineIndices.size > 0 && line.trim() === '---' && i > blockStart) {
      blockEnd = i;
    }
  }

  // Identify missing tokens
  const foundTokens = new Set(parsedEntries.map(e => e.token));
  const missingTokens = sourceEntries.map(e => e.token).filter(t => !foundTokens.has(t));

  // Restore missing entries from source (with original descriptions and visibleText as fallback)
  for (const src of sourceEntries) {
    if (!foundTokens.has(src.token)) {
      parsedEntries.push({
        token: src.token,
        kind: src.kind,
        page: src.page,
        position: src.position,
        description: src.description,
        visibleText: src.visibleText,
      });
    }
  }

  // Sort by token number
  parsedEntries.sort((a, b) => {
    const numA = parseInt(a.token.replace(/\D/g, ''), 10);
    const numB = parseInt(b.token.replace(/\D/g, ''), 10);
    return numA - numB;
  });

  // Build set of lines to remove (inventory block range + stray VIS token lines)
  const removeIndices = new Set<number>();
  if (blockStart >= 0) {
    const end = blockEnd >= 0 ? blockEnd : blockStart + sourceEntries.length + 6;
    for (let i = blockStart; i <= Math.min(end, lines.length - 1); i++) {
      removeIndices.add(i);
    }
  }
  for (const idx of inventoryLineIndices) {
    removeIndices.add(idx);
  }

  const cleanedMarkdown = lines
    .filter((_, i) => !removeIndices.has(i))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { parsedEntries, cleanedMarkdown, missingTokens };
}

// ─── Multi-locale static labels ──────────────────────────────────────────────

const VISUAL_BLOCK_HEADING: Record<string, string> = {
  en: 'Description of non-text elements in the original document',
  ru: 'Описание нетекстовых элементов оригинального документа',
  kk: 'Бастапқы құжаттың бейтекстік элементтерінің сипаттамасы',
  zh: '原始文件中非文本元素的说明',
  ko: '원본 문서의 비텍스트 요소 설명',
  es: 'Descripción de elementos no textuales del documento original',
};

const VISUAL_BLOCK_COLUMNS: Record<string, [string, string, string, string]> = {
  en: ['Source page', 'Element', 'Position', 'Representation in translation'],
  ru: ['Страница оригинала', 'Элемент', 'Расположение', 'Передача в переводе'],
  kk: ['Бастапқы бет', 'Элемент', 'Орналасуы', 'Аудармадағы берілуі'],
  zh: ['原页', '元素', '位置', '译文中的表示'],
  ko: ['원본 페이지', '요소', '위치', '번역에서의 표현'],
  es: ['Página original', 'Elemento', 'Posición', 'Representación en la traducción'],
};

const KIND_LABELS: Record<string, Record<string, string>> = {
  en: {
    logo: 'Logo', emblem: 'Emblem/Coat of arms', photo: 'Photo', qr: 'QR code',
    barcode: 'Barcode', stamp: 'Stamp/Seal', signature: 'Signature', watermark: 'Watermark',
    handwritten_note: 'Handwritten note', electronic_approval: 'Electronic approval', unknown_image: 'Image',
  },
  ru: {
    logo: 'Логотип', emblem: 'Герб/Эмблема', photo: 'Фотография', qr: 'QR-код',
    barcode: 'Штрих-код', stamp: 'Печать', signature: 'Подпись', watermark: 'Водяной знак',
    handwritten_note: 'Рукописная пометка', electronic_approval: 'Электронное утверждение', unknown_image: 'Изображение',
  },
  kk: {
    logo: 'Логотип', emblem: 'Герб/Эмблема', photo: 'Фотосурет', qr: 'QR-код',
    barcode: 'Штрих-код', stamp: 'Мөр', signature: 'Қол қою', watermark: 'Су таңбасы',
    handwritten_note: 'Қолмен жазылған ескерту', electronic_approval: 'Электронды бекіту', unknown_image: 'Сурет',
  },
  zh: {
    logo: '标志', emblem: '徽章/国徽', photo: '照片', qr: '二维码',
    barcode: '条形码', stamp: '印章', signature: '签名', watermark: '水印',
    handwritten_note: '手写注释', electronic_approval: '电子批准', unknown_image: '图像',
  },
  ko: {
    logo: '로고', emblem: '문장/국장', photo: '사진', qr: 'QR 코드',
    barcode: '바코드', stamp: '인장', signature: '서명', watermark: '워터마크',
    handwritten_note: '필기 메모', electronic_approval: '전자 승인', unknown_image: '이미지',
  },
  es: {
    logo: 'Logotipo', emblem: 'Emblema/Escudo', photo: 'Fotografía', qr: 'Código QR',
    barcode: 'Código de barras', stamp: 'Sello', signature: 'Firma', watermark: 'Marca de agua',
    handwritten_note: 'Nota manuscrita', electronic_approval: 'Aprobación electrónica', unknown_image: 'Imagen',
  },
};

function kindLabelForLocale(kind: string, locale: string): string {
  return KIND_LABELS[locale]?.[kind] ?? KIND_LABELS['en']?.[kind] ?? kind;
}

// Compact per-kind description fallbacks (English base; other locales use translated description from Claude)
const COMPACT_FALLBACKS: Partial<Record<string, string>> = {
  logo: 'Company logo',
  stamp: 'Round company stamp',
  signature: 'Handwritten signature',
  qr: 'QR code for document verification',
  emblem: 'Official emblem',
  photo: 'Document photo',
  barcode: 'Barcode',
  watermark: 'Watermark',
  handwritten_note: 'Handwritten note',
  electronic_approval: 'Electronic approval mark',
  unknown_image: 'Image',
};

const MAX_DESCRIPTION_LENGTH = 50;

/**
 * Return a compact description for the final visual block table.
 * Truncates verbose descriptions to a kind-appropriate short form.
 */
function compactDescription(entry: ParsedInventoryEntry): string {
  const desc = entry.description?.trim() ?? '';

  // If short enough, use as-is
  if (desc.length > 0 && desc.length <= MAX_DESCRIPTION_LENGTH) return desc;

  // Watermarks: try to preserve the "with text: X" pattern
  if (entry.kind === 'watermark') {
    // Match quoted text pattern from either description or visibleText
    const quoted = /"([^"]{1,40})"/.exec(desc) ?? /"([^"]{1,40})"/.exec(entry.visibleText ?? '');
    if (quoted) return `Watermark: "${quoted[1]}"`;
    if (entry.visibleText) return `Watermark: "${entry.visibleText}"`;
    return 'Watermark';
  }

  // Stamps: try to preserve text if available
  if (entry.kind === 'stamp') {
    if (entry.visibleText && entry.visibleText.length <= 40) {
      return `Stamp: "${entry.visibleText}"`;
    }
    return 'Round company stamp';
  }

  // Other kinds: use compact fallback
  return COMPACT_FALLBACKS[entry.kind] ?? (desc.length > 0 ? desc.slice(0, MAX_DESCRIPTION_LENGTH) + '…' : '—');
}

/**
 * Build the final visual-elements block from parsed inventory entries.
 * Uses static multi-locale labels and compact descriptions.
 * The block heading includes <!-- WPO_VISUAL_BLOCK_START --> so ensureVisualElementsBlock
 * recognises it as already present.
 */
export function buildFinalVisualBlock(
  parsedEntries: ParsedInventoryEntry[],
  targetLanguage: string,
): string {
  if (parsedEntries.length === 0) return '';

  const heading = VISUAL_BLOCK_HEADING[targetLanguage] ?? VISUAL_BLOCK_HEADING['en']!;
  const cols = VISUAL_BLOCK_COLUMNS[targetLanguage] ?? VISUAL_BLOCK_COLUMNS['en']!;

  let block = `<!-- WPO_VISUAL_BLOCK_START -->\n## ${heading}\n\n`;
  block += `| ${cols[0]} | ${cols[1]} | ${cols[2]} | ${cols[3]} |\n`;
  block += `|---|---|---|---|\n`;

  for (const entry of parsedEntries) {
    const kindLabel = kindLabelForLocale(entry.kind, targetLanguage);
    const desc = compactDescription(entry);
    block += `| ${entry.page} | ${kindLabel} | ${entry.position} | ${desc} |\n`;
  }

  return block;
}
