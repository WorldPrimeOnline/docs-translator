import type { VisualElement, VisualElementKind } from './types';

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
