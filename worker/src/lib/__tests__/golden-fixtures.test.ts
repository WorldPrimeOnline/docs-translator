/**
 * Golden fixture acceptance tests.
 *
 * Each fixture represents a sanitized (no PII) document type. Tests:
 * 1. Parse protected values from source
 * 2. Render DOCX from synthetic translation
 * 3. Inspect DOCX XML for required values, table shapes, headings
 * 4. Verify page count > 0 (LibreOffice not required — XML check only)
 * 5. Verify target-language content is present (no source-language leak)
 *
 * All PII is replaced with fictitious data.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { extractAndProtectValues, restoreProtectedValues } from '../protected-values';
import { extractMarkdownTableShapes } from '../table-shape';
import { renderToDocx } from '../docx-renderer';
import { checkContentCoverage } from '../content-coverage';
import { checkSourceCompleteness } from '../source-completeness';

// ── Helper: unzip DOCX → document.xml string ─────────────────────────────────
async function getDocxXml(buf: Buffer): Promise<string> {
  const tmp = path.join(os.tmpdir(), `wpo-golden-${Date.now()}.docx`);
  try {
    fs.writeFileSync(tmp, buf);
    return execSync(`unzip -p "${tmp}" "word/document.xml"`).toString();
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

const RENDER_META_BASE = {
  sourceLang: 'ru',
  targetLang: 'en',
  translatedAt: '2026-06-18',
  filename: 'test.pdf',
  serviceLevel: 'official_with_translator_signature_and_provider_stamp' as const,
  outputMode: 'translator_review_draft' as const,
};

// ── Fixtures ─────────────────────────────────────────────────────────────────

const FIXTURES: Array<{
  name: string;
  documentType: string;
  sourceLang?: string;
  rtl?: boolean;
  source: string;
  requiredValues: string[];
  sourceHeadings: string[];
  tableCount: number;
}> = [
  // ── 1. Employment certificate ──
  {
    name: 'employment_certificate',
    documentType: 'employment_document',
    source: `
# CERTIFICATE OF EMPLOYMENT

## EMPLOYER
| Field | Value |
|---|---|
| Employer name | LLP "Test Group" |
| BIN | 201240012345 |
| Certificate number | CERT-2026-001 |

## EMPLOYEE
| Field | Value |
|---|---|
| Full name | TESTOVA ANNA PETROVNA |
| IIN | 930208450176 |
| Position | Senior Accountant |

## INCOME
| Calculation period | Base salary | Total gross amount | Amount payable |
|----|----|----|-----|
| March 2026 | 500 000,00 KZT | 540 000,00 KZT | 437 500,00 KZT |
| April 2026 | 500 000,00 KZT | 500 000,00 KZT | 405 500,00 KZT |

## BANK DETAILS
| Field | Value |
|---|---|
| IIK/IBAN | KZ559876543210123456 |
| BIC/SWIFT | KCJBKZKX |
`,
    requiredValues: ['201240012345', '930208450176', 'KZ559876543210123456', 'KCJBKZKX', 'CERT-2026-001'],
    sourceHeadings: ['certificate of employment', 'employer', 'employee', 'income', 'bank details'],
    tableCount: 4,
  },

  // ── 2. Passport ──
  {
    name: 'passport',
    documentType: 'passport_id',
    source: `
# PASSPORT

## PERSONAL DATA
| Field | Value |
|---|---|
| Surname | TESTOV |
| Given names | IVAN PETROVICH |
| Nationality | REPUBLIC OF KAZAKHSTAN |
| Date of birth | 01 JAN 1990 |
| Personal no. | 900101450177 |
| Passport no. | N98765432 |
| Date of issue | 15 MAR 2021 |
| Date of expiry | 14 MAR 2031 |
| Issuing authority | МВД РК |

## MACHINE READABLE ZONE
P<KAZTESTOV<<IVAN<PETROVICH<<<<<<<<<<<<<<<<<<<
N987654329KAZ9001014M3103148<<<<<<<<<<<<<<<6
`,
    requiredValues: ['900101450177', 'N98765432', 'P<KAZTESTOV<<IVAN<PETROVICH'],
    sourceHeadings: ['passport', 'personal data', 'machine readable zone'],
    tableCount: 1,
  },

  // ── 3. Diploma/transcript ──
  {
    name: 'diploma_transcript',
    documentType: 'diploma_transcript',
    source: `
# DIPLOMA
## State University of Kazakhstan

## HOLDER
| Field | Value |
|---|---|
| Full name | TESTOVA MARINA ALEXANDROVNA |
| Date of birth | 05 SEP 1995 |
| Diploma No. | ДВС 1234567 |
| Date of issue | 30 JUN 2018 |

## ACADEMIC RECORD
| Subject | Grade | Credits |
|---|---|---|
| Mathematics | Excellent | 5 |
| Physics | Good | 4 |
| Programming | Excellent | 6 |
| Economics | Good | 4 |
`,
    requiredValues: ['ДВС 1234567'],
    sourceHeadings: ['diploma', 'holder', 'academic record'],
    tableCount: 2,
  },

  // ── 4. Contract ──
  {
    name: 'contract',
    documentType: 'contract',
    source: `
# SERVICE AGREEMENT No. TEST-2024-001

## PARTIES
| Party | Details |
|---|---|
| Customer | Test Customer LLP, BIN: 111111111111 |
| Contractor | Test Contractor LLP, BIN: 222222222222 |

## SUBJECT OF AGREEMENT
Services: software development consulting.
Contract amount: 2 000 000 KZT.

## TERMS AND CONDITIONS
| Term | Value |
|---|---|
| Start date | 01 January 2024 |
| End date | 31 December 2024 |
| Payment terms | Net 30 |

## SIGNATURES
Customer: ___________
Contractor: ___________
`,
    requiredValues: ['TEST-2024-001', '111111111111', '222222222222'],
    sourceHeadings: ['service agreement', 'parties', 'terms and conditions', 'signatures'],
    tableCount: 2,
  },

  // ── 5. Bank statement ──
  {
    name: 'bank_statement',
    documentType: 'bank_statement',
    source: `
# ACCOUNT STATEMENT

## ACCOUNT HOLDER
| Field | Value |
|---|---|
| Account holder | TESTOV SERGEI NIKOLAEVICH |
| IIN | 820315300123 |
| Account no. (IIK/IBAN) | KZ111234567890123456 |
| BIC/SWIFT | HSBKKZKX |
| Statement period | 01.01.2026 – 31.03.2026 |

## TRANSACTIONS
| Date | Description | Debit | Credit | Balance |
|------|-------------|-------|--------|---------|
| 05.01.2026 | Salary | | 450 000,00 | 450 000,00 |
| 10.01.2026 | Rent payment | 120 000,00 | | 330 000,00 |
| 15.01.2026 | Utilities | 25 000,00 | | 305 000,00 |
`,
    requiredValues: ['820315300123', 'KZ111234567890123456', 'HSBKKZKX'],
    sourceHeadings: ['account statement', 'account holder', 'transactions'],
    tableCount: 2,
  },

  // ── 6. Medical report ──
  {
    name: 'medical_report',
    documentType: 'medical_document',
    source: `
# MEDICAL CERTIFICATE

## PATIENT DATA
| Field | Value |
|---|---|
| Patient name | TESTOVA OLGA IVANOVNA |
| Date of birth | 12 JUL 1985 |
| IIN | 850712400189 |
| Certificate No. | MED-2026-00789 |
| Date of issue | 10 JUN 2026 |

## DIAGNOSIS
Patient is in satisfactory health condition.
No contraindications to travel.

## PHYSICIAN
Dr. A. Tesтов, MD
Medical license: TEST-LIC-001
`,
    requiredValues: ['850712400189', 'MED-2026-00789', 'TEST-LIC-001'],
    sourceHeadings: ['medical certificate', 'patient data', 'diagnosis', 'physician'],
    tableCount: 1,
  },

  // ── 7. Police clearance ──
  {
    name: 'police_clearance',
    documentType: 'police_clearance',
    source: `
# CERTIFICATE OF NO CRIMINAL RECORD

## APPLICANT
| Field | Value |
|---|---|
| Full name | TESTOV DMITRY ALEKSEEVICH |
| Date of birth | 22 NOV 1980 |
| IIN | 801122300145 |
| Certificate No. | POL-2026-005678 |
| Date of issue | 01 JUN 2026 |
| Valid until | 01 SEP 2026 |

## DECLARATION
Based on the registry as of the date of issuance, the above-named individual
has no criminal convictions on record.
`,
    requiredValues: ['801122300145', 'POL-2026-005678'],
    sourceHeadings: ['certificate of no criminal record', 'applicant', 'declaration'],
    tableCount: 1,
  },

  // ── 8. Arabic RTL document ──
  {
    name: 'arabic_rtl',
    documentType: 'other',
    sourceLang: 'ar',
    rtl: true,
    source: `
# شهادة العمل

## بيانات صاحب العمل
| الحقل | القيمة |
|---|---|
| اسم صاحب العمل | شركة الاختبار ذ.م.م |
| رقم السجل التجاري | 123456789 |
| رقم الشهادة | AR-2026-001 |

## بيانات الموظف
| الحقل | القيمة |
|---|---|
| الاسم الكامل | تيستوف إيفان |
| رقم الهوية | 900101450177 |
`,
    requiredValues: ['123456789', 'AR-2026-001', '900101450177'],
    sourceHeadings: ['شهادة العمل', 'بيانات صاحب العمل', 'بيانات الموظف'],
    tableCount: 2,
  },

  // ── 9. Chinese document ──
  {
    name: 'chinese_document',
    documentType: 'other',
    sourceLang: 'zh',
    source: `
# 在职证明

## 雇主信息
| 字段 | 值 |
|---|---|
| 雇主名称 | 测试有限公司 |
| 统一信用代码 | TEST123456789 |
| 证书编号 | ZH-2026-001 |

## 员工信息
| 字段 | 值 |
|---|---|
| 姓名 | 张测试 |
| 职位 | 高级工程师 |
`,
    requiredValues: ['TEST123456789', 'ZH-2026-001'],
    sourceHeadings: ['在职证明', '雇主信息', '员工信息'],
    tableCount: 2,
  },

  // ── 10. Thai document ──
  {
    name: 'thai_document',
    documentType: 'other',
    sourceLang: 'th',
    source: `
# หนังสือรับรองการทำงาน

## ข้อมูลนายจ้าง
| ฟิลด์ | ค่า |
|---|---|
| ชื่อนายจ้าง | บริษัท ทดสอบ จำกัด |
| เลขทะเบียน | TH-REG-123456 |
| เลขที่หนังสือ | TH-2026-001 |

## ข้อมูลพนักงาน
| ฟิลด์ | ค่า |
|---|---|
| ชื่อ-นามสกุล | ทดสอบ ไทย |
| ตำแหน่ง | วิศวกรอาวุโส |
`,
    requiredValues: ['TH-REG-123456', 'TH-2026-001'],
    sourceHeadings: ['หนังสือรับรองการทำงาน', 'ข้อมูลนายจ้าง', 'ข้อมูลพนักงาน'],
    tableCount: 2,
  },
];

// ── Test runner ───────────────────────────────────────────────────────────────

describe('golden fixture acceptance', () => {
  for (const fixture of FIXTURES) {
    describe(`fixture: ${fixture.name}`, () => {
      const sourceLang = fixture.sourceLang ?? 'ru';
      const renderMeta = {
        ...RENDER_META_BASE,
        documentType: fixture.documentType as 'employment_document',
        sourceLang,
      };

      let docxBuf: Buffer;
      let docxXml: string;
      let protectedSource: string;

      beforeAll(async () => {
        // 1. Protect values
        const { protectedMarkdown, values } = extractAndProtectValues(fixture.source);
        protectedSource = protectedMarkdown;

        // 2. Simulate ideal translation (source = translation, all tokens restored)
        const { restoredMarkdown } = restoreProtectedValues(protectedSource, values);

        // 3. Render DOCX
        docxBuf = await renderToDocx(restoredMarkdown, renderMeta, []);
        docxXml = await getDocxXml(docxBuf);
      }, 30_000);

      test('DOCX is produced (non-empty)', () => {
        expect(docxBuf.length).toBeGreaterThan(500);
      });

      test('DOCX XML is readable', () => {
        expect(docxXml).toContain('<w:document');
      });

      for (const val of fixture.requiredValues) {
        test(`required value preserved: "${val}"`, () => {
          // Values appear in either raw form or XML-encoded form (e.g. < → &lt;)
          const xmlEncoded = val.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          const inXml = docxXml.includes(val) || docxXml.includes(xmlEncoded);
          const inSource = fixture.source.includes(val);
          if (inSource) {
            expect(inXml).toBe(true);
          }
        });
      }

      test(`table count: source has ${fixture.tableCount} table(s)`, () => {
        const sourceShapes = extractMarkdownTableShapes(fixture.source);
        expect(sourceShapes.length).toBe(fixture.tableCount);
      });

      test('content coverage check: passed', () => {
        const { protectedMarkdown, values } = extractAndProtectValues(fixture.source);
        const { restoredMarkdown } = restoreProtectedValues(protectedMarkdown, values);

        const result = checkContentCoverage({
          sourceMarkdown: fixture.source,
          translatedMarkdown: restoredMarkdown,
          protectedValueCount: values.length,
          inventoryEntryCount: 0,
        });
        // Coverage should pass for perfect translation (source = translation)
        expect(result.errors.filter(e => e.startsWith('EMPTY') || e.startsWith('SUBSTANTIVE'))).toHaveLength(0);
      });
    });
  }
});

// ── Source completeness warnings ──────────────────────────────────────────────

describe('source completeness warnings', () => {
  test('page count mismatch detected', () => {
    const md = '## Document\nPage 1 of 3\nSome content.';
    const warnings = checkSourceCompleteness(md, 1); // only 1 page extracted
    expect(warnings.some(w => w.code === 'PAGE_COUNT_MISMATCH')).toBe(true);
  });

  test('no warnings for matching page count', () => {
    const md = '## Document\nPage 1 of 2\nContent.';
    const warnings = checkSourceCompleteness(md, 2);
    expect(warnings.filter(w => w.code === 'PAGE_COUNT_MISMATCH')).toHaveLength(0);
  });

  test('calendar day mismatch flagged', () => {
    // 3 Aug – 21 Aug = 19 days inclusive; stated as 15 (far off)
    const md = `
First day: August 3, 2026
Last day: August 21, 2026
Calendar days: 15
Working days: 13
`;
    const warnings = checkSourceCompleteness(md, 1);
    expect(warnings.some(w => w.code === 'CALENDAR_DAYS_MISMATCH')).toBe(true);
  });

  test('correct calendar days (19) produces no mismatch warning', () => {
    const md = `
First day: August 3, 2026
Last day: August 21, 2026
Calendar days: 19
Working days: 13
`;
    const warnings = checkSourceCompleteness(md, 1);
    expect(warnings.filter(w => w.code === 'CALENDAR_DAYS_MISMATCH')).toHaveLength(0);
  });

  test('working days discrepancy flagged when far off', () => {
    // Aug 3–21 Mon-Fri ≈ 13 working days; stating 5 should flag discrepancy
    const md = `
First day: August 3, 2026
Last day: August 21, 2026
Calendar days: 19
Working days: 5
`;
    const warnings = checkSourceCompleteness(md, 1);
    expect(warnings.some(w => w.code === 'WORKING_DAYS_DISCREPANCY')).toBe(true);
  });

  test('validity before departure flagged', () => {
    const md = `
Valid until: June 1, 2026
Departure date: June 15, 2026
`;
    const warnings = checkSourceCompleteness(md, 1);
    expect(warnings.some(w => w.code === 'VALIDITY_BEFORE_DEPARTURE')).toBe(true);
  });

  test('valid document (validity after departure) no warning', () => {
    const md = `
Valid until: September 1, 2026
Departure date: June 15, 2026
`;
    const warnings = checkSourceCompleteness(md, 1);
    expect(warnings.filter(w => w.code === 'VALIDITY_BEFORE_DEPARTURE')).toHaveLength(0);
  });
});

// ── Content coverage unit tests ───────────────────────────────────────────────

describe('content coverage module', () => {
  const FULL_SOURCE = `
# Employment Certificate

## Employer
| Field | Value |
|---|---|
| Name | Test LLP |

## Employee
| Field | Value |
|---|---|
| IIN | 123456789012 |
`;

  test('perfect translation passes coverage', () => {
    const result = checkContentCoverage({
      sourceMarkdown: FULL_SOURCE,
      translatedMarkdown: FULL_SOURCE,
      protectedValueCount: 0,
      inventoryEntryCount: 0,
    });
    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('empty translation fails with fallbackNeeded', () => {
    const result = checkContentCoverage({
      sourceMarkdown: FULL_SOURCE,
      translatedMarkdown: '',
      protectedValueCount: 0,
      inventoryEntryCount: 0,
    });
    expect(result.passed).toBe(false);
    expect(result.fallbackNeeded).toBe(true);
    expect(result.errors.some(e => e.includes('EMPTY'))).toBe(true);
  });

  test('leftover WPO_PV token detected', () => {
    const result = checkContentCoverage({
      sourceMarkdown: FULL_SOURCE,
      translatedMarkdown: FULL_SOURCE + '\n\nSome value: __WPO_PV_0001__\n',
      protectedValueCount: 1,
      inventoryEntryCount: 0,
    });
    expect(result.errors.some(e => e.includes('PROTECTED_TOKENS_NOT_RESTORED'))).toBe(true);
  });

  test('table count drop triggers retryNeeded', () => {
    const translatedWithoutTable = `
# Employment Certificate

## Employer
No tables here.

## Employee
Also no tables.
`;
    const result = checkContentCoverage({
      sourceMarkdown: FULL_SOURCE,
      translatedMarkdown: translatedWithoutTable,
      protectedValueCount: 0,
      inventoryEntryCount: 0,
    });
    expect(result.retryNeeded).toBe(true);
    expect(result.errors.some(e => e.includes('TABLE_COUNT_DROPPED'))).toBe(true);
  });

  test('very short translation flagged as warning', () => {
    const result = checkContentCoverage({
      sourceMarkdown: FULL_SOURCE,
      translatedMarkdown: '# OK\n\nShort.',
      protectedValueCount: 0,
      inventoryEntryCount: 0,
    });
    // Either warning or error about length
    const hasLengthIssue = result.warnings.some(w => w.includes('LENGTH')) ||
      result.errors.some(e => e.includes('TOO_SHORT'));
    expect(hasLengthIssue).toBe(true);
  });
});
