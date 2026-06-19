/**
 * DOCX-native visual elements block renderer.
 * Replaces the Markdown-injection approach (ensureVisualElementsBlock) for the DOCX path.
 * The HTML renderer (renderer.ts) continues to use ensureVisualElementsBlock unmodified.
 */

import {
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
} from 'docx';
import type { VisualElement, VisualElementKind } from './visual-elements';

// Re-export for use by docx-renderer
export type DocxBlock = Paragraph | Table;

// ── i18n dictionary ───────────────────────────────────────────────────────────

interface VisualBlockLocale {
  heading: string;
  colPage: string;
  colElement: string;
  colPosition: string;
  colRepresentation: string;
  noElements: string;
  kindLabels: Record<VisualElementKind, string>;
  positionLabels: Record<string, string>;
}

export const VISUAL_BLOCK_I18N: Record<string, VisualBlockLocale> = {
  ru: {
    heading: 'НЕТЕКСТОВЫЕ ЭЛЕМЕНТЫ ИСХОДНОГО ДОКУМЕНТА',
    colPage: 'Стр.',
    colElement: 'Элемент',
    colPosition: 'Расположение',
    colRepresentation: 'Передача в переводе',
    noElements: 'Нет явно распознанных нетекстовых элементов.',
    kindLabels: {
      logo: 'Логотип', emblem: 'Герб/эмблема', photo: 'Фотография',
      qr: 'QR-код', barcode: 'Штрих-код', stamp: 'Печать',
      signature: 'Подпись', watermark: 'Водяной знак',
      verification_string: 'Строка проверки', mrz: 'Машиночитаемая зона (MRZ)',
      handwritten_note: 'Рукописная пометка', electronic_approval: 'Электронное утверждение',
      accreditation_mark: 'Знак аккредитации', certification_mark: 'Знак сертификации',
      label: 'Этикетка', unknown_image: 'Изображение',
    },
    positionLabels: {
      upper_left: 'вверху слева', upper_center: 'вверху по центру', upper_right: 'вверху справа',
      center_left: 'по центру слева', center: 'по центру', center_right: 'по центру справа',
      lower_left: 'внизу слева', lower_center: 'внизу по центру', lower_right: 'внизу справа',
      full_page: 'на всей странице',
    },
  },

  en: {
    heading: 'VISUAL ELEMENTS OF THE ORIGINAL DOCUMENT',
    colPage: 'Page',
    colElement: 'Element',
    colPosition: 'Position',
    colRepresentation: 'Representation in translation',
    noElements: 'No clearly identified visual elements.',
    kindLabels: {
      logo: 'Logo', emblem: 'Emblem', photo: 'Photo',
      qr: 'QR code', barcode: 'Barcode', stamp: 'Stamp/Seal',
      signature: 'Signature', watermark: 'Watermark',
      verification_string: 'Verification string', mrz: 'Machine-readable zone (MRZ)',
      handwritten_note: 'Handwritten note', electronic_approval: 'Electronic approval',
      accreditation_mark: 'Accreditation mark', certification_mark: 'Certification mark',
      label: 'Label', unknown_image: 'Graphic element',
    },
    positionLabels: {
      upper_left: 'upper left', upper_center: 'upper center', upper_right: 'upper right',
      center_left: 'center left', center: 'center', center_right: 'center right',
      lower_left: 'lower left', lower_center: 'lower center', lower_right: 'lower right',
      full_page: 'full page',
    },
  },

  it: {
    heading: 'ELEMENTI VISIVI DEL DOCUMENTO ORIGINALE',
    colPage: 'Pagina',
    colElement: 'Elemento',
    colPosition: 'Posizione',
    colRepresentation: 'Rappresentazione nella traduzione',
    noElements: 'Non sono stati identificati elementi visivi significativi.',
    kindLabels: {
      logo: 'Logo', emblem: 'Emblema', photo: 'Fotografia',
      qr: 'Codice QR', barcode: 'Codice a barre', stamp: 'Timbro',
      signature: 'Firma manoscritta', watermark: 'Filigrana',
      verification_string: 'Stringa di verifica', mrz: 'Zona leggibile automaticamente (MRZ)',
      handwritten_note: 'Nota manoscritta', electronic_approval: 'Approvazione elettronica',
      accreditation_mark: 'Marchio di accreditamento', certification_mark: 'Marchio di certificazione',
      label: 'Etichetta', unknown_image: 'Elemento grafico',
    },
    positionLabels: {
      upper_left: 'in alto a sinistra', upper_center: 'in alto al centro', upper_right: 'in alto a destra',
      center_left: 'al centro a sinistra', center: 'al centro', center_right: 'al centro a destra',
      lower_left: 'in basso a sinistra', lower_center: 'in basso al centro', lower_right: 'in basso a destra',
      full_page: "sull'intera pagina",
    },
  },

  de: {
    heading: 'VISUELLE ELEMENTE DES ORIGINALDOKUMENTS',
    colPage: 'Seite',
    colElement: 'Element',
    colPosition: 'Position',
    colRepresentation: 'Darstellung in der Übersetzung',
    noElements: 'Keine klar identifizierten visuellen Elemente.',
    kindLabels: {
      logo: 'Logo', emblem: 'Emblem', photo: 'Foto',
      qr: 'QR-Code', barcode: 'Strichcode', stamp: 'Stempel/Siegel',
      signature: 'Handschriftliche Unterschrift', watermark: 'Wasserzeichen',
      verification_string: 'Verifizierungszeichenkette', mrz: 'Maschinenlesbarer Bereich (MRZ)',
      handwritten_note: 'Handschriftliche Notiz', electronic_approval: 'Elektronische Genehmigung',
      accreditation_mark: 'Akkreditierungszeichen', certification_mark: 'Zertifizierungszeichen',
      label: 'Etikett', unknown_image: 'Grafisches Element',
    },
    positionLabels: {
      upper_left: 'oben links', upper_center: 'oben Mitte', upper_right: 'oben rechts',
      center_left: 'Mitte links', center: 'Mitte', center_right: 'Mitte rechts',
      lower_left: 'unten links', lower_center: 'unten Mitte', lower_right: 'unten rechts',
      full_page: 'ganze Seite',
    },
  },

  fr: {
    heading: 'ÉLÉMENTS VISUELS DU DOCUMENT ORIGINAL',
    colPage: 'Page',
    colElement: 'Élément',
    colPosition: 'Position',
    colRepresentation: 'Représentation dans la traduction',
    noElements: 'Aucun élément visuel clairement identifié.',
    kindLabels: {
      logo: 'Logo', emblem: 'Emblème', photo: 'Photo',
      qr: 'Code QR', barcode: 'Code-barres', stamp: 'Cachet/Tampon',
      signature: 'Signature manuscrite', watermark: 'Filigrane',
      verification_string: 'Chaîne de vérification', mrz: 'Zone lisible par machine (MRZ)',
      handwritten_note: 'Note manuscrite', electronic_approval: 'Approbation électronique',
      accreditation_mark: "Marque d'accréditation", certification_mark: 'Marque de certification',
      label: 'Étiquette', unknown_image: 'Élément graphique',
    },
    positionLabels: {
      upper_left: 'en haut à gauche', upper_center: 'en haut au centre', upper_right: 'en haut à droite',
      center_left: 'au centre à gauche', center: 'au centre', center_right: 'au centre à droite',
      lower_left: 'en bas à gauche', lower_center: 'en bas au centre', lower_right: 'en bas à droite',
      full_page: 'page entière',
    },
  },

  es: {
    heading: 'ELEMENTOS VISUALES DEL DOCUMENTO ORIGINAL',
    colPage: 'Página',
    colElement: 'Elemento',
    colPosition: 'Posición',
    colRepresentation: 'Representación en la traducción',
    noElements: 'No se han identificado elementos visuales significativos.',
    kindLabels: {
      logo: 'Logotipo', emblem: 'Emblema', photo: 'Fotografía',
      qr: 'Código QR', barcode: 'Código de barras', stamp: 'Sello',
      signature: 'Firma manuscrita', watermark: 'Marca de agua',
      verification_string: 'Cadena de verificación', mrz: 'Zona de lectura mecánica (MRZ)',
      handwritten_note: 'Nota manuscrita', electronic_approval: 'Aprobación electrónica',
      accreditation_mark: 'Marca de acreditación', certification_mark: 'Marca de certificación',
      label: 'Etiqueta', unknown_image: 'Elemento gráfico',
    },
    positionLabels: {
      upper_left: 'arriba a la izquierda', upper_center: 'arriba al centro', upper_right: 'arriba a la derecha',
      center_left: 'al centro a la izquierda', center: 'al centro', center_right: 'al centro a la derecha',
      lower_left: 'abajo a la izquierda', lower_center: 'abajo al centro', lower_right: 'abajo a la derecha',
      full_page: 'página completa',
    },
  },

  zh: {
    heading: '原始文件视觉元素',
    colPage: '页码',
    colElement: '元素',
    colPosition: '位置',
    colRepresentation: '译文中的表示',
    noElements: '未发现明显的视觉元素。',
    kindLabels: {
      logo: '标志', emblem: '徽章', photo: '照片',
      qr: '二维码', barcode: '条形码', stamp: '印章',
      signature: '手写签名', watermark: '水印',
      verification_string: '验证字符串', mrz: '机器可读区域 (MRZ)',
      handwritten_note: '手写注释', electronic_approval: '电子批准',
      accreditation_mark: '认可标志', certification_mark: '认证标志',
      label: '标签', unknown_image: '图形元素',
    },
    positionLabels: {
      upper_left: '左上角', upper_center: '上方居中', upper_right: '右上角',
      center_left: '中间偏左', center: '居中', center_right: '中间偏右',
      lower_left: '左下角', lower_center: '下方居中', lower_right: '右下角',
      full_page: '整页',
    },
  },

  ko: {
    heading: '원본 문서의 시각적 요소',
    colPage: '페이지',
    colElement: '요소',
    colPosition: '위치',
    colRepresentation: '번역에서의 표현',
    noElements: '명확히 식별된 시각적 요소가 없습니다.',
    kindLabels: {
      logo: '로고', emblem: '엠블렘', photo: '사진',
      qr: 'QR 코드', barcode: '바코드', stamp: '도장/인감',
      signature: '수기 서명', watermark: '워터마크',
      verification_string: '확인 문자열', mrz: '기계 판독 구역 (MRZ)',
      handwritten_note: '수기 메모', electronic_approval: '전자 승인',
      accreditation_mark: '인증 마크', certification_mark: '자격 인증 마크',
      label: '라벨', unknown_image: '그래픽 요소',
    },
    positionLabels: {
      upper_left: '왼쪽 상단', upper_center: '상단 중앙', upper_right: '오른쪽 상단',
      center_left: '중앙 왼쪽', center: '중앙', center_right: '중앙 오른쪽',
      lower_left: '왼쪽 하단', lower_center: '하단 중앙', lower_right: '오른쪽 하단',
      full_page: '전체 페이지',
    },
  },

  ja: {
    heading: '原本書類の視覚的要素',
    colPage: 'ページ',
    colElement: '要素',
    colPosition: '位置',
    colRepresentation: '翻訳における表現',
    noElements: '明確に識別された視覚的要素はありません。',
    kindLabels: {
      logo: 'ロゴ', emblem: '紋章/エンブレム', photo: '写真',
      qr: 'QRコード', barcode: 'バーコード', stamp: '印鑑/スタンプ',
      signature: '手書き署名', watermark: '透かし',
      verification_string: '確認文字列', mrz: '機械読取領域 (MRZ)',
      handwritten_note: '手書きメモ', electronic_approval: '電子承認',
      accreditation_mark: '認定マーク', certification_mark: '認証マーク',
      label: 'ラベル', unknown_image: 'グラフィック要素',
    },
    positionLabels: {
      upper_left: '左上', upper_center: '上部中央', upper_right: '右上',
      center_left: '中央左', center: '中央', center_right: '中央右',
      lower_left: '左下', lower_center: '下部中央', lower_right: '右下',
      full_page: '全ページ',
    },
  },

  th: {
    heading: 'องค์ประกอบภาพในเอกสารต้นฉบับ',
    colPage: 'หน้า',
    colElement: 'องค์ประกอบ',
    colPosition: 'ตำแหน่ง',
    colRepresentation: 'การแสดงในคำแปล',
    noElements: 'ไม่พบองค์ประกอบภาพที่ชัดเจน',
    kindLabels: {
      logo: 'โลโก้', emblem: 'ตราสัญลักษณ์', photo: 'รูปถ่าย',
      qr: 'รหัส QR', barcode: 'บาร์โค้ด', stamp: 'ตราประทับ',
      signature: 'ลายมือชื่อ', watermark: 'ลายน้ำ',
      verification_string: 'สตริงการตรวจสอบ', mrz: 'โซนอ่านได้ด้วยเครื่อง (MRZ)',
      handwritten_note: 'บันทึกลายมือ', electronic_approval: 'การอนุมัติทางอิเล็กทรอนิกส์',
      accreditation_mark: 'เครื่องหมายการรับรอง', certification_mark: 'เครื่องหมายรับรองคุณภาพ',
      label: 'ป้าย', unknown_image: 'องค์ประกอบกราฟิก',
    },
    positionLabels: {
      upper_left: 'บนซ้าย', upper_center: 'บนกลาง', upper_right: 'บนขวา',
      center_left: 'กลางซ้าย', center: 'กลาง', center_right: 'กลางขวา',
      lower_left: 'ล่างซ้าย', lower_center: 'ล่างกลาง', lower_right: 'ล่างขวา',
      full_page: 'ทั้งหน้า',
    },
  },

  ar: {
    heading: 'العناصر المرئية للوثيقة الأصلية',
    colPage: 'الصفحة',
    colElement: 'العنصر',
    colPosition: 'الموضع',
    colRepresentation: 'التمثيل في الترجمة',
    noElements: 'لم يتم تحديد عناصر مرئية واضحة.',
    kindLabels: {
      logo: 'شعار', emblem: 'شعار رسمي', photo: 'صورة',
      qr: 'رمز QR', barcode: 'رمز شريطي', stamp: 'ختم/طابع',
      signature: 'توقيع يدوي', watermark: 'علامة مائية',
      verification_string: 'سلسلة التحقق', mrz: 'المنطقة القابلة للقراءة الآلية (MRZ)',
      handwritten_note: 'ملاحظة مكتوبة بالخط', electronic_approval: 'موافقة إلكترونية',
      accreditation_mark: 'علامة الاعتماد', certification_mark: 'علامة الاعتماد الدولي',
      label: 'ملصق', unknown_image: 'عنصر رسومي',
    },
    positionLabels: {
      upper_left: 'أعلى اليسار', upper_center: 'أعلى الوسط', upper_right: 'أعلى اليمين',
      center_left: 'وسط اليسار', center: 'الوسط', center_right: 'وسط اليمين',
      lower_left: 'أسفل اليسار', lower_center: 'أسفل الوسط', lower_right: 'أسفل اليمين',
      full_page: 'الصفحة كاملة',
    },
  },

  kk: {
    heading: 'ТҮПНҰСҚА ҚҰЖАТТЫҢ ВИЗУАЛДЫҚ ЭЛЕМЕНТТЕРІ',
    colPage: 'Бет',
    colElement: 'Элемент',
    colPosition: 'Орналасуы',
    colRepresentation: 'Аудармадағы берілісі',
    noElements: 'Анық анықталған визуалдық элементтер жоқ.',
    kindLabels: {
      logo: 'Логотип', emblem: 'Герб/эмблема', photo: 'Фотосурет',
      qr: 'QR-код', barcode: 'Штрих-код', stamp: 'Мөр',
      signature: 'Қолтаңба', watermark: 'Су белгісі',
      verification_string: 'Тексеру жолы', mrz: 'Машинамен оқылатын аймақ (MRZ)',
      handwritten_note: 'Қолмен жазылған ескертпе', electronic_approval: 'Электрондық мақұлдау',
      accreditation_mark: 'Аккредиттеу белгісі', certification_mark: 'Сертификаттау белгісі',
      label: 'Жапсырма', unknown_image: 'Графикалық элемент',
    },
    positionLabels: {
      upper_left: 'жоғарғы сол жақта', upper_center: 'жоғарғы ортада', upper_right: 'жоғарғы оң жақта',
      center_left: 'ортада сол жақта', center: 'ортада', center_right: 'ортада оң жақта',
      lower_left: 'төменгі сол жақта', lower_center: 'төменгі ортада', lower_right: 'төменгі оң жақта',
      full_page: 'бүкіл бетте',
    },
  },

  uz: {
    heading: 'ASL HUJJATNING VIZUAL ELEMENTLARI',
    colPage: 'Sahifa',
    colElement: 'Element',
    colPosition: 'Joylashuv',
    colRepresentation: "Tarjimadagi ko'rinishi",
    noElements: "Aniq aniqlangan vizual elementlar yo'q.",
    kindLabels: {
      logo: 'Logotip', emblem: 'Gerb/emblema', photo: 'Fotosurat',
      qr: 'QR-kod', barcode: 'Shtrix-kod', stamp: 'Muhr',
      signature: "Qo'lda yozilgan imzo", watermark: 'Suv belgisi',
      verification_string: 'Tekshiruv qatori', mrz: "Mashina o'qiydigan zona (MRZ)",
      handwritten_note: "Qo'lda yozilgan eslatma", electronic_approval: 'Elektron tasdiqlash',
      accreditation_mark: 'Akkreditatsiya belgisi', certification_mark: 'Sertifikatlash belgisi',
      label: 'Yorliq', unknown_image: 'Grafik element',
    },
    positionLabels: {
      upper_left: 'yuqori chap', upper_center: 'yuqori markazda', upper_right: "yuqori o'ng",
      center_left: 'markazda chapda', center: 'markazda', center_right: "markazda o'ngda",
      lower_left: 'pastki chap', lower_center: 'pastki markazda', lower_right: "pastki o'ng",
      full_page: 'butun sahifa',
    },
  },

  tr: {
    heading: 'ORİJİNAL BELGENİN GÖRSEL UNSURLARI',
    colPage: 'Sayfa',
    colElement: 'Unsur',
    colPosition: 'Konum',
    colRepresentation: 'Çevirideki temsil',
    noElements: 'Açıkça tanımlanmış görsel unsur bulunmamaktadır.',
    kindLabels: {
      logo: 'Logo', emblem: 'Amblem/Arma', photo: 'Fotoğraf',
      qr: 'QR kodu', barcode: 'Barkod', stamp: 'Mühür/Damga',
      signature: 'El yazısı imza', watermark: 'Filigran',
      verification_string: 'Doğrulama dizisi', mrz: 'Makine tarafından okunabilir bölge (MRZ)',
      handwritten_note: 'El yazısı not', electronic_approval: 'Elektronik onay',
      accreditation_mark: 'Akreditasyon işareti', certification_mark: 'Sertifikasyon işareti',
      label: 'Etiket', unknown_image: 'Grafik öğe',
    },
    positionLabels: {
      upper_left: 'sol üst', upper_center: 'üst orta', upper_right: 'sağ üst',
      center_left: 'sol orta', center: 'orta', center_right: 'sağ orta',
      lower_left: 'sol alt', lower_center: 'alt orta', lower_right: 'sağ alt',
      full_page: 'tam sayfa',
    },
  },
};

// ── Column widths (DXA, 9000 total = 100%) ───────────────────────────────────

const COL_PAGE_W = 900;       // 10 %
const COL_ELEM_W = 1800;      // 20 %
const COL_POS_W = 2250;       // 25 %
const COL_REPR_W = 4050;      // 45 %

const VIS_BORDERS = {
  top:              { style: BorderStyle.SINGLE, size: 6, color: '000000' },
  bottom:           { style: BorderStyle.SINGLE, size: 6, color: '000000' },
  left:             { style: BorderStyle.SINGLE, size: 6, color: '000000' },
  right:            { style: BorderStyle.SINGLE, size: 6, color: '000000' },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
  insideVertical:   { style: BorderStyle.SINGLE, size: 4, color: '000000' },
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function cellPar(text: string, bold = false): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold })],
    spacing: { before: 60, after: 60 },
  });
}

function visHeaderRow(loc: VisualBlockLocale): TableRow {
  return new TableRow({
    cantSplit: true,
    tableHeader: true,
    children: [
      new TableCell({ children: [cellPar(loc.colPage, true)],          width: { size: COL_PAGE_W, type: WidthType.DXA }, shading: { fill: 'E6E6E6' } }),
      new TableCell({ children: [cellPar(loc.colElement, true)],       width: { size: COL_ELEM_W, type: WidthType.DXA }, shading: { fill: 'E6E6E6' } }),
      new TableCell({ children: [cellPar(loc.colPosition, true)],      width: { size: COL_POS_W,  type: WidthType.DXA }, shading: { fill: 'E6E6E6' } }),
      new TableCell({ children: [cellPar(loc.colRepresentation, true)], width: { size: COL_REPR_W, type: WidthType.DXA }, shading: { fill: 'E6E6E6' } }),
    ],
  });
}

function visDataRow(el: VisualElement, loc: VisualBlockLocale): TableRow {
  const page = el.page != null ? String(el.page) : '—';
  const element = loc.kindLabels[el.kind] ?? el.kind;
  const position = el.position != null
    ? (loc.positionLabels[el.position] ?? el.position)
    : '—';
  const representation = el.description ?? loc.kindLabels[el.kind] ?? '—';

  return new TableRow({
    cantSplit: true,
    children: [
      new TableCell({ children: [cellPar(page)],           width: { size: COL_PAGE_W, type: WidthType.DXA } }),
      new TableCell({ children: [cellPar(element)],        width: { size: COL_ELEM_W, type: WidthType.DXA } }),
      new TableCell({ children: [cellPar(position)],       width: { size: COL_POS_W,  type: WidthType.DXA } }),
      new TableCell({ children: [cellPar(representation)], width: { size: COL_REPR_W, type: WidthType.DXA } }),
    ],
  });
}

// Deduplicate by page + kind + position + normalised description.
// Preserves order; two signatures at different positions both survive.
function deduplicateForBlock(elements: VisualElement[]): VisualElement[] {
  const seen = new Set<string>();
  return elements.filter((el) => {
    const norm = (el.description ?? el.text ?? '').toLowerCase().replace(/\W/g, '');
    const key = `${el.page ?? ''}:${el.kind}:${el.position ?? ''}:${norm}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Strip any Markdown visual-block section from translated content ────────────
// Searches backwards from end so it finds the LAST such heading (always at end).

const STRIP_HEADING_PATTERNS = [
  /^##\s+описание нетекстовых элементов/i,
  /^##\s+нетекстовые элементы/i,
  /^##\s+description of non-text elements/i,
  /^##\s+(document\s+)?visual elements/i,
  /^##\s+визуальные элементы/i,
  /^##\s+elementi visivi/i,
  /^##\s+visuelle elemente/i,
  /^##\s+éléments visuels/i,
  /^##\s+elementos visuales/i,
];

export function stripVisualBlockFromMarkdown(markdown: string): string {
  const lines = markdown.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? '';
    if (/^##\s+/.test(line)) {
      const lower = line.toLowerCase();
      if (STRIP_HEADING_PATTERNS.some((re) => re.test(lower.replace(/^##\s+/, '## ')))) {
        return lines.slice(0, i).join('\n').trimEnd();
      }
    }
  }
  return markdown;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function renderVisualBlock(
  elements: VisualElement[],
  targetLang: string,
): DocxBlock[] {
  const loc = VISUAL_BLOCK_I18N[targetLang] ?? VISUAL_BLOCK_I18N['en']!;
  const deduped = deduplicateForBlock(elements);

  const heading = new Paragraph({
    children: [new TextRun({ text: loc.heading, bold: true })],
    spacing: { before: 240, after: 120 },
    keepNext: true,
  });

  if (deduped.length === 0) {
    return [
      new Paragraph({ text: '', spacing: { before: 160, after: 0 } }),
      heading,
      new Paragraph({
        children: [new TextRun({ text: loc.noElements, italics: true })],
        spacing: { after: 80 },
      }),
    ];
  }

  const table = new Table({
    rows: [
      visHeaderRow(loc),
      ...deduped.map((el) => visDataRow(el, loc)),
    ],
    width: { size: 9000, type: WidthType.DXA },
    borders: VIS_BORDERS,
  });

  return [
    new Paragraph({ text: '', spacing: { before: 160, after: 0 } }),
    heading,
    table,
  ];
}
