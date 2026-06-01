import { marked } from 'marked';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

type ServiceLevel =
  | 'electronic'
  | 'official_with_translator_signature_and_provider_stamp'
  | 'notarization_through_partners';

export interface RenderMeta {
  sourceLang: string;
  targetLang: string;
  documentType: string;
  translatedAt: string;
  serviceLevel?: ServiceLevel;
}

// Leave empty — filled in by the business when IIN/BIN is assigned.
const PROVIDER_IIN_BIN = '';

const LANG_SRC: Record<string, { en: string; ru: string }> = {
  en: { en: 'English', ru: 'английского' },
  ru: { en: 'Russian', ru: 'русского' },
  zh: { en: 'Chinese', ru: 'китайского' },
  ko: { en: 'Korean', ru: 'корейского' },
  kk: { en: 'Kazakh', ru: 'казахского' },
  tj: { en: 'Tajik', ru: 'таджикского' },
  uz: { en: 'Uzbek', ru: 'узбекского' },
  tk: { en: 'Turkmen', ru: 'туркменского' },
  mn: { en: 'Mongolian', ru: 'монгольского' },
  ky: { en: 'Kyrgyz', ru: 'кыргызского' },
  es: { en: 'Spanish', ru: 'испанского' },
  th: { en: 'Thai', ru: 'тайского' },
  auto: { en: 'source language', ru: 'исходного языка' },
};

const LANG_TGT: Record<string, { en: string; ru: string }> = {
  en: { en: 'English', ru: 'английский' },
  ru: { en: 'Russian', ru: 'русский' },
  zh: { en: 'Chinese', ru: 'китайский' },
  ko: { en: 'Korean', ru: 'корейский' },
  kk: { en: 'Kazakh', ru: 'казахский' },
  tj: { en: 'Tajik', ru: 'таджикский' },
  uz: { en: 'Uzbek', ru: 'узбекский' },
  tk: { en: 'Turkmen', ru: 'туркменский' },
  mn: { en: 'Mongolian', ru: 'монгольский' },
  ky: { en: 'Kyrgyz', ru: 'кыргызский' },
  es: { en: 'Spanish', ru: 'испанский' },
  th: { en: 'Thai', ru: 'тайский' },
};

const DOC_TYPE_LABEL: Record<string, { en: string; ru: string }> = {
  passport_id: { en: 'Passport / ID Card', ru: 'Паспорт / Удостоверение личности' },
  diploma_transcript: { en: 'Diploma / Transcript', ru: 'Диплом / Транскрипт' },
  contract: { en: 'Contract', ru: 'Договор' },
  bank_statement: { en: 'Bank Statement', ru: 'Банковская выписка' },
  medical_document: { en: 'Medical Document', ru: 'Медицинский документ' },
  employment_document: { en: 'Employment Document', ru: 'Трудовой документ' },
  police_clearance: { en: 'Police Clearance Certificate', ru: 'Справка о несудимости' },
  visa_documents: { en: 'Visa / Immigration Documents', ru: 'Виза / Иммиграционные документы' },
  driver_license: { en: "Driver's License", ru: 'Водительское удостоверение' },
  other: { en: 'Official Document', ru: 'Официальный документ' },
};

type DisplayLang = 'en' | 'ru';
function dl(targetLang: string): DisplayLang { return targetLang === 'ru' ? 'ru' : 'en'; }

function translationHeader(meta: RenderMeta): string {
  const d = dl(meta.targetLang);
  const src = LANG_SRC[meta.sourceLang]?.[d] ?? meta.sourceLang.toUpperCase();
  const tgt = LANG_TGT[meta.targetLang]?.[d] ?? meta.targetLang.toUpperCase();
  return d === 'ru'
    ? `ПЕРЕВОД С ${src.toUpperCase()} НА ${tgt.toUpperCase()} ЯЗЫК`
    : `TRANSLATION FROM ${src.toUpperCase()} INTO ${tgt.toUpperCase()}`;
}

function docTypeLabel(meta: RenderMeta): string {
  const d = dl(meta.targetLang);
  return DOC_TYPE_LABEL[meta.documentType]?.[d] ?? meta.documentType;
}

function originalCopyNote(meta: RenderMeta): string {
  return meta.targetLang === 'ru'
    ? 'Перевод выполнен с предоставленной электронной копии документа.'
    : 'The translation was prepared based on the provided electronic copy of the document.';
}

function certificationRows(meta: RenderMeta): Array<[string, string]> {
  const d = dl(meta.targetLang);
  const src = LANG_SRC[meta.sourceLang]?.[d] ?? meta.sourceLang;
  const tgt = LANG_TGT[meta.targetLang]?.[d] ?? meta.targetLang;
  const iinBin = PROVIDER_IIN_BIN || '______________________';
  if (d === 'ru') {
    return [
      [`Перевод выполнен с ${src} на ${tgt} язык.`, ''],
      ['Переводчик:', '______________________'],
      ['Квалификация переводчика:', '______________________'],
      ['Подпись переводчика:', '______________________'],
      ['Исполнитель:', 'World Prime Online'],
      ['ИИН/БИН:', iinBin],
      ['Печать Исполнителя:', '______________________'],
      ['Дата:', '______________________'],
    ];
  }
  return [
    [`Translation performed from ${src} into ${tgt}.`, ''],
    ['Translator:', '______________________'],
    ['Translator qualification:', '______________________'],
    ['Translator signature:', '______________________'],
    ['Provider:', 'World Prime Online'],
    ['IIN/BIN:', iinBin],
    ["Provider's stamp:", '______________________'],
    ['Date:', '______________________'],
  ];
}

function notarizationNote(meta: RenderMeta): string {
  return meta.targetLang === 'ru'
    ? 'Нотариальное удостоверение подписи переводчика оформляется отдельно при наличии партнёрского процесса.'
    : "Notarization of the translator's signature is arranged separately where a partner process is available.";
}

function cleanMarkdown(md: string): string {
  return md.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\n{3,}/g, '\n\n');
}

function wrapMarkers(html: string): string {
  return html.replace(/\[([^\]]{1,80})\]/g, '<mark class="marker">[$1]</mark>');
}

function buildCertificationBlockHtml(meta: RenderMeta): string {
  const title = meta.targetLang === 'ru' ? 'СВЕДЕНИЯ О ПЕРЕВОДЧИКЕ И ИСПОЛНИТЕЛЕ' : 'TRANSLATOR AND PROVIDER DETAILS';
  const rows = certificationRows(meta);
  const rowsHtml = rows.map(([label, value]) =>
    value
      ? `<tr><td class="cert-label">${label}</td><td class="cert-value">${value}</td></tr>`
      : `<tr><td colspan="2" class="cert-full">${label}</td></tr>`,
  ).join('\n');
  return `<div class="certification-block">
  <div class="cert-title">${title}</div>
  <table class="cert-table"><tbody>${rowsHtml}</tbody></table>
</div>`;
}

const BUREAU_CSS = `
  .bureau-header { margin-bottom: 28px; padding-bottom: 14px; border-bottom: 2px solid #222; }
  .translation-title { font-size: 13pt; font-weight: 700; letter-spacing: 0.05em; margin-bottom: 4px; }
  .doc-type-label { font-size: 10pt; color: #444; margin-bottom: 8px; }
  .original-note { font-size: 9pt; color: #666; font-style: italic; }
  mark.marker { background: #f0f0f0; color: #444; font-family: monospace; font-style: italic; border-radius: 3px; padding: 1px 4px; font-size: 0.9em; }
  .certification-block { margin-top: 40px; padding-top: 16px; border-top: 2px solid #222; }
  .cert-title { font-size: 11pt; font-weight: 700; margin-bottom: 12px; letter-spacing: 0.03em; }
  .cert-table { border-collapse: collapse; width: 100%; }
  .cert-table td { padding: 5px 8px; border: 1px solid #bbb; font-size: 10pt; vertical-align: top; }
  .cert-label { width: 45%; font-weight: 600; background: #f9f9f9; }
  .cert-value { width: 55%; }
  .cert-full { font-style: italic; }
  .notarization-note { margin-top: 16px; font-size: 9pt; color: #555; font-style: italic; border-left: 3px solid #bbb; padding-left: 10px; }
  .system-meta { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 8pt; color: #aaa; text-align: center; margin-bottom: 20px; padding-bottom: 8px; border-bottom: 1px solid #e8e8e8; }
`;

/** Produces an HTML buffer from the translated markdown. */
export async function renderToPdf(
  translatedMarkdown: string,
  meta: RenderMeta,
): Promise<Buffer> {
  const isPresentation = meta.documentType === 'presentation';
  const rawBody = await marked.parse(cleanMarkdown(translatedMarkdown));
  const body = wrapMarkers(rawBody);

  const sl = meta.serviceLevel ?? 'electronic';
  const showCert = !isPresentation && (sl === 'official_with_translator_signature_and_provider_stamp' || sl === 'notarization_through_partners');
  const showNotarNote = !isPresentation && sl === 'notarization_through_partners';

  const bureauHeaderHtml = isPresentation ? '' : `
  <div class="bureau-header">
    <div class="translation-title">${translationHeader(meta)}</div>
    <div class="doc-type-label">${docTypeLabel(meta)}</div>
    <div class="original-note">${originalCopyNote(meta)}</div>
  </div>`;

  const certHtml = showCert ? buildCertificationBlockHtml(meta) : '';
  const notarHtml = showNotarNote ? `<div class="notarization-note">${notarizationNote(meta)}</div>` : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Translation — ${meta.sourceLang} → ${meta.targetLang}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: A4; margin: 20mm 15mm; }
  body {
    font-family: "Times New Roman", Times, serif;
    font-size: 11pt;
    line-height: 1.7;
    color: #111;
    max-width: 780px;
    margin: 0 auto;
    padding: 24px 40px;
  }
  img { display: none; }
  .content { padding: 4mm 0; }
  h1 { font-size: 14pt; margin: 18px 0 10px; text-transform: uppercase; letter-spacing: 0.03em; }
  h2 { font-size: 12pt; margin: 16px 0 8px; }
  h3 { font-size: 11pt; margin: 12px 0 6px; }
  p { margin: 5px 0; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; }
  th, td { border: 1px solid #bbb; padding: 5px 10px; text-align: left; vertical-align: top; }
  th { background: #f5f5f5; font-weight: 600; width: 40%; }
  td { width: 60%; }
  ul, ol { margin: 6px 0 6px 22px; }
  li { margin: 3px 0; }
  strong { font-weight: 700; }
  em { font-style: italic; }
  @media print { body { padding: 0; max-width: 100%; } }
  ${BUREAU_CSS}
</style>
</head>
<body>
  <div class="system-meta">${meta.sourceLang} → ${meta.targetLang} &nbsp;·&nbsp; ${meta.documentType} &nbsp;·&nbsp; ${meta.translatedAt}</div>
  ${bureauHeaderHtml}
  <div class="content">${body}</div>
  ${certHtml}
  ${notarHtml}
</body>
</html>`;

  return Buffer.from(html, 'utf-8');
}

/** Produces a real PDF buffer using pdf-lib (Latin characters only — non-Latin scripts render as ?). */
export async function renderToPdfBuffer(
  translatedMarkdown: string,
  meta: RenderMeta,
): Promise<Buffer> {
  function winAnsiSafe(s: string): string {
    return s.replace(/[^\x20-\x7E\xA0-\xFF]/g, (ch) => {
      const replacements: Record<string, string> = {
        '→': '->', '←': '<-', '↑': '^', '↓': 'v',
        '–': '-', '—': '-', '‘': "'", '“': '"', '”': '"',
      };
      return replacements[ch] ?? '?';
    });
  }

  const isPresentation = meta.documentType === 'presentation';
  const sl = meta.serviceLevel ?? 'electronic';
  const showCert = !isPresentation && (sl === 'official_with_translator_signature_and_provider_stamp' || sl === 'notarization_through_partners');
  const showNotarNote = !isPresentation && sl === 'notarization_through_partners';

  const stripped = winAnsiSafe(translatedMarkdown.replace(/!\[.*?\]\(.*?\)/g, ''));

  const pdfDoc = await PDFDocument.create();
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const PAGE_W = 595;
  const PAGE_H = 842;
  const MARGIN = 56;
  const LINE_H = 16;
  const CONTENT_W = PAGE_W - MARGIN * 2;

  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  function newPage() {
    page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  }

  function ensureSpace(needed: number) {
    if (y - needed < MARGIN) newPage();
  }

  function drawText(text: string, size: number, font: typeof regularFont, color = rgb(0.07, 0.07, 0.07)) {
    const words = text.split(' ');
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > CONTENT_W) {
        ensureSpace(LINE_H);
        page.drawText(line, { x: MARGIN, y, size, font, color });
        y -= LINE_H;
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) {
      ensureSpace(LINE_H);
      page.drawText(line, { x: MARGIN, y, size, font, color });
      y -= LINE_H;
    }
  }

  if (!isPresentation) {
    const header = winAnsiSafe(translationHeader(meta));
    drawText(header, 11, boldFont);
    y -= 2;
    drawText(winAnsiSafe(docTypeLabel(meta)), 9, regularFont, rgb(0.3, 0.3, 0.3));
    y -= 2;
    drawText(winAnsiSafe(originalCopyNote(meta)), 8, regularFont, rgb(0.5, 0.5, 0.5));
    y -= 8;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 1, color: rgb(0.1, 0.1, 0.1) });
    y -= 16;
  } else {
    drawText(`${meta.sourceLang.toUpperCase()} -> ${meta.targetLang.toUpperCase()}  |  ${meta.translatedAt}`, 9, regularFont, rgb(0.4, 0.4, 0.4));
    y -= 16;
  }

  for (const rawLine of stripped.split('\n')) {
    const line = rawLine.trimEnd();
    if (/^#{1}\s+/.test(line)) {
      y -= 8;
      ensureSpace(LINE_H * 2);
      drawText(line.replace(/^#+\s+/, ''), 14, boldFont);
      y -= 4;
    } else if (/^#{2}\s+/.test(line)) {
      y -= 4;
      drawText(line.replace(/^#+\s+/, ''), 12, boldFont);
      y -= 2;
    } else if (/^#{3,}\s+/.test(line)) {
      drawText(line.replace(/^#+\s+/, ''), 11, boldFont);
    } else if (/^[-*+]\s+/.test(line)) {
      const text = line.replace(/^[-*+]\s+/, '');
      ensureSpace(LINE_H);
      page.drawText('*', { x: MARGIN, y, size: 10, font: regularFont, color: rgb(0.07, 0.07, 0.07) });
      const words = text.split(' ');
      let l = '';
      for (const w of words) {
        const cand = l ? `${l} ${w}` : w;
        if (regularFont.widthOfTextAtSize(cand, 10) > CONTENT_W - 14) {
          ensureSpace(LINE_H);
          page.drawText(l, { x: MARGIN + 14, y, size: 10, font: regularFont, color: rgb(0.07, 0.07, 0.07) });
          y -= LINE_H;
          l = w;
        } else { l = cand; }
      }
      if (l) {
        ensureSpace(LINE_H);
        page.drawText(l, { x: MARGIN + 14, y, size: 10, font: regularFont, color: rgb(0.07, 0.07, 0.07) });
        y -= LINE_H;
      }
    } else if (line.trim() === '' || line.startsWith('---')) {
      y -= LINE_H / 2;
    } else {
      const clean = line.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/`([^`]+)`/g, '$1');
      drawText(clean, 10, regularFont);
    }
  }

  if (showCert) {
    y -= 16;
    ensureSpace(LINE_H * 2);
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 1, color: rgb(0.1, 0.1, 0.1) });
    y -= 16;
    drawText(winAnsiSafe(meta.targetLang === 'ru' ? 'SVEDENIYA O PEREVODCHIKE I ISPOLNITELE' : 'TRANSLATOR AND PROVIDER DETAILS'), 10, boldFont);
    y -= 4;
    for (const [label, value] of certificationRows(meta)) {
      const row = value ? winAnsiSafe(`${label} ${value}`) : winAnsiSafe(label);
      drawText(row, 9, regularFont);
    }
  }

  if (showNotarNote) {
    y -= 8;
    drawText(winAnsiSafe(notarizationNote(meta)), 8, regularFont, rgb(0.4, 0.4, 0.4));
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}
