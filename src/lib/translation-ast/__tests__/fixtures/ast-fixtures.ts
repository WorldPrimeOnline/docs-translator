import type { TranslationDocumentAst, TranslationBlock, RenderingProfile } from '@/lib/translation-ast/types';
import type { DocumentType } from '@/lib/translation-prompts/types';
import { resolveDocumentLanguage } from '@/lib/document-language';
import { getStaticLexicon, ENGLISH_FALLBACK_LEXICON } from '@/lib/translation-ast/lexicon';

export interface AstFixture {
  id: string;
  sourceScript: string;
  targetScript: string;
  documentProfile: string;
  ast: TranslationDocumentAst;
}

function lex(langCode: string) {
  return getStaticLexicon(langCode) ?? ENGLISH_FALLBACK_LEXICON;
}

function baseAst(
  srcCode: string,
  tgtCode: string,
  docType: DocumentType,
  profile: RenderingProfile,
  blocks: TranslationBlock[],
  extras?: Partial<TranslationDocumentAst>,
): TranslationDocumentAst {
  return {
    schemaVersion: '1.0',
    sourceLanguage: resolveDocumentLanguage(srcCode),
    targetLanguage: resolveDocumentLanguage(tgtCode),
    requestedDocumentType: docType,
    detectedDocumentType: docType,
    renderingProfile: profile,
    sourcePageCount: 1,
    blocks,
    visualElements: [],
    verificationItems: [],
    renderLexicon: lex(tgtCode),
    sourceWarnings: [],
    translatorNotes: [],
    ...extras,
  };
}

const COMMON_BLOCKS: TranslationBlock[] = [
  { type: 'heading', id: 'h1', level: 1, text: 'Document Heading' },
  { type: 'key_value', id: 'kv1', fields: [
    { id: 'f1', label: 'Number', value: 'AB123456', preserveExactly: true },
    { id: 'f2', label: 'Issued by', value: 'Ministry of Documents' },
  ]},
  { type: 'signature', id: 'sig1', role: 'Authorized Officer', visualMarker: '[signature]' },
  { type: 'visual_marker', id: 'vm1', markerText: '[stamp]' },
  { type: 'note', id: 'n1', text: 'Certified translation.', noteType: 'translator' },
  { type: 'page_break', id: 'pb1', afterSourcePage: 1 },
];

// ─── Script-family fixtures ───────────────────────────────────────────────────

const latinLtrPassport: AstFixture = {
  id: 'latin_ltr_passport',
  sourceScript: 'latin',
  targetScript: 'latin',
  documentProfile: 'passport_id',
  ast: baseAst('en', 'de', 'passport_id', 'identity_document', COMMON_BLOCKS),
};

const cyrillicDiploma: AstFixture = {
  id: 'cyrillic_ltr_diploma',
  sourceScript: 'cyrillic',
  targetScript: 'cyrillic',
  documentProfile: 'diploma_transcript',
  ast: baseAst('ru', 'ru', 'diploma_transcript', 'academic_document', [
    { type: 'heading', id: 'h1', level: 1, text: 'Диплом' },
    { type: 'table', id: 't1', title: 'Дисциплины',
      columns: [{ id: 'c1', header: 'Предмет' }, { id: 'c2', header: 'Оценка' }],
      rows: [
        { id: 'r1', cells: { c1: 'Математика', c2: '5' } },
        { id: 'r2', cells: { c1: 'История', c2: '4' } },
      ],
    },
    { type: 'signature', id: 'sig1', role: 'Ректор', visualMarker: '[подпись]' },
    { type: 'note', id: 'n1', text: 'Перевод верен.', noteType: 'translator' },
    { type: 'page_break', id: 'pb1', afterSourcePage: 1 },
  ]),
};

const kazakhCyrillicCert: AstFixture = {
  id: 'kazakh_cyrillic_cert',
  sourceScript: 'cyrillic',
  targetScript: 'cyrillic',
  documentProfile: 'employment_document',
  ast: baseAst('kk', 'kk', 'employment_document', 'structured_certificate', COMMON_BLOCKS),
};

const arabicRtlPassport: AstFixture = {
  id: 'arabic_rtl_passport',
  sourceScript: 'arabic',
  targetScript: 'arabic',
  documentProfile: 'passport_id',
  ast: baseAst('ar', 'ar', 'passport_id', 'identity_document', [
    { type: 'heading', id: 'h1', level: 1, text: 'جواز السفر' },
    { type: 'key_value', id: 'kv1', fields: [
      { id: 'f1', label: 'الرقم', value: 'A12345678', preserveExactly: true },
      { id: 'f2', label: 'الاسم', value: 'محمد أحمد' },
    ]},
    { type: 'signature', id: 'sig1', visualMarker: '[توقيع]' },
    { type: 'visual_marker', id: 'vm1', markerText: '[ختم]' },
    { type: 'note', id: 'n1', text: 'ترجمة معتمدة.', noteType: 'translator' },
    { type: 'page_break', id: 'pb1', afterSourcePage: 1 },
  ]),
};

const hebrewRtlContract: AstFixture = {
  id: 'hebrew_rtl_contract',
  sourceScript: 'hebrew',
  targetScript: 'hebrew',
  documentProfile: 'contract',
  ast: baseAst('he', 'he', 'contract', 'legal_document', [
    { type: 'heading', id: 'h1', level: 1, text: 'חוזה' },
    { type: 'clause', id: 'cl1', number: '1', paragraphs: ['פסקה ראשונה של החוזה.'] },
    { type: 'signature', id: 'sig1', visualMarker: '[חתימה]' },
    { type: 'note', id: 'n1', text: 'תרגום מאושר.', noteType: 'translator' },
    { type: 'page_break', id: 'pb1', afterSourcePage: 1 },
  ]),
};

const chinesePassport: AstFixture = {
  id: 'chinese_passport',
  sourceScript: 'chinese',
  targetScript: 'chinese',
  documentProfile: 'passport_id',
  ast: baseAst('zh', 'zh', 'passport_id', 'identity_document', [
    { type: 'heading', id: 'h1', level: 1, text: '护照' },
    { type: 'key_value', id: 'kv1', fields: [
      { id: 'f1', label: '证件号码', value: 'E12345678', preserveExactly: true },
      { id: 'f2', label: '姓名', value: '张伟' },
    ]},
    { type: 'signature', id: 'sig1', visualMarker: '[签名]' },
    { type: 'visual_marker', id: 'vm1', markerText: '[印章]' },
    { type: 'note', id: 'n1', text: '已核实翻译。', noteType: 'translator' },
    { type: 'page_break', id: 'pb1', afterSourcePage: 1 },
  ]),
};

const japaneseDiploma: AstFixture = {
  id: 'japanese_diploma',
  sourceScript: 'japanese',
  targetScript: 'japanese',
  documentProfile: 'diploma_transcript',
  ast: baseAst('ja', 'ja', 'diploma_transcript', 'academic_document', [
    { type: 'heading', id: 'h1', level: 1, text: '卒業証書' },
    { type: 'key_value', id: 'kv1', fields: [
      { id: 'f1', label: '氏名', value: '山田太郎' },
    ]},
    { type: 'signature', id: 'sig1', visualMarker: '[署名]' },
    { type: 'note', id: 'n1', text: '認定翻訳。', noteType: 'translator' },
    { type: 'page_break', id: 'pb1', afterSourcePage: 1 },
  ]),
};

const koreanBank: AstFixture = {
  id: 'korean_bank',
  sourceScript: 'korean',
  targetScript: 'korean',
  documentProfile: 'bank_statement',
  ast: baseAst('ko', 'ko', 'bank_statement', 'financial_document', [
    { type: 'heading', id: 'h1', level: 1, text: '은행 명세서' },
    { type: 'table', id: 't1',
      columns: [{ id: 'c1', header: '날짜' }, { id: 'c2', header: '금액', semanticType: 'money' }],
      rows: [{ id: 'r1', cells: { c1: '2026-01-01', c2: '10,000' } }],
    },
    { type: 'signature', id: 'sig1', visualMarker: '[서명]' },
    { type: 'note', id: 'n1', text: '공인 번역.', noteType: 'translator' },
    { type: 'page_break', id: 'pb1', afterSourcePage: 1 },
  ]),
};

const thaiMedical: AstFixture = {
  id: 'thai_medical',
  sourceScript: 'thai',
  targetScript: 'thai',
  documentProfile: 'medical_document',
  ast: baseAst('th', 'th', 'medical_document', 'medical_document', [
    { type: 'heading', id: 'h1', level: 1, text: 'รายงานทางการแพทย์' },
    { type: 'key_value', id: 'kv1', fields: [
      { id: 'f1', label: 'ชื่อ', value: 'สมชาย ใจดี' },
    ]},
    { type: 'signature', id: 'sig1', visualMarker: '[ลายเซ็น]' },
    { type: 'note', id: 'n1', text: 'การแปลที่ได้รับการรับรอง', noteType: 'translator' },
    { type: 'page_break', id: 'pb1', afterSourcePage: 1 },
  ]),
};

const devanagariPassport: AstFixture = {
  id: 'devanagari_passport',
  sourceScript: 'devanagari',
  targetScript: 'devanagari',
  documentProfile: 'passport_id',
  ast: baseAst('hi', 'hi', 'passport_id', 'identity_document', [
    { type: 'heading', id: 'h1', level: 1, text: 'पासपोर्ट' },
    { type: 'key_value', id: 'kv1', fields: [
      { id: 'f1', label: 'संख्या', value: 'A1234567', preserveExactly: true },
    ]},
    { type: 'signature', id: 'sig1', visualMarker: '[हस्ताक्षर]' },
    { type: 'note', id: 'n1', text: 'प्रमाणित अनुवाद।', noteType: 'translator' },
    { type: 'page_break', id: 'pb1', afterSourcePage: 1 },
  ]),
};

const mixedScriptRtlToLtr: AstFixture = {
  id: 'mixed_script_rtl_to_ltr',
  sourceScript: 'arabic',
  targetScript: 'latin',
  documentProfile: 'passport_id',
  ast: baseAst('ar', 'en', 'passport_id', 'identity_document', COMMON_BLOCKS),
};

const unknownLang: AstFixture = {
  id: 'unknown_lang',
  sourceScript: 'unknown',
  targetScript: 'unknown',
  documentProfile: 'other',
  ast: baseAst('xyz-unknown', 'xyz-unknown', 'other', 'generic_document', [
    { type: 'heading', id: 'h1', level: 1, text: 'Document' },
    { type: 'paragraph', id: 'p1', text: 'Content.' },
    { type: 'signature', id: 'sig1', visualMarker: '[signature]' },
    { type: 'note', id: 'n1', text: 'Certified.', noteType: 'translator' },
    { type: 'page_break', id: 'pb1', afterSourcePage: 1 },
  ]),
};

// ─── Document-profile fixtures ────────────────────────────────────────────────

const driverLicense: AstFixture = {
  id: 'driver_license_en',
  sourceScript: 'cyrillic',
  targetScript: 'latin',
  documentProfile: 'driver_license',
  ast: baseAst('ru', 'en', 'driver_license', 'identity_document', [
    { type: 'heading', id: 'h1', level: 1, text: "Driver's License" },
    { type: 'key_value', id: 'kv1', fields: [
      { id: 'f1', label: 'License No.', value: '77DF123456', preserveExactly: true },
      { id: 'f2', label: 'Name', value: 'John Smith' },
      { id: 'f3', label: 'Category', value: 'B' },
    ]},
    { type: 'signature', id: 'sig1', visualMarker: '[signature]' },
    { type: 'visual_marker', id: 'vm1', markerText: '[photo]' },
    { type: 'note', id: 'n1', text: 'Certified translation.', noteType: 'translator' },
    { type: 'page_break', id: 'pb1', afterSourcePage: 1 },
  ]),
};

// 100-row table fixture
const transcriptLargeTable: AstFixture = (() => {
  const rows = Array.from({ length: 100 }, (_, i) => ({
    id: `r${i}`,
    cells: { c1: `Subject ${i + 1}`, c2: `${(Math.floor(i / 10) % 5) + 1}` },
  }));
  return {
    id: 'transcript_large_table',
    sourceScript: 'cyrillic',
    targetScript: 'latin',
    documentProfile: 'diploma_transcript',
    ast: baseAst('ru', 'en', 'diploma_transcript', 'academic_document', [
      { type: 'heading', id: 'h1', level: 1, text: 'Academic Transcript' },
      { type: 'table', id: 't1', title: 'Grades',
        columns: [{ id: 'c1', header: 'Subject' }, { id: 'c2', header: 'Grade' }],
        rows,
      },
      { type: 'signature', id: 'sig1', visualMarker: '[signature]' },
      { type: 'note', id: 'n1', text: 'Certified.', noteType: 'translator' },
      { type: 'page_break', id: 'pb1', afterSourcePage: 1 },
    ], { sourcePageCount: 3 }),
  };
})();

const bankStatementEn: AstFixture = {
  id: 'bank_statement_en',
  sourceScript: 'cyrillic',
  targetScript: 'latin',
  documentProfile: 'bank_statement',
  ast: baseAst('ru', 'en', 'bank_statement', 'financial_document', [
    { type: 'heading', id: 'h1', level: 1, text: 'Bank Statement' },
    { type: 'table', id: 't1',
      columns: [
        { id: 'c1', header: 'Date' },
        { id: 'c2', header: 'Description' },
        { id: 'c3', header: 'Amount', semanticType: 'money' },
      ],
      rows: [
        { id: 'r1', cells: { c1: '2026-01-15', c2: 'Payment', c3: '1,500.00' } },
        { id: 'r2', cells: { c1: '2026-01-16', c2: 'Transfer', c3: '-200.00' } },
      ],
    },
    { type: 'signature', id: 'sig1', visualMarker: '[signature]' },
    { type: 'note', id: 'n1', text: 'Certified.', noteType: 'translator' },
    { type: 'page_break', id: 'pb1', afterSourcePage: 1 },
  ]),
};

const contractNested: AstFixture = {
  id: 'contract_nested',
  sourceScript: 'cyrillic',
  targetScript: 'latin',
  documentProfile: 'contract',
  ast: baseAst('ru', 'en', 'contract', 'legal_document', [
    { type: 'heading', id: 'h1', level: 1, text: 'Service Agreement' },
    {
      type: 'clause', id: 'cl1', number: '1', title: 'Definitions', paragraphs: ['Terms used herein.'],
      children: [
        { type: 'clause', id: 'cl1_1', number: '1.1', paragraphs: ['First sub-clause.'] },
        { type: 'clause', id: 'cl1_2', number: '1.2', paragraphs: ['Second sub-clause.'] },
      ],
    },
    { type: 'signature', id: 'sig1', role: 'Client', visualMarker: '[signature]' },
    { type: 'signature', id: 'sig2', role: 'Provider', visualMarker: '[signature]' },
    { type: 'note', id: 'n1', text: 'Certified translation.', noteType: 'translator' },
    { type: 'page_break', id: 'pb1', afterSourcePage: 1 },
  ]),
};

const medicalReportEn: AstFixture = {
  id: 'medical_report_en',
  sourceScript: 'cyrillic',
  targetScript: 'latin',
  documentProfile: 'medical_document',
  ast: baseAst('ru', 'en', 'medical_document', 'medical_document', [
    { type: 'heading', id: 'h1', level: 1, text: 'Medical Report' },
    { type: 'key_value', id: 'kv1', fields: [
      { id: 'f1', label: 'Patient', value: 'John Doe' },
      { id: 'f2', label: 'Date', value: '2026-01-15' },
    ]},
    { type: 'paragraph', id: 'p1', text: 'Patient presents with no acute illness.' },
    { type: 'signature', id: 'sig1', role: 'Physician', visualMarker: '[signature]' },
    { type: 'note', id: 'n1', text: 'Certified translation.', noteType: 'translator' },
    { type: 'page_break', id: 'pb1', afterSourcePage: 1 },
  ]),
};

const policeClearanceEn: AstFixture = {
  id: 'police_clearance_en',
  sourceScript: 'cyrillic',
  targetScript: 'latin',
  documentProfile: 'police_clearance',
  ast: baseAst('kk', 'en', 'police_clearance', 'official_certificate', [
    { type: 'heading', id: 'h1', level: 1, text: 'Police Clearance Certificate' },
    { type: 'key_value', id: 'kv1', fields: [
      { id: 'f1', label: 'Certificate No.', value: 'KZ2026-00123', preserveExactly: true },
      { id: 'f2', label: 'Name', value: 'Jane Doe' },
    ]},
    { type: 'signature', id: 'sig1', role: 'Authorized Officer', visualMarker: '[signature]' },
    { type: 'visual_marker', id: 'vm1', markerText: '[official stamp]' },
    { type: 'note', id: 'n1', text: 'Certified.', noteType: 'translator' },
    { type: 'page_break', id: 'pb1', afterSourcePage: 1 },
  ]),
};

const visaDocumentEn: AstFixture = {
  id: 'visa_document_en',
  sourceScript: 'latin',
  targetScript: 'cyrillic',
  documentProfile: 'visa_documents',
  ast: baseAst('en', 'ru', 'visa_documents', 'identity_document', [
    { type: 'heading', id: 'h1', level: 1, text: 'Виза' },
    { type: 'key_value', id: 'kv1', fields: [
      { id: 'f1', label: 'Номер', value: 'V12345678', preserveExactly: true },
    ]},
    { type: 'signature', id: 'sig1', visualMarker: '[подпись]' },
    { type: 'visual_marker', id: 'vm1', markerText: '[печать]' },
    { type: 'note', id: 'n1', text: 'Заверенный перевод.', noteType: 'translator' },
    { type: 'page_break', id: 'pb1', afterSourcePage: 1 },
  ]),
};

const genericUnknown: AstFixture = {
  id: 'generic_unknown',
  sourceScript: 'latin',
  targetScript: 'latin',
  documentProfile: 'other',
  ast: baseAst('en', 'en', 'other', 'generic_document', [
    { type: 'heading', id: 'h1', level: 1, text: 'Document' },
    { type: 'paragraph', id: 'p1', text: 'This is a general document.' },
    { type: 'signature', id: 'sig1', visualMarker: '[signature]' },
    { type: 'note', id: 'n1', text: 'Certified.', noteType: 'translator' },
    { type: 'page_break', id: 'pb1', afterSourcePage: 1 },
  ]),
};

const presentationZh: AstFixture = {
  id: 'presentation_zh',
  sourceScript: 'latin',
  targetScript: 'chinese',
  documentProfile: 'presentation',
  ast: baseAst('en', 'zh', 'presentation', 'presentation', [
    { type: 'heading', id: 'h1', level: 2, text: '幻灯片标题一' },
    { type: 'paragraph', id: 'p1', text: '幻灯片正文内容。' },
    { type: 'heading', id: 'h2', level: 2, text: '幻灯片标题二' },
    { type: 'paragraph', id: 'p2', text: '第二张幻灯片的内容。' },
  ], { sourcePageCount: 2 }),
};

// 15-page multi-page document with 14 page_break blocks
const multiPageRu: AstFixture = (() => {
  const blocks: TranslationBlock[] = [
    { type: 'heading', id: 'h1', level: 1, text: 'Диплом о высшем образовании' },
    { type: 'key_value', id: 'kv1', fields: [
      { id: 'f1', label: 'Номер', value: 'ДВО-2026-001', preserveExactly: true },
    ]},
  ];
  for (let i = 1; i <= 14; i++) {
    blocks.push({ type: 'paragraph', id: `p${i}`, text: `Страница ${i + 1}: содержание.` });
    blocks.push({ type: 'page_break', id: `pb${i}`, afterSourcePage: i });
  }
  blocks.push({ type: 'signature', id: 'sig1', role: 'Ректор', visualMarker: '[подпись]' });
  blocks.push({ type: 'note', id: 'n1', text: 'Перевод верен.', noteType: 'translator' });
  return {
    id: 'multi_page_ru',
    sourceScript: 'cyrillic',
    targetScript: 'cyrillic',
    documentProfile: 'diploma_transcript',
    ast: baseAst('ru', 'ru', 'diploma_transcript', 'academic_document', blocks, { sourcePageCount: 15 }),
  };
})();

const scannedWithVisuals: AstFixture = {
  id: 'scanned_with_visuals',
  sourceScript: 'cyrillic',
  targetScript: 'latin',
  documentProfile: 'passport_id',
  ast: {
    ...baseAst('ru', 'en', 'passport_id', 'identity_document', [
      { type: 'heading', id: 'h1', level: 1, text: 'Passport' },
      { type: 'key_value', id: 'kv1', fields: [
        { id: 'f1', label: 'No.', value: 'AB1234567', preserveExactly: true },
        { id: 'f2', label: 'Name', value: 'Ivanov Ivan' },
      ]},
      { type: 'signature', id: 'sig1', role: 'Official', visualMarker: '[signature]' },
      { type: 'visual_marker', id: 'vm1', markerText: '[stamp]' },
      { type: 'note', id: 'n1', text: 'Certified.', noteType: 'translator' },
      { type: 'page_break', id: 'pb1', afterSourcePage: 1 },
    ]),
    visualElements: [
      { id: 've1', kind: 'stamp', markerText: '[official stamp]', description: 'Round blue stamp', sourcePage: 1, position: 'bottom_right' },
      { id: 've2', kind: 'signature', markerText: '[signature]', description: 'Handwritten signature', sourcePage: 1, position: 'bottom_left' },
      { id: 've3', kind: 'qr', markerText: '[QR code]', description: 'Verification QR code', sourcePage: 1, position: 'top_right' },
    ],
    verificationItems: [
      { id: 'vi1', label: 'Verification URL', value: 'https://verify.gov.kz/AB1234567', type: 'url' },
    ],
  },
};

export const ALL_FIXTURES: AstFixture[] = [
  // Script-family fixtures
  latinLtrPassport,
  cyrillicDiploma,
  kazakhCyrillicCert,
  arabicRtlPassport,
  hebrewRtlContract,
  chinesePassport,
  japaneseDiploma,
  koreanBank,
  thaiMedical,
  devanagariPassport,
  mixedScriptRtlToLtr,
  unknownLang,
  // Document-profile fixtures
  driverLicense,
  transcriptLargeTable,
  bankStatementEn,
  contractNested,
  medicalReportEn,
  policeClearanceEn,
  visaDocumentEn,
  genericUnknown,
  presentationZh,
  multiPageRu,
  scannedWithVisuals,
];
