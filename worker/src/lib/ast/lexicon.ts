/**
 * Worker-local copy of lexicon static packs.
 * Keep in sync with src/lib/translation-ast/lexicon.ts.
 */
import type { DocumentRenderLexicon } from './types';

const STATIC_PACKS: Record<string, DocumentRenderLexicon> = {
  en: {
    translationHeading: 'TRANSLATION',
    visualElementsHeading: 'Description of Non-Text Elements in the Original',
    originalPageLabel: 'Original page', elementLabel: 'Element', positionLabel: 'Position', representationLabel: 'Representation',
    translatorBlockHeading: 'TRANSLATOR AND PROVIDER DETAILS', translatorNameLabel: 'Translator', translatorQualificationLabel: 'Qualification',
    translatorSignatureLabel: 'Signature', translationDateLabel: 'Translation date', providerStampPlaceholder: '[Provider stamp]',
    pageLabel: 'Page', pageOfLabel: 'of',
    visualMarkers: { stamp: '[stamp]', signature: '[signature]', photo: '[photo]', logo: '[logo]', emblem: '[emblem]', qr: '[QR code present]', barcode: '[barcode]', watermark: '[watermark]', mrz: '[machine-readable zone]', verification_string: '[verification code]', handwritten_note: '[handwritten note]', electronic_approval: '[electronic signature]', unknown_image: '[image]' },
  },
  ru: {
    translationHeading: 'ПЕРЕВОД',
    visualElementsHeading: 'Описание нетекстовых элементов оригинала',
    originalPageLabel: 'Страница оригинала', elementLabel: 'Элемент', positionLabel: 'Расположение', representationLabel: 'Обозначение',
    translatorBlockHeading: 'СВЕДЕНИЯ О ПЕРЕВОДЧИКЕ И ИСПОЛНИТЕЛЕ', translatorNameLabel: 'Переводчик', translatorQualificationLabel: 'Квалификация',
    translatorSignatureLabel: 'Подпись', translationDateLabel: 'Дата перевода', providerStampPlaceholder: '[Печать исполнителя]',
    pageLabel: 'Стр.', pageOfLabel: 'из',
    visualMarkers: { stamp: '[печать]', signature: '[подпись]', photo: '[фото]', logo: '[логотип]', emblem: '[герб]', qr: '[QR-код присутствует]', barcode: '[штрих-код]', watermark: '[водяной знак]', mrz: '[машиночитаемая зона]', verification_string: '[код проверки]', handwritten_note: '[рукописная запись]', electronic_approval: '[электронная подпись]', unknown_image: '[изображение]' },
  },
  kk: {
    translationHeading: 'АУДАРМА',
    visualElementsHeading: 'Түпнұсқаның мәтіндік емес элементтерінің сипаттамасы',
    originalPageLabel: 'Түпнұсқа беті', elementLabel: 'Элемент', positionLabel: 'Орналасуы', representationLabel: 'Белгілеу',
    translatorBlockHeading: 'АУДАРМАШЫ МЕН ОРЫНДАУШЫ ТУРАЛЫ МӘЛІМЕТТЕР', translatorNameLabel: 'Аудармашы', translatorQualificationLabel: 'Біліктілігі',
    translatorSignatureLabel: 'Қолтаңба', translationDateLabel: 'Аударма күні', providerStampPlaceholder: '[Орындаушының мөрі]',
    pageLabel: 'Бет', pageOfLabel: '/',
    visualMarkers: { stamp: '[мөр]', signature: '[қолтаңба]', photo: '[фото]', logo: '[логотип]', emblem: '[герб]', qr: '[QR-код бар]', barcode: '[штрих-код]', watermark: '[су белгісі]', mrz: '[машинамен оқылатын аймақ]', verification_string: '[тексеру коды]', handwritten_note: '[қолмен жазылған жазба]', electronic_approval: '[электрондық қолтаңба]', unknown_image: '[сурет]' },
  },
  zh: {
    translationHeading: '翻译', visualElementsHeading: '原文非文字元素说明',
    originalPageLabel: '原文页码', elementLabel: '元素', positionLabel: '位置', representationLabel: '标记',
    translatorBlockHeading: '译者及提供方信息', translatorNameLabel: '译者', translatorQualificationLabel: '资质',
    translatorSignatureLabel: '签名', translationDateLabel: '翻译日期', providerStampPlaceholder: '[提供方印章]',
    pageLabel: '第', pageOfLabel: '页，共',
    visualMarkers: { stamp: '[印章]', signature: '[签名]', photo: '[照片]', logo: '[标志]', emblem: '[徽标]', qr: '[二维码]', barcode: '[条形码]', watermark: '[水印]', mrz: '[机器可读区]', verification_string: '[验证码]', handwritten_note: '[手写注记]', electronic_approval: '[电子签名]', unknown_image: '[图像]' },
  },
  ko: {
    translationHeading: '번역', visualElementsHeading: '원본 비문자 요소 설명',
    originalPageLabel: '원본 페이지', elementLabel: '요소', positionLabel: '위치', representationLabel: '표현',
    translatorBlockHeading: '번역자 및 제공자 정보', translatorNameLabel: '번역자', translatorQualificationLabel: '자격',
    translatorSignatureLabel: '서명', translationDateLabel: '번역 날짜', providerStampPlaceholder: '[제공자 도장]',
    pageLabel: '페이지', pageOfLabel: '/',
    visualMarkers: { stamp: '[도장]', signature: '[서명]', photo: '[사진]', logo: '[로고]', emblem: '[엠블럼]', qr: '[QR 코드]', barcode: '[바코드]', watermark: '[워터마크]', mrz: '[기계 판독 영역]', verification_string: '[인증 코드]', handwritten_note: '[수기 메모]', electronic_approval: '[전자 서명]', unknown_image: '[이미지]' },
  },
  ja: {
    translationHeading: '翻訳', visualElementsHeading: '原文の非テキスト要素の説明',
    originalPageLabel: '原文ページ', elementLabel: '要素', positionLabel: '位置', representationLabel: '表現',
    translatorBlockHeading: '翻訳者および提供者情報', translatorNameLabel: '翻訳者', translatorQualificationLabel: '資格',
    translatorSignatureLabel: '署名', translationDateLabel: '翻訳日', providerStampPlaceholder: '[提供者の印鑑]',
    pageLabel: 'ページ', pageOfLabel: '/',
    visualMarkers: { stamp: '[印鑑]', signature: '[署名]', photo: '[写真]', logo: '[ロゴ]', emblem: '[紋章]', qr: '[QRコード]', barcode: '[バーコード]', watermark: '[透かし]', mrz: '[機械読取領域]', verification_string: '[確認コード]', handwritten_note: '[手書きメモ]', electronic_approval: '[電子署名]', unknown_image: '[画像]' },
  },
  ar: {
    translationHeading: 'الترجمة', visualElementsHeading: 'وصف العناصر غير النصية في الأصل',
    originalPageLabel: 'صفحة الأصل', elementLabel: 'العنصر', positionLabel: 'الموضع', representationLabel: 'التمثيل',
    translatorBlockHeading: 'معلومات المترجم ومقدم الخدمة', translatorNameLabel: 'المترجم', translatorQualificationLabel: 'المؤهل',
    translatorSignatureLabel: 'التوقيع', translationDateLabel: 'تاريخ الترجمة', providerStampPlaceholder: '[ختم مقدم الخدمة]',
    pageLabel: 'صفحة', pageOfLabel: 'من',
    visualMarkers: { stamp: '[ختم]', signature: '[توقيع]', photo: '[صورة]', logo: '[شعار]', emblem: '[شارة]', qr: '[رمز الاستجابة السريعة]', barcode: '[باركود]', watermark: '[علامة مائية]', mrz: '[منطقة قابلة للقراءة الآلية]', verification_string: '[رمز التحقق]', handwritten_note: '[ملاحظة بخط اليد]', electronic_approval: '[توقيع إلكتروني]', unknown_image: '[صورة]' },
  },
  he: {
    translationHeading: 'תרגום', visualElementsHeading: 'תיאור אלמנטים לא-טקסטואליים במקור',
    originalPageLabel: 'עמוד מקור', elementLabel: 'אלמנט', positionLabel: 'מיקום', representationLabel: 'ייצוג',
    translatorBlockHeading: 'פרטי מתרגם וספק', translatorNameLabel: 'מתרגם', translatorQualificationLabel: 'כישורים',
    translatorSignatureLabel: 'חתימה', translationDateLabel: 'תאריך תרגום', providerStampPlaceholder: '[חותמת ספק]',
    pageLabel: 'עמוד', pageOfLabel: 'מתוך',
    visualMarkers: { stamp: '[חותמת]', signature: '[חתימה]', photo: '[תמונה]', logo: '[לוגו]', emblem: '[סמל]', qr: '[קוד QR]', barcode: '[ברקוד]', watermark: '[סימן מים]', mrz: '[אזור קריאה מכונה]', verification_string: '[קוד אימות]', handwritten_note: '[הערה בכתב יד]', electronic_approval: '[חתימה אלקטרונית]', unknown_image: '[תמונה]' },
  },
  th: {
    translationHeading: 'การแปล', visualElementsHeading: 'คำอธิบายองค์ประกอบที่ไม่ใช่ข้อความ',
    originalPageLabel: 'หน้าต้นฉบับ', elementLabel: 'องค์ประกอบ', positionLabel: 'ตำแหน่ง', representationLabel: 'การแสดงแทน',
    translatorBlockHeading: 'ข้อมูลผู้แปลและผู้ให้บริการ', translatorNameLabel: 'ผู้แปล', translatorQualificationLabel: 'คุณสมบัติ',
    translatorSignatureLabel: 'ลายเซ็น', translationDateLabel: 'วันที่แปล', providerStampPlaceholder: '[ตราของผู้ให้บริการ]',
    pageLabel: 'หน้า', pageOfLabel: 'จาก',
    visualMarkers: { stamp: '[ตราประทับ]', signature: '[ลายเซ็น]', photo: '[รูปถ่าย]', logo: '[โลโก้]', emblem: '[ตรา]', qr: '[คิวอาร์โค้ด]', barcode: '[บาร์โค้ด]', watermark: '[ลายน้ำ]', mrz: '[โซนอ่านได้ด้วยเครื่อง]', verification_string: '[รหัสยืนยัน]', handwritten_note: '[บันทึกลายมือ]', electronic_approval: '[ลายเซ็นอิเล็กทรอนิกส์]', unknown_image: '[ภาพ]' },
  },
};

const REQUIRED_KEYS: (keyof DocumentRenderLexicon)[] = [
  'translationHeading', 'visualElementsHeading', 'translatorBlockHeading',
  'translatorNameLabel', 'translatorSignatureLabel', 'translationDateLabel',
  'pageLabel', 'pageOfLabel',
];

export function getStaticLexicon(langCode: string): DocumentRenderLexicon | null {
  const norm = langCode.toLowerCase().replace(/_/g, '-');
  return STATIC_PACKS[norm] ?? STATIC_PACKS[norm.split('-')[0]!] ?? null;
}

export function validateLexicon(lexicon: unknown): lexicon is DocumentRenderLexicon {
  if (!lexicon || typeof lexicon !== 'object') return false;
  const l = lexicon as Record<string, unknown>;
  return REQUIRED_KEYS.every((key) => typeof l[key] === 'string' && (l[key] as string).length > 0);
}

export function mergeLexiconWithFallback(
  provided: Partial<DocumentRenderLexicon>,
  fallback: DocumentRenderLexicon,
): DocumentRenderLexicon {
  return { ...fallback, ...provided, visualMarkers: { ...fallback.visualMarkers, ...provided.visualMarkers } };
}

export const ENGLISH_FALLBACK_LEXICON = STATIC_PACKS['en']!;
