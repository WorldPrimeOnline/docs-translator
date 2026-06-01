import { marked } from 'marked';

type ServiceLevel =
  | 'electronic'
  | 'official_with_translator_signature_and_provider_stamp'
  | 'notarization_through_partners';

export interface RenderMeta {
  sourceLang: string;
  targetLang: string;
  documentType: string;
  translatedAt: string;
  filename?: string;
  serviceLevel?: ServiceLevel;
}

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

function isAutoSource(lang: string): boolean {
  return !lang || lang === 'auto' || lang === 'auto-detect';
}

function translationHeader(meta: RenderMeta): string {
  const d = dl(meta.targetLang);
  const tgt = LANG_TGT[meta.targetLang]?.[d] ?? meta.targetLang.toUpperCase();
  if (isAutoSource(meta.sourceLang)) {
    return d === 'ru'
      ? `ПЕРЕВОД НА ${tgt.toUpperCase()} ЯЗЫК`
      : `TRANSLATION INTO ${tgt.toUpperCase()}`;
  }
  const src = LANG_SRC[meta.sourceLang]?.[d] ?? meta.sourceLang.toUpperCase();
  return d === 'ru'
    ? `ПЕРЕВОД С ${src.toUpperCase()} ЯЗЫКА НА ${tgt.toUpperCase()} ЯЗЫК`
    : `TRANSLATION FROM ${src.toUpperCase()} INTO ${tgt.toUpperCase()}`;
}

function autoSourceSubNote(meta: RenderMeta): string {
  return meta.targetLang === 'ru'
    ? 'Исходный язык определён автоматически.'
    : 'Source language was detected automatically.';
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

function officialFooter(meta: RenderMeta): string {
  const d = dl(meta.targetLang);
  const tgtName = LANG_TGT[meta.targetLang]?.[d] ?? meta.targetLang;
  const srcName = isAutoSource(meta.sourceLang)
    ? (d === 'ru' ? 'определён автоматически' : 'auto-detected')
    : (LANG_TGT[meta.sourceLang]?.[d] ?? meta.sourceLang);
  return d === 'ru'
    ? `Перевод подготовлен сервисом World Prime Online. Дата подготовки: ${meta.translatedAt}. Исходный язык: ${srcName}. Целевой язык: ${tgtName}.`
    : `Translation prepared by World Prime Online. Date: ${meta.translatedAt}. Source language: ${srcName}. Target language: ${tgtName}.`;
}

function certificationRows(meta: RenderMeta): Array<[string, string]> {
  const d = dl(meta.targetLang);
  const src = LANG_SRC[meta.sourceLang]?.[d] ?? meta.sourceLang;
  const tgt = LANG_TGT[meta.targetLang]?.[d] ?? meta.targetLang;
  const iinBin = PROVIDER_IIN_BIN || '______________________';
  if (d === 'ru') {
    return [
      [`Перевод с ${src} языка на ${tgt} язык выполнен верно.`, ''],
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
    [`The translation from ${src} into ${tgt} is correct.`, ''],
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
  .auto-source-note { font-size: 8.5pt; color: #888; font-style: italic; margin-bottom: 4px; }
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
  .official-footer { margin-top: 28px; padding-top: 10px; border-top: 1px solid #ddd; font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 8.5pt; color: #666; text-align: center; }
`;

export async function renderToHtml(
  translatedMarkdown: string,
  meta: RenderMeta,
): Promise<string> {
  const isPresentation = meta.documentType === 'presentation';
  const rawBody = await marked.parse(cleanMarkdown(translatedMarkdown));
  const body = wrapMarkers(rawBody);

  const sl = meta.serviceLevel ?? 'electronic';
  const showCert = !isPresentation && (sl === 'official_with_translator_signature_and_provider_stamp' || sl === 'notarization_through_partners');
  const showNotarNote = !isPresentation && sl === 'notarization_through_partners';

  const autoNote = !isPresentation && isAutoSource(meta.sourceLang)
    ? `<div class="auto-source-note">${autoSourceSubNote(meta)}</div>`
    : '';
  const bureauHeaderHtml = isPresentation ? '' : `
  <div class="bureau-header">
    <div class="translation-title">${translationHeader(meta)}</div>
    ${autoNote}
    <div class="doc-type-label">${docTypeLabel(meta)}</div>
    <div class="original-note">${originalCopyNote(meta)}</div>
  </div>`;

  const certHtml = showCert ? buildCertificationBlockHtml(meta) : '';
  const notarHtml = showNotarNote ? `<div class="notarization-note">${notarizationNote(meta)}</div>` : '';
  const footerHtml = isPresentation ? '' : `<div class="official-footer">${officialFooter(meta)}</div>`;

  // system-meta kept for presentation only; official docs use bureau header + official footer
  const systemMetaHtml = isPresentation
    ? `<div class="system-meta">${meta.filename ? `<strong>${meta.filename}</strong> &nbsp;·&nbsp; ` : ''}${meta.translatedAt} &nbsp;·&nbsp; ${meta.sourceLang} → ${meta.targetLang}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="${meta.targetLang}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Translation — ${meta.sourceLang} → ${meta.targetLang}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: A4; margin: 20mm 15mm 25mm 15mm; }
  @page {
    @bottom-center {
      content: counter(page) " / " counter(pages);
      font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
      font-size: 9pt;
      color: #888;
    }
  }
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
  p  { margin: 5px 0; }
  ul, ol { margin: 6px 0 6px 22px; }
  li { margin: 3px 0; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; page-break-inside: avoid; break-inside: avoid; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; break-inside: avoid; }
  th, td { border: 1px solid #bbb; padding: 5px 10px; text-align: left; vertical-align: top; }
  th { background: #f5f5f5; font-weight: 600; width: 40%; }
  td { width: 60%; }
  strong { font-weight: 700; }
  em { font-style: italic; }
  @media print { body { padding: 0; max-width: 100%; } }
  ${BUREAU_CSS}
</style>
</head>
<body>
  ${systemMetaHtml}
  ${bureauHeaderHtml}
  <div class="content">${body}</div>
  ${certHtml}
  ${notarHtml}
  ${footerHtml}
</body>
</html>`;
}
