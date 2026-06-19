import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  Packer,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
} from 'docx';
import type { VisualElement } from './visual-elements';
import { renderVisualBlock, stripVisualBlockFromMarkdown } from './docx-visual-block';

// ── Thai font support ──────────────────────────────────────────────────────────
// U+0E00–U+0E7F: Thai Unicode block
const THAI_RANGE_RE = /[฀-๿]+/g;

export type TextSegment = {
  text: string;
  isThai: boolean;
};

export function splitThaiTextRuns(text: string): TextSegment[] {
  if (!text) return [{ text: '', isThai: false }];
  const segments: TextSegment[] = [];
  let pos = 0;
  THAI_RANGE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = THAI_RANGE_RE.exec(text)) !== null) {
    if (m.index > pos) {
      segments.push({ text: text.slice(pos, m.index), isThai: false });
    }
    segments.push({ text: m[0], isThai: true });
    pos = m.index + m[0].length;
  }
  if (pos < text.length) {
    segments.push({ text: text.slice(pos), isThai: false });
  }
  return segments.length > 0 ? segments : [{ text, isThai: false }];
}

const THAI_FONT = { ascii: 'Noto Sans Thai', hAnsi: 'Noto Sans Thai', cs: 'Noto Sans Thai' } as const;

interface RunOpts {
  bold?: boolean;
  italics?: boolean;
  size?: number;
  color?: string;
}

function makeThaiAwareRuns(text: string, opts: RunOpts = {}): TextRun[] {
  const segments = splitThaiTextRuns(text);
  return segments.map(({ text: t, isThai }) =>
    new TextRun({ text: t, ...(isThai ? { font: THAI_FONT } : {}), ...opts }),
  );
}

export interface DocxMeta {
  sourceLang: string;
  targetLang: string;
  documentType: string;
  translatedAt: string;
  filename?: string;
  serviceLevel?: string;
  outputMode?: string;
}

// ── Translator / Provider block ───────────────────────────────────────────────

const BLANK = '____________________________';
const PROVIDER_IIN = '840324300155';

interface TranslatorBlockLocale {
  heading: string;
  declarationTpl: string; // placeholders: {src} {tgt}
  translator: string;
  qualification: string;
  signature: string;
  provider: string;
  iin: string;
  stamp: string;
  date: string;
  providerName: string;
  srcNames: Record<string, string>;
  tgtNames: Record<string, string>;
}

export const TRANSLATOR_BLOCK_I18N: Record<string, TranslatorBlockLocale> = {
  ru: {
    heading: 'ПЕРЕВОДЧИК И ИСПОЛНИТЕЛЬ',
    declarationTpl:
      'Настоящим переводчик подтверждает полноту и соответствие перевода {src} {tgt} представленному исходному документу.',
    translator: 'Переводчик',
    qualification: 'Квалификация / основание компетенции',
    signature: 'Подпись переводчика',
    provider: 'Исполнитель',
    iin: 'ИИН',
    stamp: 'Печать Исполнителя',
    date: 'Дата',
    providerName: 'ИП World Prime Online',
    srcNames: { ru: 'с русского', en: 'с английского', th: 'с тайского', zh: 'с китайского', ko: 'с корейского', ja: 'с японского', de: 'с немецкого', fr: 'с французского', es: 'с испанского', ar: 'с арабского', kk: 'с казахского', uz: 'с узбекского', it: 'с итальянского', tr: 'с турецкого' },
    tgtNames: { ru: 'на русский', en: 'на английский', th: 'на тайский', zh: 'на китайский', ko: 'на корейский', ja: 'на японский', de: 'на немецкий', fr: 'на французский', es: 'на испанский', ar: 'на арабский', kk: 'на казахский', uz: 'на узбекский', it: 'на итальянский', tr: 'на турецкий' },
  },
  en: {
    heading: 'TRANSLATOR AND PROVIDER DETAILS',
    declarationTpl:
      'The translator confirms that this translation from {src} to {tgt} is complete and corresponds to the source document presented.',
    translator: 'Translator',
    qualification: 'Translator qualification',
    signature: 'Translator signature',
    provider: 'Provider',
    iin: 'IIN',
    stamp: 'Provider stamp',
    date: 'Date',
    providerName: 'Individual Entrepreneur World Prime Online',
    srcNames: { ru: 'Russian', en: 'English', th: 'Thai', zh: 'Chinese', ko: 'Korean', ja: 'Japanese', de: 'German', fr: 'French', es: 'Spanish', ar: 'Arabic', kk: 'Kazakh', uz: 'Uzbek', it: 'Italian', tr: 'Turkish' },
    tgtNames: { ru: 'Russian', en: 'English', th: 'Thai', zh: 'Chinese', ko: 'Korean', ja: 'Japanese', de: 'German', fr: 'French', es: 'Spanish', ar: 'Arabic', kk: 'Kazakh', uz: 'Uzbek', it: 'Italian', tr: 'Turkish' },
  },
  it: {
    heading: "DATI DEL TRADUTTORE E DELL'ESECUTORE",
    declarationTpl:
      'Il traduttore conferma che la presente traduzione {src} {tgt} è completa e corrisponde al documento originale presentato.',
    translator: 'Traduttore',
    qualification: 'Qualifica del traduttore',
    signature: 'Firma del traduttore',
    provider: 'Esecutore',
    iin: 'IIN',
    stamp: "Timbro dell'Esecutore",
    date: 'Data',
    providerName: 'Imprenditore individuale World Prime Online',
    srcNames: { ru: 'dal russo', en: "dall'inglese", th: 'dal tailandese', zh: 'dal cinese', ko: 'dal coreano', ja: 'dal giapponese', de: 'dal tedesco', fr: 'dal francese', es: 'dallo spagnolo', ar: "dall'arabo", kk: 'dal kazako', uz: "dall'uzbeko", it: "dall'italiano", tr: 'dal turco' },
    tgtNames: { ru: 'al russo', en: "all'inglese", th: 'al tailandese', zh: 'al cinese', ko: 'al coreano', ja: 'al giapponese', de: 'al tedesco', fr: 'al francese', es: 'allo spagnolo', ar: "all'arabo", kk: 'al kazako', uz: "all'uzbeko", it: "all'italiano", tr: 'al turco' },
  },
  de: {
    heading: 'ANGABEN ZUM ÜBERSETZER UND LEISTUNGSERBRINGER',
    declarationTpl:
      'Der Übersetzer bestätigt, dass diese Übersetzung {src} {tgt} vollständig ist und dem vorgelegten Originaldokument entspricht.',
    translator: 'Übersetzer',
    qualification: 'Qualifikation des Übersetzers',
    signature: 'Unterschrift des Übersetzers',
    provider: 'Leistungserbringer',
    iin: 'IIN',
    stamp: 'Stempel des Leistungserbringers',
    date: 'Datum',
    providerName: 'Einzelunternehmer World Prime Online',
    srcNames: { ru: 'aus dem Russischen', en: 'aus dem Englischen', th: 'aus dem Thailändischen', zh: 'aus dem Chinesischen', ko: 'aus dem Koreanischen', ja: 'aus dem Japanischen', de: 'aus dem Deutschen', fr: 'aus dem Französischen', es: 'aus dem Spanischen', ar: 'aus dem Arabischen', kk: 'aus dem Kasachischen', uz: 'aus dem Usbekischen', it: 'aus dem Italienischen', tr: 'aus dem Türkischen' },
    tgtNames: { ru: 'ins Russische', en: 'ins Englische', th: 'ins Thailändische', zh: 'ins Chinesische', ko: 'ins Koreanische', ja: 'ins Japanische', de: 'ins Deutsche', fr: 'ins Französische', es: 'ins Spanische', ar: 'ins Arabische', kk: 'ins Kasachische', uz: 'ins Usbekische', it: 'ins Italienische', tr: 'ins Türkische' },
  },
  fr: {
    heading: 'TRADUCTEUR ET PRESTATAIRE',
    declarationTpl:
      'Le traducteur confirme que la présente traduction {src} {tgt} est complète et correspond au document original présenté.',
    translator: 'Traducteur',
    qualification: 'Qualifications du traducteur',
    signature: 'Signature du traducteur',
    provider: 'Prestataire',
    iin: 'IIN',
    stamp: 'Cachet du Prestataire',
    date: 'Date',
    providerName: 'Entrepreneur individuel World Prime Online',
    srcNames: { ru: 'du russe', en: "de l'anglais", th: 'du thaï', zh: 'du chinois', ko: 'du coréen', ja: 'du japonais', de: "de l'allemand", fr: 'du français', es: "de l'espagnol", ar: "de l'arabe", kk: 'du kazakh', uz: "de l'ouzbek", it: "de l'italien", tr: 'du turc' },
    tgtNames: { ru: 'en russe', en: 'en anglais', th: 'en thaï', zh: 'en chinois', ko: 'en coréen', ja: 'en japonais', de: 'en allemand', fr: 'en français', es: 'en espagnol', ar: 'en arabe', kk: 'en kazakh', uz: 'en ouzbek', it: 'en italien', tr: 'en turc' },
  },
  es: {
    heading: 'TRADUCTOR Y PROVEEDOR',
    declarationTpl:
      'El traductor confirma que la presente traducción {src} {tgt} es completa y corresponde al documento original presentado.',
    translator: 'Traductor',
    qualification: 'Cualificación del traductor',
    signature: 'Firma del traductor',
    provider: 'Proveedor',
    iin: 'IIN',
    stamp: 'Sello del Proveedor',
    date: 'Fecha',
    providerName: 'Empresario individual World Prime Online',
    srcNames: { ru: 'del ruso', en: 'del inglés', th: 'del tailandés', zh: 'del chino', ko: 'del coreano', ja: 'del japonés', de: 'del alemán', fr: 'del francés', es: 'del español', ar: 'del árabe', kk: 'del kazajo', uz: 'del uzbeko', it: 'del italiano', tr: 'del turco' },
    tgtNames: { ru: 'al ruso', en: 'al inglés', th: 'al tailandés', zh: 'al chino', ko: 'al coreano', ja: 'al japonés', de: 'al alemán', fr: 'al francés', es: 'al español', ar: 'al árabe', kk: 'al kazajo', uz: 'al uzbeko', it: 'al italiano', tr: 'al turco' },
  },
  zh: {
    heading: '译者和执行者信息',
    declarationTpl: '译者确认，本{src}至{tgt}译文完整，与所呈原文件相符。',
    translator: '译者',
    qualification: '译者资质',
    signature: '译者签名',
    provider: '执行者',
    iin: '个人识别号',
    stamp: '执行者印章',
    date: '日期',
    providerName: '个体企业主 World Prime Online',
    srcNames: { ru: '俄语', en: '英语', th: '泰语', zh: '中文', ko: '韩语', ja: '日语', de: '德语', fr: '法语', es: '西班牙语', ar: '阿拉伯语', kk: '哈萨克语', uz: '乌兹别克语', it: '意大利语', tr: '土耳其语' },
    tgtNames: { ru: '俄语', en: '英语', th: '泰语', zh: '中文', ko: '韩语', ja: '日语', de: '德语', fr: '法语', es: '西班牙语', ar: '阿拉伯语', kk: '哈萨克语', uz: '乌兹别克语', it: '意大利语', tr: '土耳其语' },
  },
  ko: {
    heading: '번역자 및 실행자 정보',
    declarationTpl: '번역자는 {src}에서 {tgt}로의 본 번역이 완전하며 제시된 원본 문서와 일치함을 확인합니다.',
    translator: '번역자',
    qualification: '번역자 자격',
    signature: '번역자 서명',
    provider: '실행자',
    iin: '개인식별번호',
    stamp: '실행자 직인',
    date: '날짜',
    providerName: '개인사업자 World Prime Online',
    srcNames: { ru: '러시아어', en: '영어', th: '태국어', zh: '중국어', ko: '한국어', ja: '일본어', de: '독일어', fr: '프랑스어', es: '스페인어', ar: '아랍어', kk: '카자흐어', uz: '우즈베크어', it: '이탈리아어', tr: '터키어' },
    tgtNames: { ru: '러시아어', en: '영어', th: '태국어', zh: '중국어', ko: '한국어', ja: '일본어', de: '독일어', fr: '프랑스어', es: '스페인어', ar: '아랍어', kk: '카자흐어', uz: '우즈베크어', it: '이탈리아어', tr: '터키어' },
  },
  ja: {
    heading: '翻訳者および執行者情報',
    declarationTpl: '翻訳者は、本{src}から{tgt}への翻訳が完全であり、提示された原文書と一致することを確認します。',
    translator: '翻訳者',
    qualification: '翻訳者の資格',
    signature: '翻訳者の署名',
    provider: '執行者',
    iin: '個人識別番号',
    stamp: '執行者の印鑑',
    date: '日付',
    providerName: '個人事業主 World Prime Online',
    srcNames: { ru: 'ロシア語', en: '英語', th: 'タイ語', zh: '中国語', ko: '韓国語', ja: '日本語', de: 'ドイツ語', fr: 'フランス語', es: 'スペイン語', ar: 'アラビア語', kk: 'カザフ語', uz: 'ウズベク語', it: 'イタリア語', tr: 'トルコ語' },
    tgtNames: { ru: 'ロシア語', en: '英語', th: 'タイ語', zh: '中国語', ko: '韓国語', ja: '日本語', de: 'ドイツ語', fr: 'フランス語', es: 'スペイン語', ar: 'アラビア語', kk: 'カザフ語', uz: 'ウズベク語', it: 'イタリア語', tr: 'トルコ語' },
  },
  th: {
    heading: 'ข้อมูลนักแปลและผู้ให้บริการ',
    declarationTpl: 'นักแปลขอรับรองว่าการแปลจาก{src}เป็น{tgt}ฉบับนี้มีความสมบูรณ์และตรงกับเอกสารต้นฉบับที่ได้รับ',
    translator: 'นักแปล',
    qualification: 'คุณสมบัติของนักแปล',
    signature: 'ลายมือชื่อนักแปล',
    provider: 'ผู้ให้บริการ',
    iin: 'หมายเลขประจำตัว',
    stamp: 'ตราประทับผู้ให้บริการ',
    date: 'วันที่',
    providerName: 'ผู้ประกอบการรายบุคคล World Prime Online',
    srcNames: { ru: 'ภาษารัสเซีย', en: 'ภาษาอังกฤษ', th: 'ภาษาไทย', zh: 'ภาษาจีน', ko: 'ภาษาเกาหลี', ja: 'ภาษาญี่ปุ่น', de: 'ภาษาเยอรมัน', fr: 'ภาษาฝรั่งเศส', es: 'ภาษาสเปน', ar: 'ภาษาอาหรับ', kk: 'ภาษาคาซัค', uz: 'ภาษาอุซเบก', it: 'ภาษาอิตาลี', tr: 'ภาษาตุรกี' },
    tgtNames: { ru: 'ภาษารัสเซีย', en: 'ภาษาอังกฤษ', th: 'ภาษาไทย', zh: 'ภาษาจีน', ko: 'ภาษาเกาหลี', ja: 'ภาษาญี่ปุ่น', de: 'ภาษาเยอรมัน', fr: 'ภาษาฝรั่งเศส', es: 'ภาษาสเปน', ar: 'ภาษาอาหรับ', kk: 'ภาษาคาซัค', uz: 'ภาษาอุซเบก', it: 'ภาษาอิตาลี', tr: 'ภาษาตุรกี' },
  },
  ar: {
    heading: 'المترجم والمنفّذ',
    declarationTpl: 'يُقرّ المترجم بأن هذه الترجمة {src} إلى {tgt} كاملةٌ وتُطابق الوثيقة الأصلية المُقدَّمة.',
    translator: 'المترجم',
    qualification: 'مؤهلات المترجم',
    signature: 'توقيع المترجم',
    provider: 'المنفّذ',
    iin: 'الرقم التعريفي الشخصي',
    stamp: 'ختم المنفّذ',
    date: 'التاريخ',
    providerName: 'World Prime Online (مقاول فردي، كازاخستان)',
    srcNames: { ru: 'من الروسية', en: 'من الإنجليزية', th: 'من التايلاندية', zh: 'من الصينية', ko: 'من الكورية', ja: 'من اليابانية', de: 'من الألمانية', fr: 'من الفرنسية', es: 'من الإسبانية', ar: 'من العربية', kk: 'من الكازاخية', uz: 'من الأوزبكية', it: 'من الإيطالية', tr: 'من التركية' },
    tgtNames: { ru: 'الروسية', en: 'الإنجليزية', th: 'التايلاندية', zh: 'الصينية', ko: 'الكورية', ja: 'اليابانية', de: 'الألمانية', fr: 'الفرنسية', es: 'الإسبانية', ar: 'العربية', kk: 'الكازاخية', uz: 'الأوزبكية', it: 'الإيطالية', tr: 'التركية' },
  },
  kk: {
    heading: 'АУДАРМАШЫ ЖӘНЕ ОРЫНДАУШЫ',
    declarationTpl:
      'Аудармашы осы {src} тілінен {tgt} тіліне жасалған аударманың толық екенін және ұсынылған түпнұсқа құжатқа сәйкес келетінін растайды.',
    translator: 'Аудармашы',
    qualification: 'Аудармашының біліктілігі',
    signature: 'Аудармашының қолы',
    provider: 'Орындаушы',
    iin: 'ЖСН',
    stamp: 'Орындаушының мөрі',
    date: 'Күні',
    providerName: 'ЖК World Prime Online',
    srcNames: { ru: 'орыс', en: 'ағылшын', th: 'тай', zh: 'қытай', ko: 'корей', ja: 'жапон', de: 'неміс', fr: 'француз', es: 'испан', ar: 'араб', kk: 'қазақ', uz: 'өзбек', it: 'итальян', tr: 'түрік' },
    tgtNames: { ru: 'орыс', en: 'ағылшын', th: 'тай', zh: 'қытай', ko: 'корей', ja: 'жапон', de: 'неміс', fr: 'француз', es: 'испан', ar: 'араб', kk: 'қазақ', uz: 'өзбек', it: 'итальян', tr: 'түрік' },
  },
  uz: {
    heading: 'TARJIMON VA IJROCHI',
    declarationTpl:
      "Tarjimon ushbu {src} tilidan {tgt} tiliga tarjimaning to'liq ekanligini va taqdim etilgan asl hujjatga mos kelishini tasdiqlaydi.",
    translator: 'Tarjimon',
    qualification: 'Tarjimon malakasi',
    signature: 'Tarjimon imzosi',
    provider: 'Ijrochi',
    iin: 'JSHSHIR',
    stamp: 'Ijrochi muhri',
    date: 'Sana',
    providerName: "YaT World Prime Online",
    srcNames: { ru: 'rus', en: 'ingliz', th: 'tailand', zh: 'xitoy', ko: 'koreys', ja: 'yapon', de: 'nemis', fr: 'fransuz', es: 'ispan', ar: 'arab', kk: 'qozoq', uz: "o'zbek", it: 'italyan', tr: 'turk' },
    tgtNames: { ru: 'rus', en: 'ingliz', th: 'tailand', zh: 'xitoy', ko: 'koreys', ja: 'yapon', de: 'nemis', fr: 'fransuz', es: 'ispan', ar: 'arab', kk: 'qozoq', uz: "o'zbek", it: 'italyan', tr: 'turk' },
  },
  tr: {
    heading: 'ÇEVİRMEN VE HİZMET SAĞLAYICI',
    declarationTpl: 'Çevirmen, {src} {tgt} yapılan bu çevirinin eksiksiz olduğunu ve sunulan kaynak belgeye karşılık geldiğini onaylar.',
    translator: 'Çevirmen',
    qualification: 'Çevirmenin niteliği',
    signature: 'Çevirmen imzası',
    provider: 'Hizmet Sağlayıcı',
    iin: 'KİN',
    stamp: 'Hizmet Sağlayıcı mühürü',
    date: 'Tarih',
    providerName: 'Bireysel Girişimci World Prime Online',
    srcNames: { ru: 'Rusçadan', en: 'İngilizceden', th: 'Taylandcadan', zh: 'Çinceden', ko: 'Korecedan', ja: 'Japondan', de: 'Almancadan', fr: 'Fransızcadan', es: 'İspanyolcadan', ar: 'Arapçadan', kk: 'Kazakçadan', uz: 'Özbekçeden', it: 'İtalyancadan', tr: 'Türkçeden' },
    tgtNames: { ru: 'Rusçaya', en: 'İngilizceye', th: 'Taylandcaya', zh: 'Çinceye', ko: 'Koreceye', ja: 'Japonya', de: 'Almancaya', fr: 'Fransızcaya', es: 'İspanyolcaya', ar: 'Arapçaya', kk: 'Kazakçaya', uz: 'Özbekçeye', it: 'İtalyancaya', tr: 'Türkçeye' },
  },
};

const BLOCK_MODES = new Set(['translator_review_draft', 'notarization_package']);

function getLocale(targetLang: string): TranslatorBlockLocale {
  return TRANSLATOR_BLOCK_I18N[targetLang] ?? TRANSLATOR_BLOCK_I18N['en']!;
}

const BLOCK_BORDERS = {
  top: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
  bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
  left: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
  right: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
  insideVertical: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
} as const;

const LABEL_W = 3200;
const VALUE_W = 5800;

function blockRow(label: string, value: string): TableRow {
  return new TableRow({
    cantSplit: true,
    children: [
      new TableCell({
        children: [new Paragraph({ children: makeThaiAwareRuns(label, { bold: true }), spacing: { before: 60, after: 60 } })],
        width: { size: LABEL_W, type: WidthType.DXA },
      }),
      new TableCell({
        children: [new Paragraph({ children: makeThaiAwareRuns(value), spacing: { before: 60, after: 60 } })],
        width: { size: VALUE_W, type: WidthType.DXA },
      }),
    ],
  });
}

export function renderTranslatorProviderBlock(params: {
  sourceLang: string;
  targetLang: string;
  outputMode: string;
}): DocxChild[] {
  const { sourceLang, targetLang, outputMode } = params;
  if (!BLOCK_MODES.has(outputMode)) return [];

  const loc = getLocale(targetLang);
  const srcName = loc.srcNames[sourceLang] ?? sourceLang;
  const tgtName = loc.tgtNames[targetLang] ?? targetLang;
  const declaration = loc.declarationTpl
    .replace('{src}', srcName)
    .replace('{tgt}', tgtName);

  const table = new Table({
    rows: [
      blockRow(loc.translator + ':', BLANK),
      blockRow(loc.qualification + ':', BLANK),
      blockRow(loc.signature + ':', BLANK),
      blockRow(loc.provider + ':', loc.providerName),
      blockRow(loc.iin + ':', PROVIDER_IIN),
      blockRow(loc.stamp + ':', BLANK),
      blockRow(loc.date + ':', BLANK),
    ],
    width: { size: 9000, type: WidthType.DXA },
    borders: BLOCK_BORDERS,
  });

  return [
    new Paragraph({ text: '', spacing: { before: 200, after: 0 } }),
    new Paragraph({
      children: makeThaiAwareRuns(loc.heading, { bold: true }),
      spacing: { before: 120, after: 120 },
      keepNext: true,
    }),
    new Paragraph({
      children: makeThaiAwareRuns(declaration),
      spacing: { after: 120 },
      keepNext: true,
    }),
    table,
  ];
}

function parseInlineMarkdown(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const segRe = /(\*\*[^*]+\*\*|\*[^*]+\*|\[([^\]]{1,120})\])/g;
  let segMatch: RegExpExecArray | null;
  let pos = 0;
  segRe.lastIndex = 0;

  while ((segMatch = segRe.exec(text)) !== null) {
    if (segMatch.index > pos) {
      runs.push(...makeThaiAwareRuns(text.slice(pos, segMatch.index)));
    }
    const part = segMatch[0];
    if (part.startsWith('**') && part.endsWith('**')) {
      runs.push(...makeThaiAwareRuns(part.slice(2, -2), { bold: true }));
    } else if (part.startsWith('*') && part.endsWith('*') && !part.startsWith('**')) {
      runs.push(...makeThaiAwareRuns(part.slice(1, -1), { italics: true }));
    } else if (part.startsWith('[') && part.endsWith(']')) {
      runs.push(new TextRun({ text: part, italics: true, color: '333333' }));
    }
    pos = segMatch.index + part.length;
  }

  if (pos < text.length) {
    runs.push(...makeThaiAwareRuns(text.slice(pos)));
  }

  return runs.length > 0 ? runs : makeThaiAwareRuns(text);
}

interface ParsedTable {
  headers: string[];
  rows: string[][];
}

function parseMarkdownTable(lines: string[]): ParsedTable | null {
  if (lines.length < 2) return null;
  // Header row
  const headerLine = lines[0];
  if (!headerLine?.includes('|')) return null;
  // Separator row
  const sepLine = lines[1];
  if (!sepLine || !/^\|?[\s\-|:]+\|?$/.test(sepLine)) return null;

  const parseRow = (line: string): string[] => {
    return line
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim());
  };

  const headers = parseRow(headerLine);
  const rows = lines.slice(2).map(parseRow);
  return { headers, rows };
}

function buildDocxTable(parsed: ParsedTable): Table {
  const colCount = parsed.headers.length;
  const colWidth = Math.floor(9000 / colCount);

  const headerRow = new TableRow({
    children: parsed.headers.map(
      (h) =>
        new TableCell({
          children: [new Paragraph({ children: makeThaiAwareRuns(h, { bold: true }) })],
          width: { size: colWidth, type: WidthType.DXA },
          shading: { fill: 'E6E6E6' },
        }),
    ),
    tableHeader: true,
  });

  const dataRows = parsed.rows.map(
    (row) =>
      new TableRow({
        children: row.map(
          (cell) =>
            new TableCell({
              children: [new Paragraph({ children: parseInlineMarkdown(cell) })],
              width: { size: colWidth, type: WidthType.DXA },
            }),
        ),
      }),
  );

  return new Table({
    rows: [headerRow, ...dataRows],
    width: { size: 9000, type: WidthType.DXA },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
      left: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
      right: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
    },
  });
}

type DocxChild = Paragraph | Table;

function parseMarkdownToDocx(markdown: string): DocxChild[] {
  const lines = markdown.split('\n');
  const children: DocxChild[] = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i] ?? '';
    const line = raw.trimEnd();

    // Detect markdown table start
    if (line.includes('|') && i + 1 < lines.length) {
      const nextLine = lines[i + 1] ?? '';
      if (/^\|?[\s\-|:]+\|?$/.test(nextLine)) {
        // Collect all table lines
        const tableLines: string[] = [line];
        i++;
        while (i < lines.length && (lines[i] ?? '').includes('|')) {
          tableLines.push(lines[i] ?? '');
          i++;
        }
        const parsed = parseMarkdownTable(tableLines);
        if (parsed) {
          children.push(buildDocxTable(parsed));
        } else {
          // Fallback: render as paragraphs
          for (const tl of tableLines) {
            children.push(new Paragraph({ children: parseInlineMarkdown(tl.replace(/^\||\|$/g, '').replace(/\|/g, ' | ')), spacing: { after: 60 } }));
          }
        }
        continue;
      }
    }

    if (/^#{1}\s+/.test(line)) {
      children.push(new Paragraph({ children: makeThaiAwareRuns(line.replace(/^#+\s+/, '')), heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 } }));
    } else if (/^#{2}\s+/.test(line)) {
      children.push(new Paragraph({ children: makeThaiAwareRuns(line.replace(/^#+\s+/, '')), heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 80 } }));
    } else if (/^#{3,}\s+/.test(line)) {
      children.push(new Paragraph({ children: makeThaiAwareRuns(line.replace(/^#+\s+/, '')), heading: HeadingLevel.HEADING_3, spacing: { before: 160, after: 80 } }));
    } else if (/^[-*+]\s+/.test(line)) {
      children.push(new Paragraph({ children: parseInlineMarkdown(line.replace(/^[-*+]\s+/, '')), bullet: { level: 0 }, spacing: { after: 60 } }));
    } else if (line.trim() === '') {
      children.push(new Paragraph({ text: '', spacing: { after: 60 } }));
    } else {
      // Strip image refs, keep visual markers
      const textLine = line.replace(/!\[[^\]]*\]\([^)]+\)/g, '');
      children.push(new Paragraph({ children: parseInlineMarkdown(textLine), spacing: { after: 80 } }));
    }
    i++;
  }

  return children;
}

/**
 * Remove translator notes that ONLY describe visual elements (signatures, stamps, QR, etc.)
 * because these duplicate what the native DOCX visual-block table already shows.
 * Notes about content issues (illegible, damaged, missing, ambiguous) are kept.
 */
export function removeVisualOnlyTranslatorNotes(markdown: string): string {
  const NOTE_PREFIX_RE = /^(?:nota(?:\s+del?\s+traduttore?|\s+du\s+traducteur)?|translator(?:'?s)?\s+note|примечание\s+переводчика|hinweis\s+des\s+übersetzers|note\s+du\s+traducteur|nota\s+del\s+traductor|переводчик\s+отмечает)/i;
  const CONTENT_RE = /illegib|illeggib|нечитаемо|неразборчив|damaged|повреждён|danneggiato|missing\s+page|отсутству|mancante|ambiguous|неоднозначн|ambiguo|unclear|непонятн|non\s+chiaro|uncertain|сомнительн|truncated|обрезан|troncat|blurred|размыт/i;
  const VISUAL_RE = /firma|firme|signature|подпись|imza|timbro|stamp|печать|seal|qr|logo|filigran|watermark|водяной/i;

  return markdown
    .split(/\n\n+/)
    .filter((para) => {
      const t = para.trim();
      if (!NOTE_PREFIX_RE.test(t)) return true;
      if (CONTENT_RE.test(t)) return true;
      return !VISUAL_RE.test(t);
    })
    .join('\n\n');
}

export async function renderToDocx(
  translatedMarkdown: string,
  meta: DocxMeta,
  visualElements?: VisualElement[],
): Promise<Buffer> {
  // Remove visual-element-only translator notes (they duplicate the native DOCX visual table).
  // Then strip any Markdown visual-block section Claude appended.
  const withoutDuplicateNotes = removeVisualOnlyTranslatorNotes(translatedMarkdown);
  const cleanedMarkdown = stripVisualBlockFromMarkdown(withoutDuplicateNotes);

  // Internal metadata line is suppressed for official drafts — it is not part of the
  // certified translation content and must not appear in the ai_draft.docx artifact.
  const isOfficialDraft =
    meta.outputMode === 'translator_review_draft' ||
    meta.outputMode === 'notarization_package';

  const headerParagraphs: Paragraph[] = isOfficialDraft ? [] : [
    new Paragraph({
      children: [
        new TextRun({ text: `${meta.sourceLang.toUpperCase()} → ${meta.targetLang.toUpperCase()}`, bold: true, size: 24 }),
        new TextRun({ text: `  |  ${meta.documentType}  |  ${meta.translatedAt}`, size: 18, color: '666666' }),
      ],
      spacing: { after: 200 },
    }),
  ];

  const visualBlock = renderVisualBlock(visualElements ?? [], meta.targetLang);

  const translatorBlock = renderTranslatorProviderBlock({
    sourceLang: meta.sourceLang,
    targetLang: meta.targetLang,
    outputMode: meta.outputMode ?? '',
  });

  const doc = new Document({
    sections: [{
      properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
      children: [...headerParagraphs, ...parseMarkdownToDocx(cleanedMarkdown), ...visualBlock, ...translatorBlock],
    }],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}
