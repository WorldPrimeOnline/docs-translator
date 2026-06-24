import { renderToDocx } from '../lib/docx-renderer';
import fs from 'fs';
import path from 'path';

const OUT = '/tmp/wpo-acceptance';
fs.mkdirSync(OUT, { recursive: true });

const fixtures = [
  { name: '1-latin-cyrillic', targetLang: 'ru', md: '# СПРАВКА О ТРУДОУСТРОЙСТВЕ\n\n## Организация\n| Поле | Значение |\n|---|---|\n| Организация | ТОО "SML Group" |\n| БИН | 047291638 |\n\n## Сотрудник\n| Поле | Значение |\n|---|---|\n| ФИО | ЮДЕНОВ ГЛЕБ АЛЕКСАНДРОВИЧ |\n\nНастоящая справка выдана по месту требования.' },
  { name: '2-thai', targetLang: 'th', md: '# ผลการตรวจเลือด\n\n| รายการ | ค่า |\n|---|---|\n| ชื่อ | เมืองวอยเล็บ |\n\nข้อความภาษาไทย' },
  { name: '3-arabic-rtl', targetLang: 'ar', md: '# النص العربي\n\n| الحقل | القيمة |\n|---|---|\n| الاسم | أحمد محمد علي |\n| الرقم | EMP-2026-0042 |\n\nهذا النص بالعربية مع IBAN KZ559876543210123456.' },
  { name: '4-chinese', targetLang: 'zh', md: '# 雇佣证明\n\n| 字段 | 值 |\n|---|---|\n| 公司名称 | SML集团有限责任公司 |\n\n特此证明，以备存查。' },
  { name: '5-japanese', targetLang: 'ja', md: '# 在職証明書\n\n| 項目 | 内容 |\n|---|---|\n| 会社名 | SMLグループ有限責任会社 |\n\n以上、在職していることを証明します。' },
  { name: '6-korean', targetLang: 'ko', md: '# 재직증명서\n\n| 항목 | 내용 |\n|---|---|\n| 회사명 | SML그룹 유한책임회사 |\n\n위와 같이 재직 중임을 증명합니다.' },
];

async function main() {
  for (const f of fixtures) {
    const meta = { sourceLang: 'ru', targetLang: f.targetLang, documentType: 'employment_document', translatedAt: '2026-06-19', filename: 'test.pdf', serviceLevel: 'official_with_translator_signature_and_provider_stamp' as const };
    const buf = await renderToDocx(f.md, meta);
    const outPath = path.join(OUT, `${f.name}.docx`);
    fs.writeFileSync(outPath, buf);
    console.log('Written:', path.basename(outPath), buf.length, 'bytes');
  }
}
main().catch(console.error);
